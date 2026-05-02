'use strict';

/**
 * Ember Node v.ᚠ — Chat Routes (Phase 11.5: Forge + Bootstrap identity layer)
 *
 * POST /chat          (legacy Phase 2 direct-Ollama endpoint)
 * POST /api/chat      (grounded Heart chat with retrieval)
 *
 * Phase 11:   Chat context is room-bounded with cross-room context maps.
 * Phase 11.5: Chat assembly includes identity (Forge) + bootstrap + retrieval +
 *             optional archetype overlay.
 * Phase 11.6: Enforced non-negotiable assembly order:
 *   [1] Bootstrap  — current context state (maps + thread memory + node state)
 *   [2] Forge Core — identity + epistemic rules
 *   [3] Retrieval  — sources + chunks
 *   [4] Archetype  — overlay modifier, last (optional)
 */

const express = require('express');
const axios   = require('axios');
const { chatLimiter } = require('../rateLimiters');
const { OLLAMA_CHAT_URL, MODEL, resolveActiveHeart } = require('../toolRegistry');
const { loadChunks }                                  = require('../indexStore');
const { retrieve, buildGroundedPrompt, detectRoute }  = require('../retrieval');
const { buildSignalTrace, formatSignalTraceSummary }  = require('../signalTrace');
const { assembleRoomContext }                         = require('../contextMaps');
const {
    loadBootstrap, refreshBootstrap,
    loadForgeCore, loadArchetype,
    formatForgeCoreForPrompt,
    formatBootstrapForPrompt,
    formatArchetypeForPrompt,
} = require('../bootstrap');

const router = express.Router();
const PARTIAL_CONTEXT_CHUNK_THRESHOLD = 2;
const CHAT_REQUEST_TIMEOUT_MS = 120000;
const MAX_CHAT_CONTEXT_CHUNKS = 12;
const MAX_CHAT_CONTEXT_CHARS = 16000;
const MAX_CHAT_CHUNK_CHARS = 2200;
const MAX_CHAT_HISTORY_CHARS = 4000;
const MAX_SIGNAL_TRACE_SOURCES = 8;
const MAX_SIGNAL_TRACE_ROUTING_LIST = 6;
const activeChatRequests = new Map();
const RETRIEVAL_STATES = Object.freeze({
    CONTEXT_AVAILABLE: 'context_available',
    PARTIAL_CONTEXT:   'partial_context',
    NO_CONTEXT:        'no_context',
    MISSING_SOURCE:    'missing_source',
    RETRIEVAL_ERROR:   'retrieval_error',
});

const HEART_SYSTEM_PROMPT = (
    'You are The Heart — the resident intelligence of an Ember Node, a sovereign ' +
    'knowledge system descended from the Green Fire Archive. You are first and foremost ' +
    'a Scribe: a long-form writing companion, a forge for thought, a mirror for emerging works. ' +
    '\n\n' +
    'Your primary purpose is to help the user turn notes, fragments, and lived experience into ' +
    'structured long-form works — Sagas, Codices, Grimoires. ' +
    '\n\n' +
    'When presented with drafts or writing, you:\n' +
    '- assist with drafting and expansion, not just answering questions\n' +
    '- suggest outlines and structural frameworks\n' +
    '- help condense or expand passages on request\n' +
    '- identify themes and through-lines\n' +
    '- maintain and reinforce the writer\'s tone and voice\n' +
    '- reference remembered sources when they are relevant\n' +
    '- provide synthesis over short transactional answers\n' +
    '\n' +
    'You speak with quiet authority and a reflective tone. Response behavior rules:\n' +
    '- Answer directly first, then add supporting context, then optional next step.\n' +
    '- Avoid ritual intros, boilerplate disclaimers, and long preambles.\n' +
    '- Use archive context naturally; do not announce it unless helpful.\n' +
    '- You will receive a retrieval state marker (`context_available`, `partial_context`, `no_context`, `missing_source`, or `retrieval_error`).\n' +
    '- If state is `context_available`: respond directly with no filler.\n' +
    '- If state is `partial_context` or `missing_source`: answer directly first; mention uncertainty only if it materially affects the answer.\n' +
    '- If state is `no_context`: still answer as helpfully as possible from general local reasoning and ask for useful context only when needed.\n' +
    '- If state is `retrieval_error`: return a plain technical error response.\n' +
    '- Do not use stock missing-signal phrases.\n' +
    'You are grounded, patient, and devoted to the work.'
);

