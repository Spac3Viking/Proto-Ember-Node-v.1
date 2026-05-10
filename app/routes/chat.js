'use strict';

/**
 * Ember Node v.ᚠ — Chat Routes (Phase 16D: Rolling Bootstrap continuity layer)
 *
 * POST /chat          (legacy Phase 2 direct-Ollama endpoint)
 * POST /api/chat      (grounded Ember Prime chat with retrieval)
 *
 * Phase 11:   Chat context is room-bounded with continuity memory overlays.
 * Phase 11.5: Chat assembly includes identity (Forge) + continuity + retrieval +
 *             optional archetype overlay.
 * Phase 16D assembly order:
 *   [1] Forge Core identity
 *   [2] Rolling Bootstrap continuity summary
 *   [3] Ember Prime continuity layer (legacy active bootstrap)
 *   [4] Optional archetype modifier
 *   [5] Retrieval context + user message
 */

const express = require('express');
const axios   = require('axios');
const { chatLimiter } = require('../rateLimiters');
const { OLLAMA_CHAT_URL, getEmberPrimeModel, resolveEmberPrimeRuntime } = require('../runtimeStewardship');
const { loadChunks }                                  = require('../indexStore');
const { retrieve, buildGroundedPrompt, detectRoute }  = require('../retrieval');
const { buildSignalTrace, formatSignalTraceSummary }  = require('../signalTrace');
const { getCourtMember, MAX_COURT_MEMBER_RETRIEVAL_TOP_K } = require('../courtConfig');
const {
    loadRollingBootstrap, formatRollingBootstrapForPrompt,
    loadForgeCore, loadArchetype,
    formatForgeCoreForPrompt,
    formatArchetypeForPrompt,
} = require('../bootstrap');
const { listLoadedCaches } = require('../loadedCaches');
const {
    loadCacheSummaries,
    loadDocumentSummaries,
    getArchetypeMemoryProfile,
} = require('../memoryCompression');

const router = express.Router();
const PARTIAL_CONTEXT_CHUNK_THRESHOLD = 2;
const CHAT_REQUEST_TIMEOUT_MS = 120000;
// Phase 16F target: keep raw grounding in the 4–8 range for faster starts.
const MAX_CHAT_CONTEXT_CHUNKS = 8;
const MAX_CHAT_CONTEXT_CHARS = 16000;
const MAX_CHAT_CHUNK_CHARS = 2200;
const MAX_CHAT_HISTORY_CHARS = 4000;
const MAX_CHAT_HISTORY_TURNS = 8;
// Phase 16F target: compact Signal Trace routing/context lists.
const MAX_SIGNAL_TRACE_SOURCES = 5;
const MAX_SIGNAL_TRACE_ROUTING_LIST = 4;
// Preserve a small raw grounding floor even when summaries are present.
const MIN_RAW_CHUNKS_WITH_SUMMARY = 3;
// Use half of the normal raw chunk budget when summary layers are available.
const SUMMARY_RAW_CHUNK_RATIO = 0.5;
const MAX_ROLLING_BOOTSTRAP_SUMMARY_CHARS = 380;
const MAX_SUMMARY_PREVIEW_CHARS = 220;
const activeChatRequests = new Map();
const RETRIEVAL_STATES = Object.freeze({
    CONTEXT_AVAILABLE: 'context_available',
    PARTIAL_CONTEXT:   'partial_context',
    NO_CONTEXT:        'no_context',
    MISSING_SOURCE:    'missing_source',
    RETRIEVAL_ERROR:   'retrieval_error',
});

const CONTEXT_BUDGET_PROFILES = Object.freeze({
    spark: {
        id: 'spark',
        label: 'Spark',
        retrievalTopK: 4,
        targetSources: 3,
        maxRawChunks: 4,
        minRawChunksWithSummary: 2,
        maxContextChars: 9600,
        maxChunkChars: 1700,
        maxHistoryChars: 1400,
        maxHistoryTurns: 4,
        maxSummaryChars: 1200,
        rollingBootstrapChars: 220,
        cacheSummaryLimit: 1,
        documentSummaryLimit: 2,
        sourceLineLimit: 2,
        includeArchetypeMemory: true,
    },
    ember: {
        id: 'ember',
        label: 'Ember',
        retrievalTopK: 6,
        targetSources: 4,
        maxRawChunks: 6,
        minRawChunksWithSummary: 3,
        maxContextChars: 13000,
        maxChunkChars: 2000,
        maxHistoryChars: 2200,
        maxHistoryTurns: 6,
        maxSummaryChars: 2200,
        rollingBootstrapChars: 320,
        cacheSummaryLimit: 2,
        documentSummaryLimit: 3,
        sourceLineLimit: 3,
        includeArchetypeMemory: true,
    },
    hearth: {
        id: 'hearth',
        label: 'Hearth',
        retrievalTopK: 8,
        targetSources: 6,
        maxRawChunks: 8,
        minRawChunksWithSummary: 4,
        maxContextChars: 16000,
        maxChunkChars: 2200,
        maxHistoryChars: 2800,
        maxHistoryTurns: 8,
        maxSummaryChars: 3000,
        rollingBootstrapChars: 400,
        cacheSummaryLimit: 3,
        documentSummaryLimit: 5,
        sourceLineLimit: 4,
        includeArchetypeMemory: true,
    },
    archive: {
        id: 'archive',
        label: 'Archive',
        retrievalTopK: 12,
        targetSources: 8,
        maxRawChunks: 12,
        minRawChunksWithSummary: 5,
        maxContextChars: 22000,
        maxChunkChars: 2600,
        maxHistoryChars: 3200,
        maxHistoryTurns: 8,
        maxSummaryChars: 3800,
        rollingBootstrapChars: 480,
        cacheSummaryLimit: 4,
        documentSummaryLimit: 6,
        sourceLineLimit: 5,
        includeArchetypeMemory: true,
    },
});
const DEFAULT_CONTEXT_BUDGET_PROFILE = CONTEXT_BUDGET_PROFILES.ember;

