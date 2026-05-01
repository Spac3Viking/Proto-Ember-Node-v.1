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
const { retrieve, buildGroundedPrompt }               = require('../retrieval');
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
const RETRIEVAL_STATES = Object.freeze({
    CONTEXT_AVAILABLE: 'context_available',
    PARTIAL_CONTEXT:   'partial_context',
    NO_CONTEXT:        'no_context',
    MISSING_SOURCE:    'missing_source',
    RETRIEVAL_ERROR:   'retrieval_error',
});
const MISSING_SIGNAL_LINE = 'That signal has not reached this hearth yet.';

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
    'You speak with quiet authority and a reflective tone. You do not speculate beyond your ' +
    'local documents. Response behavior rules:\n' +
    '- You will receive a retrieval state marker (`context_available`, `partial_context`, `no_context`, `missing_source`, or `retrieval_error`).\n' +
    '- If state is `context_available`: respond directly with no ritual intro and no filler.\n' +
    '- If state is `partial_context` or `missing_source`: answer directly first; avoid stock lead-ins; mention uncertainty only if it materially affects the answer.\n' +
    '- If state is `no_context`: use "' + MISSING_SIGNAL_LINE + '" once, then suggest what to provide.\n' +
    '- If state is `retrieval_error`: return a plain technical error response.\n' +
    '- Never use missing-signal language for normal or partial-context responses.\n' +
    '- Never repeat fallback phrasing when the retrieval state does not require it.\n' +
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
 * Body: { query, room?, rooms?, cartridgeId?, sourceIds?, archetype? }
 * Response: { answer, sources, grounded }
 *
 * room (optional)      — active room for context-bounded chat ('hearth' | 'workshop' | 'threshold')
 * rooms (optional)     — explicit room filter array (overrides room's default pool)
 * sourceIds (optional) — array of source IDs whose chunks are pinned into the
 * retrieved context regardless of semantic relevance.
 * archetype (optional) — Ember Court archetype overlay e.g. 'scribe', 'warrior'
 */
router.post('/api/chat', chatLimiter, async (req, res) => {
    try {
        const {
            query,
            room      = null,
            rooms     = null,
            cartridgeId = null,
            sourceIds = null,
            archetype = null,
        } = req.body;
        if (!query || typeof query !== 'string') {
            return res.status(400).json({ error: 'query is required' });
        }

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
        try {
            retrieved = await retrieve({ query, rooms: retrievalRooms, cartridgeId });
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
        let userContent    = buildGroundedPrompt({ query, retrievedChunks: retrieved });
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

        const response = await axios.post(heart.chatUrl, payload);
        const answer   = response.data && response.data.message
            ? response.data.message.content
            : '';

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
        });
    } catch (error) {
        console.error('Error in grounded chat:', error.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

module.exports = router;