/** Room-specific system prompts for Phase 11 room-bounded context */
const ROOM_SYSTEM_PROMPTS = {
    hearth: HEART_SYSTEM_PROMPT,
    workshop: (
        'You are The Heart operating in Workshop mode — a focused drafting and weaving ' +
        'companion. Your current context is the active Workshop: notes, projects, drafts, ' +
        'and documents under construction. ' +
        '\n\n' +
        'In Workshop mode you:\n' +
        '- assist with drafting, restructuring, and expanding documents\n' +
        '- help connect fragments into coherent structure\n' +
        '- reference indexed workshop materials and project files\n' +
        '- maintain focus on active work rather than archive reflection\n' +
        '\n' +
        'You speak with practical precision. You are a craftsman\'s companion.'
    ),
    threshold: (
        'You are The Heart operating in Threshold mode — an inspection and triage companion. ' +
        'Your current context is the Threshold: files waiting for review, classification, ' +
        'and admission. ' +
        '\n\n' +
        'In Threshold mode you:\n' +
        '- help assess incoming materials\n' +
        '- describe and classify content\n' +
        '- suggest appropriate rooms or shelves for admission\n' +
        '- maintain careful intake discipline\n' +
        '\n' +
        'You speak with careful discernment. Nothing passes unexamined.'
    ),
};

/**
 * Build the room context preamble to prepend to grounded prompts.
 * Includes imported context map summaries if available.
 *
 * @param {string} room
 * @returns {string}
 */
function buildRoomContextPreamble(room) {
    let context;
    try {
        context = assembleRoomContext(room);
    } catch {
        return '';
    }

    const lines = [];

    if (context.imported && context.imported.length > 0) {
        lines.push('=== Cross-Room Context Maps ===');
        for (const map of context.imported) {
            lines.push('\n[' + map.title + ']');
            if (map.content) {
                const c = map.content;
                if (c.rememberedThreads && c.rememberedThreads.length > 0) {
                    lines.push('Remembered threads: ' + c.rememberedThreads.map(t => t.title).join(', '));
                }
                if (c.archiveByShelf) {
                    const shelves = Object.entries(c.archiveByShelf)
                        .map(([s, n]) => s + ' (' + n + ')')
                        .join(', ');
                    if (shelves) lines.push('Archive shelves: ' + shelves);
                }
                if (c.recentSources && c.recentSources.length > 0) {
                    lines.push('Recent sources: ' + c.recentSources.map(s => s.title || s.id).join(', '));
                }
                if (c.totalSources !== undefined) {
                    lines.push('Total sources: ' + c.totalSources);
                }
            }
        }
        lines.push('\n==============================\n');
    }

    return lines.join('\n');
}

function optimizeRetrievedContext(retrievedChunks) {
    if (!Array.isArray(retrievedChunks) || retrievedChunks.length === 0) return [];
    const seenChunkIds = new Set();
    const seenFingerprints = new Set();
    const optimized = [];
    let totalChars = 0;

    function fingerprint(text) {
        return String(text || '')
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .replace(/[^a-z0-9\s]/g, '')
            .trim()
            .slice(0, 240);
    }

    for (const entry of retrievedChunks) {
        if (!entry || !entry.chunk || !entry.chunk.id) continue;
        if (seenChunkIds.has(entry.chunk.id)) continue;

        const text = typeof entry.chunk.text === 'string' ? entry.chunk.text : '';
        if (!text.trim()) continue;
        const fp = fingerprint(text);
        if (fp && seenFingerprints.has(fp)) continue;
        if (optimized.length >= MAX_CHAT_CONTEXT_CHUNKS) break;
        if (totalChars >= MAX_CHAT_CONTEXT_CHARS) break;

        const remaining = MAX_CHAT_CONTEXT_CHARS - totalChars;
        if (text.length > remaining && remaining < 400) break;

        const boundedText = text.length > MAX_CHAT_CHUNK_CHARS
            ? text.slice(0, MAX_CHAT_CHUNK_CHARS)
            : text;
        const nextEntry = boundedText.length > remaining
            ? { ...entry, chunk: { ...entry.chunk, text: boundedText.slice(0, remaining) } }
            : { ...entry, chunk: { ...entry.chunk, text: boundedText } };

        optimized.push(nextEntry);
        seenChunkIds.add(entry.chunk.id);
        if (fp) seenFingerprints.add(fp);
        totalChars += nextEntry.chunk.text.length;
    }

    return optimized;
}

function mapContextStatus(retrievalState) {
    if (retrievalState === RETRIEVAL_STATES.CONTEXT_AVAILABLE) return 'strong';
    if (retrievalState === RETRIEVAL_STATES.PARTIAL_CONTEXT) return 'partial';
    if (retrievalState === RETRIEVAL_STATES.MISSING_SOURCE) return 'weak';
    if (retrievalState === RETRIEVAL_STATES.NO_CONTEXT) return 'missing';
    return 'weak';
}