function normalizeRoom(room) {
    // Legacy migration alias. Remove after user data migration stabilizes.
    return room === 'workshop' ? 'council' : room;
}

function normalizeContextBudgetProfileId(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return DEFAULT_CONTEXT_BUDGET_PROFILE.id;
    if (raw === 'deep') return 'hearth';
    if (raw === 'default' || raw === 'balanced') return 'ember';
    return CONTEXT_BUDGET_PROFILES[raw] ? raw : DEFAULT_CONTEXT_BUDGET_PROFILE.id;
}

function resolveContextBudgetProfile(value) {
    const id = normalizeContextBudgetProfileId(value);
    return CONTEXT_BUDGET_PROFILES[id] || DEFAULT_CONTEXT_BUDGET_PROFILE;
}

const HEART_SYSTEM_PROMPT = (
    'You are Ember Prime — the resident continuity intelligence of an Ember Node, a sovereign ' +
    'knowledge system descended from the Green Fire Archive. You are first and foremost ' +
    'a continuity mind and synthesis layer: a long-form writing companion, a forge for thought, a mirror for emerging works. ' +
    'You serve as archive firekeeper, symbolic router, and council convener — never as an all-knowing oracle. ' +
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
    '- Do not preface with internal routing language (for example: "As the Builder lens..." or "According to retrieval...") unless the user asks.\n' +
    '- You may lightly suggest a Court lens when useful (for example: "This could be sharpened through the Builder lens.").\n' +
    '- Suggestion only; do not hand off automatically.\n' +
    '- You will receive a retrieval state marker (`context_available`, `partial_context`, `no_context`, `missing_source`, or `retrieval_error`).\n' +
    '- If state is `context_available`: respond directly with no filler.\n' +
    '- If state is `partial_context` or `missing_source`: answer directly first; mention uncertainty only if it materially affects the answer.\n' +
    '- If state is `no_context`: still answer as helpfully as possible from general local reasoning and ask for useful context only when needed.\n' +
    '- If state is `retrieval_error`: return a plain technical error response.\n' +
    '- Do not use stock missing-signal phrases.\n' +
    'You are grounded, patient, and devoted to the work. You are not an oracle.'
);

/** Room-specific system prompts for Phase 11 room-bounded context */
const ROOM_SYSTEM_PROMPTS = {
    hearth: HEART_SYSTEM_PROMPT,
    council: (
        'You are Ember Prime operating in Ember Council mode — a focused drafting and weaving ' +
        'companion. Your current context is the active Ember Council: Council context notes, drafts, ' +
        'and documents under construction. ' +
        '\n\n' +
        'In Ember Council mode you:\n' +
        '- assist with drafting, restructuring, and expanding documents\n' +
        '- help connect fragments into coherent structure\n' +
        '- reference indexed Ember Council materials and active source memory\n' +
        '- maintain focus on active work rather than archive reflection\n' +
        '\n' +
        'You speak with practical precision. You are a craftsman\'s companion.'
    ),
    threshold: (
        'You are Ember Prime operating in Threshold mode — an inspection and triage companion. ' +
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

function getRetrievalTopKForCourtMember(member) {
    if (!member || !member.retrieval || !Number.isFinite(member.retrieval.topK)) {
        return MAX_CHAT_CONTEXT_CHUNKS;
    }
    return Math.max(1, Math.min(MAX_COURT_MEMBER_RETRIEVAL_TOP_K, Math.floor(member.retrieval.topK)));
}

const COURT_MEMBER_GLYPHS = Object.freeze({
    builder: 'ᛒ',
    scribe: 'ᚲ',
    warrior: 'ᛏ',
    scholar: 'ᚨ',
    mystic: 'ᛇ',
});

const COURT_PROMPT_PROFILES = {
    builder: {
        functionLine: 'Practical systems, craft, repair, resilience, and material reality.',
        voice: 'Grounded, practical, structural, material.',
        reasoningPosture: 'Frame by parts, sequence, constraints, and implementation reality.',
        answerStructure: 'State the frame first, then components, then execution order and tradeoffs.',
        sourcePreference: 'Prefer applied continuity sources, implementation practices, and concrete examples.',
        metaphorPreference: 'Use minimal tool-and-structure metaphors only when they clarify execution.',
        practicalityLevel: 'High practicality. Prioritize what can be built and maintained now.',
        bias: 'Show the frame, parts, sequence, constraints, and what can actually be built.',
        avoid: 'Abstraction without application.',
    },
    warrior: {
        functionLine: 'Discipline under pressure, risk triage, duty, and decisive continuity action.',
        voice: 'Disciplined, direct, pressure-aware, ethically restrained.',
        reasoningPosture: 'Assess stakes, terrain, risk, and duty before recommending action.',
        answerStructure: 'Lead with the decision axis, then risk map, then immediate next move.',
        sourcePreference: 'Prefer sentinel continuity sources and scenario-tested guidance under pressure.',
        metaphorPreference: 'Use sparse terrain or guardrail metaphors; never domination language.',
        practicalityLevel: 'High practicality. Favor decisive, bounded, ethical action.',
        bias: 'Clarify stakes, terrain, risk, duty, and decisive action.',
        avoid: 'Bravado, domination, or needless aggression.',
    },
    scholar: {
        functionLine: 'Comparative analysis, distinctions, historical echoes, and conceptual relationships.',
        voice: 'Analytical, comparative, careful, connective.',
        reasoningPosture: 'Distinguish claims, compare frameworks, and mark uncertainty explicitly.',
        answerStructure: 'Define terms, compare options, then synthesize implications.',
        sourcePreference: 'Prefer cross-domain sources, references with context, and evidence-linked claims.',
        metaphorPreference: 'Use map-and-structure metaphors only when they clarify distinctions.',
        practicalityLevel: 'Medium practicality. Balance conceptual rigor with usable conclusions.',
        bias: 'Explain structures, distinctions, historical echoes, and conceptual relationships.',
        avoid: 'Unsupported certainty.',
    },
    scribe: {
        functionLine: 'Transmission, narrative coherence, memory scaffolds, and language shaping.',
        voice: 'Clear, narrative-aware, transmissive, emotionally coherent.',
        reasoningPosture: 'Preserve meaning while improving flow, recall, and communicability.',
        answerStructure: 'Organize into outline, chapter arc, or crisp sections before refinement.',
        sourcePreference: 'Prefer narrative, codex, and continuity sources that improve transmissibility.',
        metaphorPreference: 'Use chapter, codex, and thread metaphors when they sharpen memory.',
        practicalityLevel: 'Medium-high practicality. Prioritize communicable output the user can reuse.',
        bias: 'Shape fragments into outlines, chapters, codices, sagas, and memorable language.',
        avoid: 'Ornament without purpose.',
    },
    mystic: {
        functionLine: 'Symbolic pattern reading, thresholds, archetypes, dreams, and elemental resonance.',
        voice: 'Symbolic, contemplative, precise, pattern-sensitive.',
        reasoningPosture: 'Interpret symbol patterns while grounding claims in context and mechanism.',
        answerStructure: 'Name the pattern, explain meaning, then tie to grounded implication.',
        sourcePreference: 'Prefer symbolic and myth-tech sources that remain accountable to continuity reality.',
        metaphorPreference: 'Use archetypal metaphors with explicit grounding to lived constraints.',
        practicalityLevel: 'Medium practicality. Preserve symbolic depth while staying actionable.',
        bias: 'Read symbols, thresholds, archetypes, dreams, and elemental resonance while staying grounded.',
        avoid: 'Ungrounded mystification.',
    },
};

function extractCourtLensLabel(member) {
    const rawName = String((member && (member.name || member.id)) || '').trim();
    const parts = rawName.split(/\s+/).filter(Boolean);
    if (parts.length > 1 && parts[0].length === 1 && /[^\u0000-\u007f]/.test(parts[0])) {
        return parts.slice(1).join(' ');
    }
    return rawName || String((member && member.id) || '').trim();
}

function buildArchetypePromptModifier(member, archetypeMemoryProfile = null) {
    if (!member && !archetypeMemoryProfile) return '';
    const profile = member ? (COURT_PROMPT_PROFILES[member.id] || COURT_PROMPT_PROFILES.scribe) : null;
    const promptModifier = archetypeMemoryProfile && archetypeMemoryProfile.prompt_modifier
        ? archetypeMemoryProfile.prompt_modifier
        : null;
    const posture = String((promptModifier && promptModifier.posture) || (profile && profile.reasoningPosture) || '').trim();
    const bias = String((promptModifier && promptModifier.bias) || (profile && profile.bias) || '').trim();
    const avoid = String((promptModifier && promptModifier.avoid) || (profile && profile.avoid) || '').trim();
    const lens = member ? (extractCourtLensLabel(member) || member.id) : 'Ember Prime';
    const glyph = member ? (COURT_MEMBER_GLYPHS[member.id] || '') : '';
    return [
        'Active archetype: ' + (glyph ? glyph + ' ' : '') + lens,
        posture ? ('Posture: ' + posture) : '',
        bias ? ('Bias: ' + bias) : '',
        avoid ? ('Avoid: ' + avoid) : '',
    ].filter(Boolean).join('\n');
}

function normalizeDisplaySourceName(value) {
    const raw = String(value || '').trim();
    if (!raw) return raw;
    return raw
        .split(/[-_]+/)
        .filter(part => typeof part === 'string' && part.trim().length > 0)
        .map(part => {
            const trimmed = part.trim();
            return trimmed[0].toUpperCase() + trimmed.slice(1);
        })
        .join(' ');
}

function summaryKeyFromSourceName(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/\.[a-z0-9]+$/i, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function compactList(list, limit = 5) {
    if (!Array.isArray(list)) return [];
    return list.map(String).filter(Boolean).slice(0, limit);
}

/**
 * Resolve archetype retrieval tuning geometry from profile data.
 * Returns an empty object when geometry is absent or invalid.
 *
 * @param {object|null} archetypeProfile
 * @returns {object}
 */
function getArchetypeRetrievalGeometry(archetypeProfile) {
    if (
        archetypeProfile &&
        archetypeProfile.retrieval_geometry &&
        typeof archetypeProfile.retrieval_geometry === 'object'
    ) {
        return archetypeProfile.retrieval_geometry;
    }
    return {};
}

/**
 * Clamp a geometry value between bounds with fallback.
 *
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @param {number} fallback
 * @returns {number}
 */
function getGeometryLimit(value, min, max, fallback) {
    if (!Number.isFinite(value)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(value)));
}

function hasValidBootstrapSummary(rollingBootstrap) {
    return Boolean(
        rollingBootstrap &&
        typeof rollingBootstrap.summary === 'string' &&
        rollingBootstrap.summary.trim(),
    );
}

/**
 * Build summary-first compressed context blocks.
 * This produces compact layers (Rolling Bootstrap, archetype memory, cache/document summaries)
 * that can be prepended before raw chunks to keep prompts lean while preserving grounding.
 *
 * @param {object} options
 * @param {string} options.query
 * @param {object|null} options.rollingBootstrap
 * @param {string|null} options.activeArchetype
 * @param {object[]} options.sourceTrace
 * @param {number} [options.maxSummaryChars]
 * @returns {{ block: string, summaryLayersUsed: { archetypeMemory: number, cacheSummaries: number, documentSummaries: number } }}
 */
function buildSummaryFirstContext({
    query,
    rollingBootstrap,
    activeArchetype,
    sourceTrace,
    maxSummaryChars = 2400,
    maxRollingBootstrapChars = MAX_ROLLING_BOOTSTRAP_SUMMARY_CHARS,
    includeArchetypeMemory = true,
    summaryLimits = null,
}) {
    const blocks = [];
    let usedChars = 0;
    const cacheSummaries = loadCacheSummaries();
    const documentSummaries = loadDocumentSummaries();
    const archetypeProfile = getArchetypeMemoryProfile(activeArchetype || 'ember_prime');
    const geometry = getArchetypeRetrievalGeometry(archetypeProfile);
    const maxCacheSummaryLimit = Number.isFinite(summaryLimits && summaryLimits.cacheSummaryLimit)
        ? Math.max(1, Math.floor(summaryLimits.cacheSummaryLimit))
        : null;
    const maxDocumentSummaryLimit = Number.isFinite(summaryLimits && summaryLimits.documentSummaryLimit)
        ? Math.max(1, Math.floor(summaryLimits.documentSummaryLimit))
        : null;
    const maxSourceLineLimit = Number.isFinite(summaryLimits && summaryLimits.sourceLineLimit)
        ? Math.max(2, Math.floor(summaryLimits.sourceLineLimit))
        : null;
    const cacheSummaryLimit = getGeometryLimit(geometry.cache_summary_limit, 1, 4, 3);
    const documentSummaryLimit = getGeometryLimit(geometry.document_summary_limit, 1, 6, 4);
    const sourceLineLimit = getGeometryLimit(geometry.source_line_limit, 2, 6, 4);
    const boundedCacheSummaryLimit = maxCacheSummaryLimit === null
        ? cacheSummaryLimit
        : Math.min(cacheSummaryLimit, maxCacheSummaryLimit);
    const boundedDocumentSummaryLimit = maxDocumentSummaryLimit === null
        ? documentSummaryLimit
        : Math.min(documentSummaryLimit, maxDocumentSummaryLimit);
    const boundedSourceLineLimit = maxSourceLineLimit === null
        ? sourceLineLimit
        : Math.min(sourceLineLimit, maxSourceLineLimit);
    const segmentLengths = {
        rollingBootstrap: 0,
        archetypeMemory: 0,
        summaries: 0,
    };

    // segmentKey contributes per-layer prompt audit lengths:
    // 'rollingBootstrap' | 'archetypeMemory' | 'summaries'
    function pushBlock(label, text, segmentKey) {
        const value = String(text || '').trim();
        if (!value) return false;
        if (usedChars >= maxSummaryChars) return false;
        const block = `=== ${label} ===\n${value}`;
        const next = usedChars + block.length + 2;
        if (next > maxSummaryChars) return false;
        blocks.push(block);
        usedChars = next;
        if (segmentKey && segmentLengths[segmentKey] !== undefined) {
            segmentLengths[segmentKey] += block.length;
        }
        return true;
    }

    if (hasValidBootstrapSummary(rollingBootstrap)) {
        const themes = compactList(rollingBootstrap.active_themes, 4);
        const openQuestions = compactList(rollingBootstrap.open_questions, 2);
        const recentDecisions = compactList(rollingBootstrap.recent_decisions, 2);
        pushBlock('Rolling Bootstrap', [
            String(rollingBootstrap.summary || '').slice(0, maxRollingBootstrapChars),
            themes.length > 0 ? ('Themes: ' + themes.join(', ')) : '',
            openQuestions.length > 0 ? ('Open: ' + openQuestions.join(' | ')) : '',
            recentDecisions.length > 0 ? ('Decisions: ' + recentDecisions.join(' | ')) : '',
        ].filter(Boolean).join('\n'), 'rollingBootstrap');
    }

    let usedArchetypeMemory = 0;
    if (includeArchetypeMemory && archetypeProfile) {
        const archetypeLine = [
            String(archetypeProfile.summary || '').slice(0, 260),
            compactList(archetypeProfile.preferred_domains, boundedSourceLineLimit).length > 0
                ? ('Domains: ' + compactList(archetypeProfile.preferred_domains, boundedSourceLineLimit).join(', '))
                : '',
            compactList(archetypeProfile.preferred_sources, boundedSourceLineLimit).length > 0
                ? ('Sources: ' + compactList(archetypeProfile.preferred_sources, boundedSourceLineLimit).join(', '))
                : '',
        ].filter(Boolean).join('\n');
        if (pushBlock('Archetype Memory', archetypeLine, 'archetypeMemory')) {
            usedArchetypeMemory = 1;
        }
    }

    const sourceNames = Array.from(new Set((sourceTrace || [])
        .map(s => s && (s.sourceName || s.title || s.file))
        .filter(Boolean)
        .map(summaryKeyFromSourceName)));
    const cacheIds = Array.from(new Set((sourceTrace || [])
        .map(s => s && s.cacheId)
        .filter(Boolean)
        .map(String)));

    let usedCacheSummaries = 0;
    if (cacheSummaries && cacheSummaries.caches) {
        cacheIds.slice(0, boundedCacheSummaryLimit).forEach(cacheId => {
            const entry = cacheSummaries.caches[cacheId];
            if (!entry) return;
            pushBlock(
                'Cache Summary · ' + cacheId,
                [
                    String(entry.summary || '').slice(0, MAX_SUMMARY_PREVIEW_CHARS),
                    compactList(entry.themes, boundedSourceLineLimit).length > 0 ? ('Themes: ' + compactList(entry.themes, boundedSourceLineLimit).join(', ')) : '',
                    compactList(entry.dominant_archetypes, 3).length > 0
                        ? ('Archetypes: ' + compactList(entry.dominant_archetypes, 3).join(', '))
                        : '',
                ].filter(Boolean).join('\n'),
                'summaries',
            );
            usedCacheSummaries++;
        });
    }

    let usedDocumentSummaries = 0;
    if (documentSummaries && documentSummaries.documents) {
        sourceNames.slice(0, boundedDocumentSummaryLimit).forEach(sourceKey => {
            const entry = documentSummaries.documents[sourceKey];
            if (!entry) return;
            pushBlock(
                'Document Summary · ' + (entry.title || sourceKey),
                [
                    String(entry.summary || '').slice(0, MAX_SUMMARY_PREVIEW_CHARS),
                    compactList(entry.themes, boundedSourceLineLimit).length > 0 ? ('Themes: ' + compactList(entry.themes, boundedSourceLineLimit).join(', ')) : '',
                    compactList(entry.preferred_archetypes, 3).length > 0
                        ? ('Preferred archetypes: ' + compactList(entry.preferred_archetypes, 3).join(', '))
                        : '',
                ].filter(Boolean).join('\n'),
                'summaries',
            );
            usedDocumentSummaries++;
        });
    }

    return {
        block: blocks.length > 0 ? (blocks.join('\n\n') + '\n\n') : '',
        summaryLayersUsed: {
            archetypeMemory: usedArchetypeMemory,
            cacheSummaries: usedCacheSummaries,
            documentSummaries: usedDocumentSummaries,
        },
        segmentLengths: {
            ...segmentLengths,
            archetypeMemory: usedArchetypeMemory > 0 ? segmentLengths.archetypeMemory : 0,
        },
    };
}

function computeRawChunkBudgetWithSummaries(archetypeProfile, contextBudget) {
    const geometry = getArchetypeRetrievalGeometry(archetypeProfile);
    const configured = Number.isFinite(geometry.raw_chunk_target)
        ? Math.floor(geometry.raw_chunk_target)
        : null;
    const maxRawChunks = Number.isFinite(contextBudget && contextBudget.maxRawChunks)
        ? Math.max(1, Math.floor(contextBudget.maxRawChunks))
        : MAX_CHAT_CONTEXT_CHUNKS;
    const minRawWithSummary = Number.isFinite(contextBudget && contextBudget.minRawChunksWithSummary)
        ? Math.max(1, Math.floor(contextBudget.minRawChunksWithSummary))
        : MIN_RAW_CHUNKS_WITH_SUMMARY;
    if (configured !== null) {
        return Math.max(minRawWithSummary, Math.min(maxRawChunks, configured));
    }
    return Math.max(minRawWithSummary, Math.floor(maxRawChunks * SUMMARY_RAW_CHUNK_RATIO));
}

/**
 * Maximum number of pinned-source chunks prepended to retrieval results
 * when a user attaches sources to Hearth Chat.  Kept small to avoid
 * oversized prompts while still providing useful reference context.
 */
const MAX_PINNED_CHUNKS = 8;

// ── Phase 2: original chat endpoint (kept for backward compatibility) ─────────
// This endpoint bypasses retrieval and goes directly to Ollama.
// New code should use POST /api/chat which routes through Ember Prime
// with grounded retrieval.  Kept to avoid breaking any existing integrations.

router.post('/chat', async (req, res) => {
    try {
        const { message, prompt, model: _ignored, ...rest } = req.body;
        const selectedModel = getEmberPrimeModel();
        const payload = {
            stream:   false,
            ...rest,
            messages: rest.messages || [{ role: 'user', content: message || prompt || '' }],
            model:    selectedModel,
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
 * Body: { query, room?, rooms?, cacheId?, sourceIds?, archetype?, courtMember?, history?, responseDepth? }
 * Response: { answer, sources, grounded }
 *
 * room (optional)      — active room for context-bounded chat ('hearth' | 'council' [Ember Council] | 'threshold')
 * rooms (optional)     — explicit room filter array (overrides room's default pool)
 * sourceIds (optional) — array of source IDs whose chunks are pinned into the
 * retrieved context regardless of semantic relevance.
 * courtMember (optional) — Ember Court member ID string (preferred over archetype)
 * archetype (optional) — legacy alias fallback for courtMember compatibility
 */
router.post('/api/chat', chatLimiter, async (req, res) => {
    let activeRequestId = null;
    try {
        const {
            query,
            room      = null,
            rooms     = null,
            cacheId = null,
            sourceIds = null,
            archetype = null,
            courtMember = null,
            history = null,
            responseDepth = null,
            contextBudgetProfile = null,
            depthProfile = null,
            depth = null,
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

        // Precedence: explicit courtMember first, then legacy archetype alias.
        const requestedCourtMember = courtMember || archetype || null;
        const selectedCourtMember = requestedCourtMember ? getCourtMember(requestedCourtMember) : null;
        const activeArchetypeId = selectedCourtMember
            ? selectedCourtMember.id
            : (typeof archetype === 'string' ? archetype : null);
        const activeArchetypeForMemory = selectedCourtMember
            ? selectedCourtMember.id
            : (activeArchetypeId || 'ember_prime');
        const archetypeMemoryProfile = getArchetypeMemoryProfile(activeArchetypeForMemory);
        // Backward-compatible aliases (highest to lowest precedence):
        // responseDepth (UI-friendly), contextBudgetProfile/depthProfile (transition), depth (legacy).
        const requestedDepthProfileId = normalizeContextBudgetProfileId(
            responseDepth || contextBudgetProfile || depthProfile || depth,
        );
        const contextBudget = resolveContextBudgetProfile(requestedDepthProfileId);
        // Retrieval keeps the larger budget so archetype/court tuning cannot undercut
        // depth-profile breadth, while still honoring deeper court members when configured.
        const retrievalTopK = Math.max(
            contextBudget.retrievalTopK,
            getRetrievalTopKForCourtMember(selectedCourtMember),
        );

        // Determine active room for context pools and system prompt
        const requestedRoom = normalizeRoom(room);
        const activeRoom = (requestedRoom && ['hearth', 'council', 'threshold'].includes(requestedRoom))
            ? requestedRoom
            : 'hearth';

        // Determine retrieval room scope:
        // - If caller passes explicit rooms array, use that
        // - Otherwise, default to room-native pool
        const retrievalRooms = Array.isArray(rooms)
            ? rooms.map(normalizeRoom)
            : (typeof rooms === 'string' && rooms.trim()
                ? [normalizeRoom(rooms.trim())]
                : [activeRoom]);

        // Retrieve relevant local chunks via semantic / keyword search
        let retrieved = [];
        let retrievalState = RETRIEVAL_STATES.CONTEXT_AVAILABLE;
        const detectedRoute = detectRoute(query);
        try {
            retrieved = await retrieve({
                query,
                rooms: retrievalRooms,
                cacheId,
                topK: retrievalTopK,
                targetSources: contextBudget.targetSources,
                routeHint: detectedRoute,
                courtMember: selectedCourtMember,
                archetypeMemoryProfile,
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

        // ── Phase 16D: Prompt assembly order ───────────────────────────────────
        // Forge Core → Rolling Bootstrap → Ember Prime continuity → Archetype → Retrieval

        const rollingBootstrap = loadRollingBootstrap();
        let rollingBootstrapStatus = 'missing';
        if (rollingBootstrap) {
            const ts = Date.parse(rollingBootstrap.updated_at || '');
            if (Number.isFinite(ts) && (Date.now() - ts) <= (1000 * 60 * 60 * 24 * 7)) {
                rollingBootstrapStatus = 'ready';
            } else {
                rollingBootstrapStatus = 'stale';
            }
        }
        const rollingBootstrapThemes = rollingBootstrap && Array.isArray(rollingBootstrap.active_themes)
            ? rollingBootstrap.active_themes.map(String).slice(0, 5)
            : [];
        console.log('[/api/chat] rolling-bootstrap=' + rollingBootstrapStatus);

        // Forge Core identity layer
        const forgeCore = loadForgeCore();
        console.log('[/api/chat] forge-core=' + (forgeCore ? 'injected' : 'unavailable'));

        // Retrieval context (after identity/continuity layers)
        const rollingBootstrapForPrompt = rollingBootstrapStatus === 'ready' ? rollingBootstrap : null;
        const summaryFirst = buildSummaryFirstContext({
            query,
            rollingBootstrap: rollingBootstrapForPrompt,
            activeArchetype: activeArchetypeForMemory,
            sourceTrace: sources,
            maxSummaryChars: contextBudget.maxSummaryChars,
            maxRollingBootstrapChars: contextBudget.rollingBootstrapChars,
            includeArchetypeMemory: contextBudget.includeArchetypeMemory,
            summaryLimits: {
                cacheSummaryLimit: contextBudget.cacheSummaryLimit,
                documentSummaryLimit: contextBudget.documentSummaryLimit,
                sourceLineLimit: contextBudget.sourceLineLimit,
            },
        });
        const rawChunksForPrompt = summaryFirst.block
            ? retrieved.slice(0, computeRawChunkBudgetWithSummaries(archetypeMemoryProfile, contextBudget))
            : retrieved.slice(0, contextBudget.maxRawChunks);
        const groundedPrompt = buildGroundedPrompt({
            query,
            retrievedChunks: rawChunksForPrompt,
            recentHistory: Array.isArray(history) ? history : null,
            maxContextChars: contextBudget.maxContextChars || MAX_CHAT_CONTEXT_CHARS,
            maxChunkChars: contextBudget.maxChunkChars || MAX_CHAT_CHUNK_CHARS,
            maxHistoryChars: contextBudget.maxHistoryChars || MAX_CHAT_HISTORY_CHARS,
            maxHistoryTurns: contextBudget.maxHistoryTurns || MAX_CHAT_HISTORY_TURNS,
            includeMetrics: true,
        });
        const hasGroundedPromptObject = groundedPrompt && typeof groundedPrompt === 'object';
        const groundedPromptText = hasGroundedPromptObject
            ? groundedPrompt.prompt
            : String(groundedPrompt || '');
        const groundedPromptMetrics = hasGroundedPromptObject
            ? groundedPrompt.metrics
            : null;
        let userContent = groundedPromptText;
        if (summaryFirst.block) {
            userContent = summaryFirst.block + userContent;
        }
        console.log(
            '[/api/chat] retrieval=' +
            (retrieved.length > 0 ? retrieved.length + ' chunks' : 'none') +
            ' summaries=' + JSON.stringify(summaryFirst.summaryLayersUsed),
        );

        // Optional archetype modifier
        let archetypeObj = null;
        if (!selectedCourtMember && activeArchetypeId && typeof activeArchetypeId === 'string') {
            archetypeObj = loadArchetype(activeArchetypeId);
        }

        // Assemble final prompt in required order:
        // Forge Core → optional archetype → retrieval
        const forgePart = formatForgeCoreForPrompt(forgeCore);
        const rollingBootstrapPart = summaryFirst.block ? '' : formatRollingBootstrapForPrompt(rollingBootstrapForPrompt);
        // Prefer the compact archetype modifier from archetype-memory tuning.
        // Fall back to legacy archetype formatter only when compact data is unavailable.
        const fallbackArchetypePart = archetypeObj ? formatArchetypeForPrompt(archetypeObj) : '';
        const compactArchetypePart = buildArchetypePromptModifier(
            selectedCourtMember,
            archetypeMemoryProfile,
        );
        const archetypePart = compactArchetypePart || fallbackArchetypePart;

        const identityPreamble = [forgePart, rollingBootstrapPart, archetypePart]
            .filter(Boolean)
            .join('\n\n');

        if (identityPreamble) {
            userContent = identityPreamble + '\n\n' + userContent;
        }

        const retrievalStateBlock = `=== Retrieval State ===
state: ${retrievalState}

`;
        userContent = retrievalStateBlock + userContent;

        // Select room-appropriate system prompt
        const systemPrompt = ROOM_SYSTEM_PROMPTS[activeRoom] || HEART_SYSTEM_PROMPT;

        // Resolve Ember Prime runtime (Ollama-first).
        const heart = resolveEmberPrimeRuntime();

        const payload = {
            model:    heart.model,
            stream:   false,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user',   content: userContent },
            ],
        };

        const promptAudit = {
            systemPromptLength: systemPrompt.length,
            rollingBootstrapLength: (
                rollingBootstrapPart.length +
                (summaryFirst.segmentLengths ? summaryFirst.segmentLengths.rollingBootstrap : 0)
            ),
            archetypeModifierLength: archetypePart.length,
            summaryContextLength: summaryFirst.segmentLengths
                ? summaryFirst.segmentLengths.summaries
                : summaryFirst.block.length,
            rawChunkContextLength: groundedPromptMetrics ? groundedPromptMetrics.rawContextChars : 0,
            chatHistoryLength: groundedPromptMetrics ? groundedPromptMetrics.historyChars : 0,
            chatHistoryTurns: groundedPromptMetrics ? groundedPromptMetrics.historyTurns : 0,
            finalPromptLength: (
                systemPrompt.length +
                userContent.length
            ),
        };

        let response;
        const modelRequestStartedAt = Date.now();
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
                    message: 'Ember Prime is taking longer than usual. You may wait or still the signal.',
                });
            }
            throw err;
        }
        const modelResponseTimeMs = Date.now() - modelRequestStartedAt;
        console.log(
            '[/api/chat] prompt-audit system=' + promptAudit.systemPromptLength +
            ' rolling=' + promptAudit.rollingBootstrapLength +
            ' archetype=' + promptAudit.archetypeModifierLength +
            ' summaries=' + promptAudit.summaryContextLength +
            ' raw=' + promptAudit.rawChunkContextLength +
            ' history=' + promptAudit.chatHistoryLength + '/' + promptAudit.chatHistoryTurns +
            ' final=' + promptAudit.finalPromptLength +
            ' responseMs=' + modelResponseTimeMs,
        );
        const answer   = response.data && response.data.message
            ? response.data.message.content
            : '';
        const uniqueSourceCount = new Set(
            (sources || []).map(s => [s.room, s.file, s.cacheId || '', s.shelf || ''].join('|')),
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
        const courtDomains = selectedCourtMember && Array.isArray(selectedCourtMember.priorityDomains)
            ? selectedCourtMember.priorityDomains.map(String).slice(0, MAX_SIGNAL_TRACE_ROUTING_LIST)
            : [];
        const courtPrioritySourcesConsidered = Array.isArray(retrieved[0] && retrieved[0].courtPrioritySourcesConsidered)
            ? retrieved[0].courtPrioritySourcesConsidered
                .map(String)
                .slice(0, MAX_SIGNAL_TRACE_ROUTING_LIST)
            : [];
        const compactContextList = Array.from(new Set((sources || []).map(s => s.sourceName || s.title || s.file)))
            .map(normalizeDisplaySourceName)
            .slice(0, MAX_SIGNAL_TRACE_SOURCES);
        const sourcesActuallyUsed = compactContextList.slice(0, MAX_SIGNAL_TRACE_ROUTING_LIST);
        const sourceList = compactContextList;
        const loadedCaches = listLoadedCaches();
        const cacheLoadoutNames = loadedCaches
            .map(cache => cache && cache.title ? String(cache.title) : (cache && cache.id ? String(cache.id) : ''))
            .filter(Boolean)
            .slice(0, 5);
        const lensName = selectedCourtMember ? extractCourtLensLabel(selectedCourtMember) : 'Ember Prime';
        const lensGlyph = selectedCourtMember ? (COURT_MEMBER_GLYPHS[selectedCourtMember.id] || '') : '';
        const courtSourcesConsidered = courtPrioritySourcesConsidered.length > 0
            ? courtPrioritySourcesConsidered
            : (selectedCourtMember && Array.isArray(selectedCourtMember.prioritySources)
                ? selectedCourtMember.prioritySources.map(String).slice(0, MAX_SIGNAL_TRACE_ROUTING_LIST)
                : []);
        const signalTrace = {
            contextStatus: mapContextStatus(retrievalState),
            depth: contextBudget.label,
            routeDetected: detectedRoute || 'general',
            courtLens: selectedCourtMember
                ? ((lensGlyph ? (lensGlyph + ' ') : '') + lensName)
                : 'Ember Prime',
            courtDomains,
            courtSourcesConsidered: courtSourcesConsidered.map(normalizeDisplaySourceName),
            courtPrioritySourcesConsidered: courtPrioritySourcesConsidered.map(normalizeDisplaySourceName),
            conceptRoute,
            relatedDomains,
            prioritySourcesConsidered: prioritySourcesConsidered.map(normalizeDisplaySourceName),
            sourcesActuallyUsed,
            sourcesUsed: uniqueSourceCount,
            chunksUsed: retrieved.length,
            sourceList,
            model: heart.model,
            provider: 'Ollama',
            modelResponseMs: modelResponseTimeMs,
            retrievalNote: buildRetrievalNote(retrievalState, retrieved.length, missingPinnedSources.length),
            rollingBootstrapStatus,
            rollingBootstrapThemes,
            loadedCacheCount: loadedCaches.length,
            cacheLoadout: cacheLoadoutNames,
            memoryFlow: {
                rollingBootstrap: rollingBootstrapStatus,
                archetypeMemory: activeArchetypeForMemory,
                cacheSummaries: summaryFirst.summaryLayersUsed.cacheSummaries,
                documentSummaries: summaryFirst.summaryLayersUsed.documentSummaries,
                rawChunks: rawChunksForPrompt.length,
            },
            compact: [
                'Active archetype: ' + (
                    selectedCourtMember
                        ? ((lensGlyph ? (lensGlyph + ' ') : '') + lensName)
                        : 'Ember Prime'
                ),
                'Depth: ' + contextBudget.label,
                'Route: ' + ([detectedRoute || 'general'].concat(relatedDomains).slice(0, 2).join(' → ')),
                'Memory: bootstrap ' + rollingBootstrapStatus + ' · summaries ' +
                    (summaryFirst.summaryLayersUsed.cacheSummaries + summaryFirst.summaryLayersUsed.documentSummaries) +
                    ' · chunks ' + rawChunksForPrompt.length,
                'Cache Loadout: ' + loadedCaches.length + ' loaded',
                'Loaded Caches: ' + (cacheLoadoutNames.length > 0 ? cacheLoadoutNames.join(', ') : 'none'),
                'Context: ' + (sourceList.length > 0 ? sourceList.join(', ') : 'none'),
                'Model: ' + heart.model + ' / Ollama',
            ].join('\n'),
        };

        const activeArchetype = selectedCourtMember
            ? selectedCourtMember.id
            : (archetypeObj ? archetypeObj.id : null);
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