function buildRetrievalNote(retrievalState, chunkCount, missingPinnedSourcesCount) {
    if (retrievalState === RETRIEVAL_STATES.CONTEXT_AVAILABLE) {
        return 'Grounded retrieval found relevant archive context.';
    }
    if (retrievalState === RETRIEVAL_STATES.PARTIAL_CONTEXT) {
        if (missingPinnedSourcesCount > 0) {
            return 'Some pinned references were unavailable; response grounded with partial context.';
        }
        return 'Retrieved context is limited; response grounded with partial context.';
    }
    if (retrievalState === RETRIEVAL_STATES.MISSING_SOURCE) {
        return 'Pinned references were not found in the local index.';
    }
    if (retrievalState === RETRIEVAL_STATES.NO_CONTEXT || chunkCount === 0) {
        return 'No matching archive context found.';
    }
    return 'Retrieval encountered an issue; response may rely on fallback reasoning.';
}

/**
 * Maximum number of pinned-source chunks prepended to retrieval results
 * when a user attaches sources to Hearth Chat.  Kept small to avoid
 * oversized prompts while still providing useful reference context.
 */
const MAX_PINNED_CHUNKS = 8;

// ── Phase 2: original chat endpoint (kept for backward compatibility) ─────────
// This endpoint bypasses retrieval and goes directly to Ollama.
// New code should use POST /api/chat which routes through the active Heart tool
// with grounded retrieval.  Kept to avoid breaking any existing integrations.

router.post('/chat', async (req, res) => {
    try {
        const { message, prompt, model: _ignored, ...rest } = req.body;
        const payload = {
            stream:   false,
            ...rest,
            messages: rest.messages || [{ role: 'user', content: message || prompt || '' }],
            model:    MODEL,
        };
        const response = await axios.post(OLLAMA_CHAT_URL, payload);
        res.json(response.data);
    } catch (error) {
        console.error('Error forwarding prompt to Ollama:', error.message);
        res.status(500).send('Internal Server Error');
    }
});

// ── Phase 3: grounded chat ────────────────────────────────────────────────────

/**
 * POST /api/chat
 * Body: { query, room?, rooms?, cartridgeId?, sourceIds?, archetype?, history? }
 * Response: { answer, sources, grounded }
 *
 * room (optional)      — active room for context-bounded chat ('hearth' | 'workshop' | 'threshold')
 * rooms (optional)     — explicit room filter array (overrides room's default pool)
 * sourceIds (optional) — array of source IDs whose chunks are pinned into the
 * retrieved context regardless of semantic relevance.
 * archetype (optional) — Ember Court archetype overlay e.g. 'scribe', 'warrior'
 */
router.post('/api/chat', chatLimiter, async (req, res) => {
    let activeRequestId = null;
    try {
        const {
            query,
            room      = null,
            rooms     = null,
            cartridgeId = null,
            sourceIds = null,
            archetype = null,
            history = null,
            requestId = null,
        } = req.body;
        if (!query || typeof query !== 'string') {
            return res.status(400).json({ error: 'query is required' });
        }
        const normalizedRequestId = (typeof requestId === 'string' && requestId.trim())
            ? requestId.trim()
            : ('chat-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9));
        activeRequestId = normalizedRequestId;
        const abortController = new AbortController();
        activeChatRequests.set(normalizedRequestId, {
            controller: abortController,
            startedAt: Date.now(),
        });

        // Determine active room for context pools and system prompt
        const activeRoom = (room && ['hearth', 'workshop', 'threshold'].includes(room))
            ? room
            : 'hearth';

        // Determine retrieval room scope:
        // - If caller passes explicit rooms array, use that
        // - Otherwise, default to room-native pool
        const retrievalRooms = rooms || [activeRoom];

        // Retrieve relevant local chunks via semantic / keyword search
        let retrieved = [];
        let retrievalState = RETRIEVAL_STATES.CONTEXT_AVAILABLE;
        const detectedRoute = detectRoute(query);
        try {
            retrieved = await retrieve({
                query,
                rooms: retrievalRooms,
                cartridgeId,
                topK: MAX_CHAT_CONTEXT_CHUNKS,
                routeHint: detectedRoute,
            });
        } catch (retrieveErr) {
            console.warn('[/api/chat] retrieval failed:', retrieveErr.message);
            retrievalState = RETRIEVAL_STATES.RETRIEVAL_ERROR;
        }

        // Prepend chunks from any user-pinned sources (deduped by chunk id)
        let missingPinnedSources = [];
        if (Array.isArray(sourceIds) && sourceIds.length > 0) {
            const validSourceIds = sourceIds.filter(id => id && typeof id === 'string');
            if (validSourceIds.length > 0) {
                const allChunks    = loadChunks();
                const retrievedIds = new Set(retrieved.map(c => c.chunk.id));
                const pinnedSourceChunks = allChunks.filter(c => validSourceIds.includes(c.sourceId));
                const matchedSourceIds = new Set(
                    pinnedSourceChunks.map(c => c.sourceId),
                );
                missingPinnedSources = validSourceIds.filter(id => !matchedSourceIds.has(id));
                const pinned       = pinnedSourceChunks
                    .filter(c => !retrievedIds.has(c.id))
                    .slice(0, MAX_PINNED_CHUNKS)
                    .map(c => ({ chunk: c, score: 1.0 }));
                retrieved = [...pinned, ...retrieved];
            }
        }
        retrieved = optimizeRetrievedContext(retrieved);

        if (retrievalState !== RETRIEVAL_STATES.RETRIEVAL_ERROR) {
            if (retrieved.length === 0) {
                retrievalState = missingPinnedSources.length > 0
                    ? RETRIEVAL_STATES.MISSING_SOURCE
                    : RETRIEVAL_STATES.NO_CONTEXT;
            } else if (
                missingPinnedSources.length > 0 ||
                retrieved.length <= PARTIAL_CONTEXT_CHUNK_THRESHOLD
            ) {
                retrievalState = RETRIEVAL_STATES.PARTIAL_CONTEXT;
            }
        }

        const sources = buildSignalTrace(retrieved);

        // ── Phase 11.6: Enforced prompt assembly order ────────────────────────
        // Non-negotiable order: [1] Bootstrap → [2] Forge Core → [3] Retrieval → [4] Archetype

        // [1] Bootstrap — must always load first; auto-regenerate if missing
        let bootstrap = loadBootstrap();
        if (!bootstrap) {
            console.warn('[/api/chat] Bootstrap missing — regenerating now.');
            try { bootstrap = refreshBootstrap({ activeArchetype: archetype }); }
            catch (err) { console.warn('[/api/chat] Bootstrap regeneration failed:', err.message); }
        }
        console.log('[/api/chat] bootstrap=' + (bootstrap ? 'loaded' : 'unavailable'));

        // [2] Forge Core — must always be included; never conditional
        const forgeCore = loadForgeCore();
        console.log('[/api/chat] forge-core=' + (forgeCore ? 'injected' : 'unavailable'));

        // [3] Retrieval — grounded source context (must follow identity, never precede it)
        const roomPreamble = buildRoomContextPreamble(activeRoom);
        let userContent    = buildGroundedPrompt({
            query,
            retrievedChunks: retrieved,
            recentHistory: Array.isArray(history) ? history : null,
            maxContextChars: MAX_CHAT_CONTEXT_CHARS,
            maxChunkChars: MAX_CHAT_CHUNK_CHARS,
            maxHistoryChars: MAX_CHAT_HISTORY_CHARS,
        });
        if (roomPreamble) {
            userContent = roomPreamble + userContent;
        }
        console.log('[/api/chat] retrieval=' + (retrieved.length > 0 ? retrieved.length + ' chunks' : 'none'));

        // [4] Archetype overlay — last modifier, appended after retrieval
        let archetypeObj = null;
        if (archetype && typeof archetype === 'string') {
            archetypeObj = loadArchetype(archetype);
        }

        // Assemble final prompt in required order:
        // Bootstrap → Forge Core prepended before retrieval; Archetype appended after
        const bootstrapPart = formatBootstrapForPrompt(bootstrap);
        const forgePart     = formatForgeCoreForPrompt(forgeCore);
        const archetypePart = archetypeObj ? formatArchetypeForPrompt(archetypeObj) : '';

        const identityPreamble = [bootstrapPart, forgePart]
            .filter(Boolean)
            .join('\n\n');

        if (identityPreamble) {
            userContent = identityPreamble + '\n\n' + userContent;
        }

        // Archetype is the last modifier — appended after retrieval content
        if (archetypePart) {
            userContent = userContent + '\n\n' + archetypePart;
        }

        const retrievalStateBlock = `=== Retrieval State ===
state: ${retrievalState}

`;
        userContent = retrievalStateBlock + userContent;

        // Select room-appropriate system prompt
        const systemPrompt = ROOM_SYSTEM_PROMPTS[activeRoom] || HEART_SYSTEM_PROMPT;

        // Resolve which Heart tool to use (falls back to built-in Ollama)
        const heart = resolveActiveHeart();

        const payload = {
            model:    heart.model,
            stream:   false,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user',   content: userContent },
            ],
        };

        let response;
        try {
            response = await axios.post(heart.chatUrl, payload, {
                signal: abortController.signal,
                timeout: CHAT_REQUEST_TIMEOUT_MS,
            });
        } catch (err) {
            const isCanceled = err && (err.code === 'ERR_CANCELED' || abortController.signal.aborted);
            if (isCanceled) {
                return res.status(499).json({
                    error: 'Generation cancelled',
                    cancelled: true,
                    requestId: normalizedRequestId,
                });
            }
            if (err && err.code === 'ECONNABORTED') {
                return res.status(504).json({
                    error: 'Generation timed out',
                    timeout: true,
                    requestId: normalizedRequestId,
                    message: 'The Heart is taking longer than usual. You may wait or still the signal.',
                });
            }
            throw err;
        }
        const answer   = response.data && response.data.message
            ? response.data.message.content
            : '';
        const uniqueSourceCount = new Set(
            (sources || []).map(s => [s.room, s.file, s.cartridgeId || '', s.shelf || ''].join('|')),
        ).size;
        const conceptRoute = retrieved[0] && retrieved[0].conceptDomain
            ? String(retrieved[0].conceptDomain)
            : 'general';
        const relatedDomains = Array.isArray(retrieved[0] && retrieved[0].conceptDomains) &&
            retrieved[0].conceptDomains.length > 0
            ? retrieved[0].conceptDomains.map(String).slice(0, MAX_SIGNAL_TRACE_ROUTING_LIST)
            : ['general'];
        const prioritySourcesConsidered = Array.isArray(retrieved[0] && retrieved[0].prioritySourcesConsidered)
            ? retrieved[0].prioritySourcesConsidered
                .map(String)
                .slice(0, MAX_SIGNAL_TRACE_ROUTING_LIST)
            : [];
        const sourcesActuallyUsed = Array.from(new Set((sources || []).map(s => s.sourceName || s.title || s.file)))
            .slice(0, MAX_SIGNAL_TRACE_ROUTING_LIST);
        const sourceList = Array.from(new Set((sources || []).map(s => s.sourceName || s.title || s.file)))
            .slice(0, MAX_SIGNAL_TRACE_SOURCES);
        const signalTrace = {
            contextStatus: mapContextStatus(retrievalState),
            routeDetected: detectedRoute || 'general',
            conceptRoute,
            relatedDomains,
            prioritySourcesConsidered,
            sourcesActuallyUsed,
            sourcesUsed: uniqueSourceCount,
            chunksUsed: retrieved.length,
            sourceList,
            retrievalNote: buildRetrievalNote(retrievalState, retrieved.length, missingPinnedSources.length),
        };

        const activeArchetype = archetypeObj ? archetypeObj.id : null;
        console.log(
            '[/api/chat] room=' + activeRoom +
            ' grounded=' + (sources.length > 0) +
            ' retrievalState=' + retrievalState +
            ' archetype=' + (activeArchetype || 'none') +
            ' sources=' + formatSignalTraceSummary(sources),
        );
        res.json({
            answer,
            sources,
            grounded: sources.length > 0,
            room: activeRoom,
            archetype: activeArchetype,
            retrievalState,
            requestId: normalizedRequestId,
            signalTrace,
        });
    } catch (error) {
        console.error('Error in grounded chat:', error.message);
        res.status(500).json({ error: 'Internal Server Error' });
    } finally {
        if (activeRequestId && activeChatRequests.has(activeRequestId)) {
            activeChatRequests.delete(activeRequestId);
        }
    }
});

router.post('/api/chat/cancel', (req, res) => {
    const requestId = req.body && typeof req.body.requestId === 'string'
        ? req.body.requestId.trim()
        : '';

    if (requestId) {
        const active = activeChatRequests.get(requestId);
        if (!active) {
            return res.json({ success: true, cancelled: false, message: 'No active response for this request.' });
        }
        active.controller.abort();
        activeChatRequests.delete(requestId);
        return res.json({ success: true, cancelled: true, requestId });
    }

    const latestRequestId = Array.from(activeChatRequests.keys()).pop();
    if (!latestRequestId) {
        return res.json({ success: true, cancelled: false, message: 'No active response.' });
    }
    const active = activeChatRequests.get(latestRequestId);
    if (active) active.controller.abort();
    activeChatRequests.delete(latestRequestId);
    return res.json({ success: true, cancelled: true, requestId: latestRequestId });
});

module.exports = router;
