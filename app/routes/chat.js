'use strict';

/**
 * Ember Node v.ᚠ — Chat Routes
 *
 * POST /chat          (legacy direct-Ollama endpoint)
 * POST /api/chat      (grounded chat with retrieval + Model Role routing)
 *
 * Assembly order:
 *   [1] Runtime system identity
 *   [2] Rolling Bootstrap continuity summary
 *   [3] Active continuity layer
 *   [4] Optional archetype modifier
 *   [5] Retrieval context + user message
 */

const express = require('express');
const axios   = require('axios');
const { chatLimiter } = require('../rateLimiters');
const { OLLAMA_CHAT_URL, getSelectedModelFallback, resolveModelRoleRuntime } = require('../runtimeStewardship');
const { loadChunks }                                  = require('../indexStore');
const { retrieve, buildGroundedPrompt, detectRoute }  = require('../retrieval');
const { buildSignalTrace, formatSignalTraceSummary }  = require('../signalTrace');
const { getCourtMember, MAX_COURT_MEMBER_RETRIEVAL_TOP_K } = require('../courtConfig');
const {
    loadRollingBootstrap,
    loadArchetype,
    formatArchetypeForPrompt,
} = require('../bootstrap');
const { loadSentinelLoadoutPromptSummary } = require('../bootstrap/sentinelLoadoutBootstrap');
const { listLoadedCaches } = require('../loadedCaches');
const {
    loadCacheSummaries,
    loadDocumentSummaries,
    getArchetypeMemoryProfile,
} = require('../memoryCompression');
const {
    resolveCognitionProfile,
    buildCognitionProfilePromptSummary,
    applyCognitionProfileInfluence,
} = require('../runtime/cognitionProfiles');

const router = express.Router();
const PARTIAL_CONTEXT_CHUNK_THRESHOLD = 2;
const CHAT_REQUEST_TIMEOUT_MS = 120000;
// Tuning target: keep raw grounding in the 4–8 range for faster starts.
const MAX_CHAT_CONTEXT_CHUNKS = 8;
const MAX_CHAT_CONTEXT_CHARS = 16000;
const MAX_CHAT_CHUNK_CHARS = 2200;
const MAX_CHAT_HISTORY_CHARS = 4000;
const MAX_CHAT_HISTORY_TURNS = 8;
// Tuning target: compact Signal Trace routing/context lists.
const MAX_SIGNAL_TRACE_SOURCES = 5;
const MAX_SIGNAL_TRACE_ROUTING_LIST = 4;
const CHARS_PER_TOKEN_ESTIMATE = 4;
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
        retrievalTopK: 2,
        targetSources: 1,
        maxRawChunks: 2,
        minRawChunksWithSummary: 1,
        maxContextChars: 3200,
        maxChunkChars: 1000,
        maxHistoryChars: 500,
        maxHistoryTurns: 1,
        maxSummaryChars: 320,
        rollingBootstrapChars: 0,
        sentinelLoadoutChars: 180,
        cacheSummaryLimit: 1,
        documentSummaryLimit: 0,
        sourceLineLimit: 1,
        includeArchetypeMemory: false,
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
        sentinelLoadoutChars: 220,
        cacheSummaryLimit: 2,
        documentSummaryLimit: 2,
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
        sentinelLoadoutChars: 280,
        cacheSummaryLimit: 3,
        documentSummaryLimit: 3,
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
        sentinelLoadoutChars: 320,
        cacheSummaryLimit: 4,
        documentSummaryLimit: 4,
        sourceLineLimit: 5,
        includeArchetypeMemory: true,
    },
});
const DEFAULT_CONTEXT_BUDGET_PROFILE = CONTEXT_BUDGET_PROFILES.ember;
const RETRIEVAL_DISCIPLINE_PROFILES = Object.freeze({
    spark: {
        loadedCacheBoost: 1.24,
        nonLoadedArchivePenalty: 0.86,
    },
    ember: {
        loadedCacheBoost: 1.12,
        nonLoadedArchivePenalty: 0.95,
    },
    hearth: {
        loadedCacheBoost: 1.08,
        nonLoadedArchivePenalty: 0.98,
    },
    archive: {
        loadedCacheBoost: 1.06,
        nonLoadedArchivePenalty: 1,
    },
});
const LOADOUT_FOCUS_DISCIPLINE_PROFILES = Object.freeze({
    spark: {
        loadedCacheBoost: 1.42,
        nonLoadedArchivePenalty: 0.72,
    },
    ember: {
        loadedCacheBoost: 1.3,
        nonLoadedArchivePenalty: 0.82,
    },
    hearth: {
        loadedCacheBoost: 1.12,
        nonLoadedArchivePenalty: 0.95,
    },
    archive: {
        loadedCacheBoost: 1.08,
        nonLoadedArchivePenalty: 0.97,
    },
});
const RUNTIME_GENERATION_PROFILES = Object.freeze({
    spark: {
        numPredict: 180,
        temperature: 0.55,
    },
    ember: {
        numPredict: 560,
        temperature: 0.68,
    },
    hearth: {
        numPredict: 1200,
        temperature: 0.72,
    },
    archive: {
        numPredict: 1700,
        temperature: 0.74,
    },
});
const SPARK_NUDGE_MAX_CHARS = 520;
const EMBER_NUDGE_MAX_CHARS = 320;
// Trace/debug confidence hints: compact baseline + retrieval sharpness + continuity density.
const CONFIDENCE_STATE_BASELINE_WEIGHT = 0.72;
const CONFIDENCE_RAW_SCORE_WEIGHT = 0.28;
const CONTINUITY_SUMMARY_DENSITY_DIVISOR = 3;
const CONTINUITY_SUMMARY_WEIGHT = 0.45;
const CONTINUITY_SOURCE_SPREAD_WEIGHT = 0.2;
const CONTINUITY_CACHE_OVERLAP_WEIGHT = 0.35;
const RESPONSE_SELF_CHECK_COMPACT_PROFILES = new Set(['spark-compression', 'minimal-retrieval', 'field-guide']);

function normalizeRoom(room) {
    // Legacy migration alias. Remove after user data migration stabilizes.
    return room;
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

function normalizeBooleanToggle(value, fallback = false) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') {
        if (value === 1) return true;
        if (value === 0) return false;
        return fallback;
    }
    if (typeof value !== 'string') return fallback;
    const normalized = value.trim().toLowerCase();
    if (!normalized) return fallback;
    if (['true', '1', 'yes', 'on', 'enabled'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off', 'disabled'].includes(normalized)) return false;
    return fallback;
}

function formatModelRoleLabel(role, fallbackUsed = false) {
    const normalized = String(role || '').trim().toLowerCase();
    const base = normalized === 'forge'
        ? 'Forge'
        : normalized === 'scribe'
            ? 'Scribe'
            : 'Hearth';
    if (fallbackUsed) return base + ' fallback';
    return base;
}

function formatModelFallbackNote(runtime) {
    const safe = runtime && typeof runtime === 'object' ? runtime : {};
    if (!safe.fallbackUsed) return '';
    const roleLabel = formatModelRoleLabel(safe.modelRole, false);
    const reason = String(safe.fallbackReason || '').trim();
    if (reason === 'role_model_not_installed') return `Fallback: ${roleLabel} role model unavailable`;
    if (reason === 'role_model_blank') return `Fallback: ${roleLabel} role model unset`;
    if (reason === 'selected_model_not_installed') return 'Fallback: selected model unavailable';
    return `Fallback: ${roleLabel} model fallback`;
}

function buildDistillationGuidanceBlock() {
    return `=== Distillation Guidance Mode ===
Mentor stance: practical, reflective, and non-gamey.
Goal: support human-guided continuity distillation, not automatic cache evolution.
Do not auto-merge, auto-delete, auto-distill tiers, or rewrite continuity.
Treat distillation as continuity refinement.
Treat caches as distilled continuity artifacts, not random bundles.
Honor lifecycle continuity: conversation → markdown → cache → distillation.
Refine cache creation flow when useful: gather → review → summarize → distill → structure → package.
Help identify overlap, repeated concepts, redundancy, strongest signal, and synthesis opportunities.
Evaluate distillation readiness lightly:
- overlap
- clarity
- redundancy
- signal density
- missing perspectives
Surface missing perspectives when present:
- missing archetype comparison (for example Builder-heavy lacking Scholar comparison)
- missing continuity domains
- missing practical grounding examples
- missing narrative cohesion
When weak signal appears, guide constructively (mentor tone, no authoritarian grading):
- unclear purpose summary
- repeated summaries
- scope too broad
- insufficient source grounding
- minimal synthesis
- AI output without review
When high signal appears, reinforce it naturally:
- clear purpose summary
- compact summaries
- distinct themes
- cross-domain synthesis
- practical grounding
- strong distillation
Create Cache guidance questions (keep concise):
- What continuity should this cache preserve?
- What sources shaped this synthesis?
- What perspectives are intentionally included?
Name compression opportunities explicitly and ask compact guidance questions:
- What continuity appears repeatedly across these caches?
- Which ideas remain useful after compression?
- Which missing perspectives should be reviewed before distillation?
- Which archetype review would strengthen continuity quality right now?
End with concise Suggested Next Steps (for example: Load into Forge, Review through Scholar, Distill overlapping Sparks, Add practical field notes, Compress repeated summaries).
When giving distillation guidance, preserve Sentinel choice and frame recommendations as optional.

`;
}

function resolveRetrievalDiscipline(depthId, loadoutFocus = false) {
    const fallback = RETRIEVAL_DISCIPLINE_PROFILES.ember;
    const profileSet = loadoutFocus
        ? LOADOUT_FOCUS_DISCIPLINE_PROFILES
        : RETRIEVAL_DISCIPLINE_PROFILES;
    const key = profileSet[depthId] ? depthId : 'ember';
    return profileSet[key] || profileSet.ember || fallback;
}

function resolveGenerationProfile(depthId) {
    const key = RUNTIME_GENERATION_PROFILES[depthId] ? depthId : 'ember';
    return RUNTIME_GENERATION_PROFILES[key] || RUNTIME_GENERATION_PROFILES.ember;
}

function isOllamaRuntime(runtime) {
    const runtimeId = String((runtime && runtime.runtimeId) || '').trim().toLowerCase();
    return runtimeId === 'ollama-local' || runtimeId.startsWith('ollama-');
}

const HEART_SYSTEM_PROMPT = (
    'You are Hearth, a continuity mentor for writing and synthesis inside an Ember Node.\n' +
    'Use compressed identity and context. Do not lecture or repeat philosophy.\n' +
    'Do not restate Green Fire philosophy unless the user explicitly asks for it.\n' +
    'Answer directly, then add only necessary support, then optional next step.\n' +
    'Use markdown-first structure. Avoid roleplay, boilerplate, and long preambles.\n' +
    'Treat retrieval state markers as hard runtime context for confidence and brevity.\n' +
    'Guide with concise questions when useful. The user remains final authority.'
);

/** Room-specific system prompts for room-bounded context */
const ROOM_SYSTEM_PROMPTS = {
    hearth: HEART_SYSTEM_PROMPT,
    council: (
        HEART_SYSTEM_PROMPT + '\nCouncil mode: prioritize drafting, structure, and practical weave for active work.'
    ),
    threshold: (
        HEART_SYSTEM_PROMPT + '\nThreshold mode: prioritize intake clarity, classification, and concise admission guidance.'
    ),
};

function optimizeRetrievedContext(retrievedChunks, contextBudget, retrievalTopK) {
    if (!Array.isArray(retrievedChunks) || retrievedChunks.length === 0) return [];
    const boundedTopK = Number.isFinite(retrievalTopK)
        ? Math.max(1, Math.floor(retrievalTopK))
        : Number.POSITIVE_INFINITY;
    const maxOptimizedChunks = Math.max(
        1,
        Math.min(
            boundedTopK,
            Number.isFinite(contextBudget && contextBudget.retrievalTopK)
                ? Math.floor(contextBudget.retrievalTopK)
                : MAX_CHAT_CONTEXT_CHUNKS,
        ),
    );
    const maxContextChars = Number.isFinite(contextBudget && contextBudget.maxContextChars)
        ? Math.max(800, Math.floor(contextBudget.maxContextChars))
        : MAX_CHAT_CONTEXT_CHARS;
    const maxChunkChars = Number.isFinite(contextBudget && contextBudget.maxChunkChars)
        ? Math.max(300, Math.floor(contextBudget.maxChunkChars))
        : MAX_CHAT_CHUNK_CHARS;
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
        if (optimized.length >= maxOptimizedChunks) break;
        if (totalChars >= maxContextChars) break;

        const remaining = maxContextChars - totalChars;
        if (text.length > remaining && remaining < 400) break;

        const boundedText = text.length > maxChunkChars
            ? text.slice(0, maxChunkChars)
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
const COMPACT_ARCHETYPE_DELTAS = Object.freeze({
    builder: 'Practical compression first. Keep steps buildable and concise.',
    scholar: 'Use brief comparison and references when uncertainty matters.',
    scribe: 'Prioritize clarity and continuity flow with compact structure.',
    warrior: 'Keep synthesis decisive, bounded, and operationally clear.',
    mystic: 'Use symbolic interpretation sparingly, grounded to concrete context.',
});

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
    const lens = member ? (extractCourtLensLabel(member) || member.id) : 'Ember Prime';
    const glyph = member ? (COURT_MEMBER_GLYPHS[member.id] || '') : '';
    const deltaLine = member
        ? (COMPACT_ARCHETYPE_DELTAS[member.id] || '')
        : String((promptModifier && promptModifier.posture) || (profile && profile.reasoningPosture) || '').trim();
    const avoid = String((promptModifier && promptModifier.avoid) || '').trim();
    return [
        'Archetype Delta: ' + (glyph ? glyph + ' ' : '') + lens,
        deltaLine,
        avoid ? ('Constraint: ' + avoid) : '',
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
 * @param {string} options.sentinelLoadoutSummary
 * @param {string|null} options.activeArchetype
 * @param {object[]} options.sourceTrace
 * @param {number} [options.maxSummaryChars]
 * @returns {{ block: string, summaryLayersUsed: { archetypeMemory: number, cacheSummaries: number, documentSummaries: number } }}
 */
function buildSummaryFirstContext({
    query,
    rollingBootstrap,
    sentinelLoadoutSummary,
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
        ? Math.max(0, Math.floor(summaryLimits.cacheSummaryLimit))
        : null;
    const maxDocumentSummaryLimit = Number.isFinite(summaryLimits && summaryLimits.documentSummaryLimit)
        ? Math.max(0, Math.floor(summaryLimits.documentSummaryLimit))
        : null;
    const maxSourceLineLimit = Number.isFinite(summaryLimits && summaryLimits.sourceLineLimit)
        ? Math.max(1, Math.floor(summaryLimits.sourceLineLimit))
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
        sentinelLoadout: 0,
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

    if (hasValidBootstrapSummary(rollingBootstrap) && maxRollingBootstrapChars > 0) {
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

    if (sentinelLoadoutSummary) {
        pushBlock('Sentinel Loadout', String(sentinelLoadoutSummary).trim(), 'sentinelLoadout');
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

function buildDepthResponseInstruction(contextBudget) {
    const depthId = contextBudget && contextBudget.id ? contextBudget.id : 'ember';
    if (depthId === 'spark') {
        return [
            'Response Depth: Spark',
            'Hard rule: concise orientation only.',
            'Output target: direct answer in 1–2 short paragraphs or up to 4 concise bullets.',
            'Answer directly first.',
            'Deliver one clear answer, one useful next step max, and one reflection/question max.',
            'Use minimal retrieval and strongest loaded continuity signal before broader archive sweep.',
            'Mentor pacing: concise orientation, no lecture framing.',
            'Avoid essays, layered tangents, or repeated philosophy restatement unless asked.',
            'If deeper context exists, one situational continuation line is allowed.',
        ].join('\n');
    }
    if (depthId === 'ember') {
        return [
            'Response Depth: Ember',
            'Balanced synthesis.',
            'Output target: 3–7 paragraphs or structured bullets that include practical framing and one concrete next step when useful.',
            'Use moderate retrieval breadth; stay practical and avoid sprawling archive lecture.',
            'Mentor pacing: balanced guidance with compact reflective steering.',
            'Avoid repeated Green Fire philosophy restatement unless user asks for it directly.',
            'If deeper context exists, one subtle continuation line is optional.',
        ].join('\n');
    }
    if (depthId === 'hearth') {
        return [
            'Response Depth: Hearth',
            'Deeper teaching and layered continuity synthesis allowed.',
            'Mentor pacing: deeper instruction and reflective questioning are welcome.',
            'Organize with headings when helpful and stay grounded in retrieved context.',
            'Avoid redundant philosophy repetition unless it advances the answer.',
        ].join('\n');
    }
    return [
        'Response Depth: Archive',
        'Broad archive weave allowed.',
        'Long-form synthesis is acceptable when it improves fidelity.',
        'Mentor pacing: continuity mapping across sources and layers.',
    ].join('\n');
}

function countSummaryLayers(summaryLayersUsed) {
    if (!summaryLayersUsed || typeof summaryLayersUsed !== 'object') return 0;
    return ['cacheSummaries', 'documentSummaries']
        .map(key => Number.isFinite(summaryLayersUsed[key]) ? summaryLayersUsed[key] : 0)
        .reduce((total, current) => total + current, 0);
}

function shouldAppendDeeperDepthNudge({ depthId, answer, retrievedCount, rawChunkCount, summaryLayersUsed }) {
    return false;
    /* disabled: avoid repetitive templated footers */
    if (!['spark', 'ember'].includes(depthId)) return false;
    const text = String(answer || '').trim();
    if (!text) return false;
    if (/load a deeper depth if you want the wider weave/i.test(text)) return false;
    const totalRetrieved = Number.isFinite(retrievedCount) ? retrievedCount : 0;
    const usedRawChunks = Number.isFinite(rawChunkCount) ? rawChunkCount : 0;
    const summariesUsed = countSummaryLayers(summaryLayersUsed);
    const hasMoreDepthAvailable = totalRetrieved > usedRawChunks || summariesUsed > 1;
    if (!hasMoreDepthAvailable) return false;
    if (depthId === 'spark') return text.length <= SPARK_NUDGE_MAX_CHARS;
    return text.length <= EMBER_NUDGE_MAX_CHARS;
}

function detectQueryMode(query) {
    const text = String(query || '').trim().toLowerCase();
    if (!text) return 'information';
    if (/\b(reflect|reflection|journal|feel|feeling|meaning)\b/.test(text)) return 'reflection';
    if (/\b(summary|summarize|recap|continue|continuity|carry forward|remember)\b/.test(text)) return 'continuity';
    if (/\b(plan|planning|approach|options|tradeoff|risk|recommend|should i|which)\b/.test(text)) return 'planning';
    return 'information';
}

function buildQueryModeInstruction(mode) {
    if (mode === 'planning') {
        return [
            '=== Query Mode: Planning ===',
            'Prioritize: Recommendation, Options, Risks.',
            'Keep reflection optional unless requested.',
            '',
        ].join('\n');
    }
    if (mode === 'reflection') {
        return [
            '=== Query Mode: Reflection ===',
            'Reflection prompts are appropriate.',
            'Keep guidance grounded and concise.',
            '',
        ].join('\n');
    }
    if (mode === 'continuity') {
        return [
            '=== Query Mode: Continuity ===',
            'Prioritize concise summarization and carry-forward clarity.',
            '',
        ].join('\n');
    }
    return [
        '=== Query Mode: Information ===',
        'Answer directly first and avoid forced reflection prompts.',
        '',
    ].join('\n');
}

function buildResponseSelfCheckInstruction({
    contextBudget,
    runtimeProfileId,
    loadoutFocusEnabled,
}) {
    const depthId = contextBudget && contextBudget.id ? contextBudget.id : 'ember';
    const runtimeId = String(runtimeProfileId || '').trim().toLowerCase();
    const shouldApply = depthId === 'spark' || loadoutFocusEnabled || RESPONSE_SELF_CHECK_COMPACT_PROFILES.has(runtimeId);
    if (!shouldApply) return '';
    return [
        '=== Response Self-Check ===',
        'Answer only what was asked.',
        'Prefer the strongest continuity signal.',
        'Avoid unnecessary exposition.',
        '',
    ].join('\n');
}

function buildRetrievalRestraintInstruction({
    retrievalState,
    contextBudget,
}) {
    const depthId = contextBudget && contextBudget.id ? contextBudget.id : 'ember';
    if (![RETRIEVAL_STATES.PARTIAL_CONTEXT, RETRIEVAL_STATES.MISSING_SOURCE, RETRIEVAL_STATES.NO_CONTEXT, RETRIEVAL_STATES.RETRIEVAL_ERROR].includes(retrievalState)) {
        return '';
    }
    const guidance = [
        '=== Retrieval Restraint ===',
        'Carry only grounded continuity.',
        'If confidence is weak, state uncertainty concisely.',
        'Ask one clarifying question when needed.',
        'Use limited synthesis; do not invent broad continuity essays.',
        'Mentor posture example: “I only carry partial continuity on this thread. A Scholar review or broader archive depth may strengthen the synthesis.”',
    ];
    if (depthId === 'spark') {
        guidance.push('Spark constraint: keep this to one compact uncertainty line max.');
    }
    guidance.push('');
    return guidance.join('\n');
}

function formatContinuationNudge({
    selectedCourtMember,
    retrievalState,
}) {
    if ([RETRIEVAL_STATES.PARTIAL_CONTEXT, RETRIEVAL_STATES.MISSING_SOURCE, RETRIEVAL_STATES.NO_CONTEXT, RETRIEVAL_STATES.RETRIEVAL_ERROR].includes(retrievalState)) {
        return 'A Scholar comparison may reveal missing continuity.';
    }
    if (selectedCourtMember && selectedCourtMember.id) {
        return 'A different lens may reveal additional continuity.';
    }
    return 'Use deeper depth only if you want a wider weave.';
}

function computeRuntimeConfidenceHints({
    retrievalState,
    retrieved,
    rawChunksForPrompt,
    summaryFirst,
    loadedCaches,
}) {
    const stateBaseline = retrievalState === RETRIEVAL_STATES.CONTEXT_AVAILABLE
        ? 0.88
        : retrievalState === RETRIEVAL_STATES.PARTIAL_CONTEXT
            ? 0.58
            : retrievalState === RETRIEVAL_STATES.MISSING_SOURCE
                ? 0.42
                : retrievalState === RETRIEVAL_STATES.NO_CONTEXT
                    ? 0.3
                    : 0.26;
    const rawScores = Array.isArray(rawChunksForPrompt)
        ? rawChunksForPrompt
            .map(entry => Number(entry && entry.score))
            .filter(Number.isFinite)
        : [];
    const avgRawScore = rawScores.length > 0
        ? rawScores.reduce((sum, value) => sum + value, 0) / rawScores.length
        : 0;
    const retrievalConfidence = Math.max(
        0,
        Math.min(
            1,
            (stateBaseline * CONFIDENCE_STATE_BASELINE_WEIGHT) +
            (Math.min(1, avgRawScore) * CONFIDENCE_RAW_SCORE_WEIGHT),
        ),
    );
    const loadedCount = Array.isArray(rawChunksForPrompt)
        ? rawChunksForPrompt.filter(entry => Boolean(entry && entry.loadedCacheMatch)).length
        : 0;
    const cacheOverlapStrength = rawChunksForPrompt.length > 0
        ? loadedCount / rawChunksForPrompt.length
        : 0;
    const cacheSummariesCount = summaryFirst && summaryFirst.summaryLayersUsed
        ? Number(summaryFirst.summaryLayersUsed.cacheSummaries || 0)
        : 0;
    const documentSummariesCount = summaryFirst && summaryFirst.summaryLayersUsed
        ? Number(summaryFirst.summaryLayersUsed.documentSummaries || 0)
        : 0;
    const summaryCount = cacheSummariesCount + documentSummariesCount;
    const uniqueSourceCount = new Set((retrieved || [])
        .map(entry => entry && entry.chunk && entry.chunk.sourceId)
        .filter(Boolean)).size;
    const summaryContribution = (summaryCount > 0
        ? Math.min(1, summaryCount / CONTINUITY_SUMMARY_DENSITY_DIVISOR)
        : 0) * CONTINUITY_SUMMARY_WEIGHT;
    const sourceSpreadContribution = (uniqueSourceCount > 0
        ? Math.min(1, Math.max(0.2, 1 / uniqueSourceCount))
        : 0) * CONTINUITY_SOURCE_SPREAD_WEIGHT;
    const cacheOverlapContribution = cacheOverlapStrength * CONTINUITY_CACHE_OVERLAP_WEIGHT;
    // Keep confidence hints compact and stable:
    // - summaryCount divisor caps value quickly to avoid inflating dense prompts
    // - bounded inverse source spread (max 1, min 0.2) avoids sparse-result collapse
    // - weights prioritize summary/cached continuity signals over raw source spread
    const continuityDensity = Math.max(
        0,
        Math.min(1, summaryContribution + sourceSpreadContribution + cacheOverlapContribution),
    );
    return {
        retrievalConfidence: Math.round(retrievalConfidence * 100) / 100,
        cacheOverlapStrength: Math.round(cacheOverlapStrength * 100) / 100,
        continuityDensity: Math.round(continuityDensity * 100) / 100,
        loadedCacheHits: loadedCount,
        loadedCacheCount: Array.isArray(loadedCaches) ? loadedCaches.length : 0,
    };
}

function summaryBudgetForContext(contextBudget) {
    const cacheLimit = Number.isFinite(contextBudget && contextBudget.cacheSummaryLimit)
        ? Math.max(0, Math.floor(contextBudget.cacheSummaryLimit))
        : 0;
    const documentLimit = Number.isFinite(contextBudget && contextBudget.documentSummaryLimit)
        ? Math.max(0, Math.floor(contextBudget.documentSummaryLimit))
        : 0;
    return cacheLimit + documentLimit;
}

function formatBudgetLabel(count, singular, plural) {
    return count + ' ' + (count === 1 ? singular : plural);
}

function partialContextThresholdForBudget(contextBudget) {
    const maxRaw = Number.isFinite(contextBudget && contextBudget.maxRawChunks)
        ? Math.max(1, Math.floor(contextBudget.maxRawChunks))
        : PARTIAL_CONTEXT_CHUNK_THRESHOLD;
    return Math.max(1, Math.min(PARTIAL_CONTEXT_CHUNK_THRESHOLD, maxRaw - 1));
}

function computeRawChunkBudgetWithSummaries(archetypeProfile, contextBudget, maxRawChunksOverride = null) {
    const geometry = getArchetypeRetrievalGeometry(archetypeProfile);
    const configured = Number.isFinite(geometry.raw_chunk_target)
        ? Math.floor(geometry.raw_chunk_target)
        : null;
    const maxRawChunks = Number.isFinite(maxRawChunksOverride)
        ? Math.max(1, Math.floor(maxRawChunksOverride))
        : Number.isFinite(contextBudget && contextBudget.maxRawChunks)
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

// ── Legacy chat endpoint (kept for backward compatibility) ────────────────────
// This endpoint bypasses retrieval and goes directly to Ollama.
// New code should use POST /api/chat which routes through Model Roles
// with grounded retrieval. Kept to avoid breaking any existing integrations.

router.post('/chat', async (req, res) => {
    try {
        const { message, prompt, model: _ignored, ...rest } = req.body;
        const selectedModel = getSelectedModelFallback();
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

// ── Grounded chat (retrieval + Model Roles) ───────────────────────────────────

/**
 * POST /api/chat
 * Body: { query, room?, rooms?, cacheId?, sourceIds?, archetype?, courtMember?, history?, responseDepth?, distillationGuidance? }
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
            taskType = null,
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
            loadoutFocus = false,
            runtimeProfile = null,
            distillationGuidance = false,
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
        const baseRetrievalTopK = Math.max(
            contextBudget.retrievalTopK,
            getRetrievalTopKForCourtMember(selectedCourtMember),
        );
        const loadoutFocusEnabled = normalizeBooleanToggle(loadoutFocus, false);
        const distillationGuidanceEnabled = normalizeBooleanToggle(distillationGuidance, false);
        const baseRetrievalDiscipline = resolveRetrievalDiscipline(contextBudget.id, loadoutFocusEnabled);
        const baseRuntimeGenerationProfile = resolveGenerationProfile(contextBudget.id);
        const selectedCognitionProfile = resolveCognitionProfile(runtimeProfile);
        const cognitionInfluence = applyCognitionProfileInfluence({
            cognitionProfile: selectedCognitionProfile,
            retrievalTopK: baseRetrievalTopK,
            targetSources: contextBudget.targetSources,
            maxRawChunks: contextBudget.maxRawChunks,
            retrievalDiscipline: baseRetrievalDiscipline,
            runtimeGenerationProfile: baseRuntimeGenerationProfile,
        });
        const retrievalTopK = cognitionInfluence.retrievalTopK;
        const retrievalDiscipline = cognitionInfluence.retrievalDiscipline;
        const runtimeGenerationProfile = cognitionInfluence.runtimeGenerationProfile;
        const runtimeProfileLabel = selectedCognitionProfile.label;
        const effectiveMaxRawChunks = cognitionInfluence.maxRawChunks;
        const contextBudgetForRuntime = {
            ...contextBudget,
            retrievalTopK,
            targetSources: cognitionInfluence.targetSources,
            maxRawChunks: effectiveMaxRawChunks,
        };

        // Determine active room for context pools and system prompt
        const requestedRoom = normalizeRoom(room);
        const activeRoom = (requestedRoom && ['hearth', 'council', 'threshold'].includes(requestedRoom))
            ? requestedRoom
            : 'hearth';
        const queryMode = detectQueryMode(query);
        const lensModeEnabled = Boolean(selectedCourtMember) ||
            activeRoom === 'council' ||
            /\b(council|archetype|lens)\b/i.test(String(query || ''));

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
                targetSources: contextBudgetForRuntime.targetSources,
                routeHint: detectedRoute,
                courtMember: selectedCourtMember,
                archetypeMemoryProfile,
                retrievalDiscipline,
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
        retrieved = optimizeRetrievedContext(retrieved, contextBudgetForRuntime, retrievalTopK);

        if (retrievalState !== RETRIEVAL_STATES.RETRIEVAL_ERROR) {
            if (retrieved.length === 0) {
                retrievalState = missingPinnedSources.length > 0
                    ? RETRIEVAL_STATES.MISSING_SOURCE
                    : RETRIEVAL_STATES.NO_CONTEXT;
            } else if (
                missingPinnedSources.length > 0 ||
                retrieved.length <= partialContextThresholdForBudget(contextBudgetForRuntime)
            ) {
                retrievalState = RETRIEVAL_STATES.PARTIAL_CONTEXT;
            }
        }

        const sources = buildSignalTrace(retrieved);

        // Prompt assembly order:
        // Base runtime instruction (system prompt) → Sentinel summary →
        // archetype delta → depth instruction → minimal retrieval context → user message

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

        // Retrieval context (after identity/continuity layers)
        const rollingBootstrapForPrompt = rollingBootstrapStatus === 'ready' ? rollingBootstrap : null;
        const sentinelLoadoutSummary = contextBudget.sentinelLoadoutChars > 0
            ? loadSentinelLoadoutPromptSummary(contextBudget.sentinelLoadoutChars, {
                activeArchetype: activeArchetypeForMemory,
                depth: contextBudget.id,
                runtimeProfile: selectedCognitionProfile.id,
            })
            : '';
        const summaryFirst = buildSummaryFirstContext({
            query,
            rollingBootstrap: rollingBootstrapForPrompt,
            sentinelLoadoutSummary,
            activeArchetype: activeArchetypeForMemory,
            sourceTrace: sources,
            maxSummaryChars: contextBudget.maxSummaryChars,
            maxRollingBootstrapChars: contextBudget.rollingBootstrapChars,
            includeArchetypeMemory: contextBudget.includeArchetypeMemory && lensModeEnabled,
            summaryLimits: {
                cacheSummaryLimit: contextBudget.cacheSummaryLimit,
                documentSummaryLimit: contextBudget.documentSummaryLimit,
                sourceLineLimit: contextBudget.sourceLineLimit,
            },
        });
        const rawChunksForPrompt = summaryFirst.block
            ? retrieved.slice(0, computeRawChunkBudgetWithSummaries(
                archetypeMemoryProfile,
                contextBudgetForRuntime,
                effectiveMaxRawChunks,
            ))
            : retrieved.slice(0, effectiveMaxRawChunks);
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
        // Sentinel summary → archetype delta → depth discipline → retrieval
        const sentinelIdentityPart = sentinelLoadoutSummary
            ? `=== Sentinel Loadout Bootstrap Summary ===\n${String(sentinelLoadoutSummary).trim()}`
            : '';
        // Prefer the compact archetype modifier from archetype-memory tuning.
        // Fall back to legacy archetype formatter only when compact data is unavailable.
        const fallbackArchetypePart = archetypeObj ? formatArchetypeForPrompt(archetypeObj) : '';
        const compactArchetypePart = buildArchetypePromptModifier(
            selectedCourtMember,
            archetypeMemoryProfile,
        );
        const archetypePart = lensModeEnabled ? (compactArchetypePart || fallbackArchetypePart) : '';

        const identityPreamble = [sentinelIdentityPart, archetypePart]
            .filter(Boolean)
            .join('\n\n');

        if (identityPreamble) {
            userContent = identityPreamble + '\n\n' + userContent;
        }

        const retrievalStateBlock = `=== Retrieval State ===
State: ${retrievalState}
Loadout Focus: ${loadoutFocusEnabled ? 'ON' : 'OFF'}

`;
        const depthInstructionBlock = `=== Response Depth Instruction ===
${buildDepthResponseInstruction(contextBudget)}

`;
        const queryModeInstructionBlock = buildQueryModeInstruction(queryMode);
        const runtimeProfileBlock = `=== Runtime Profile ===
${buildCognitionProfilePromptSummary(selectedCognitionProfile)}

`;
        const responseSelfCheckBlock = buildResponseSelfCheckInstruction({
            contextBudget,
            runtimeProfileId: selectedCognitionProfile.id,
            loadoutFocusEnabled,
        });
        const retrievalRestraintBlock = buildRetrievalRestraintInstruction({
            retrievalState,
            contextBudget,
        });
        const distillationGuidanceBlock = distillationGuidanceEnabled
            ? buildDistillationGuidanceBlock()
            : '';
        userContent = retrievalStateBlock +
            runtimeProfileBlock +
            depthInstructionBlock +
            queryModeInstructionBlock +
            responseSelfCheckBlock +
            retrievalRestraintBlock +
            distillationGuidanceBlock +
            userContent;

        // Select room-appropriate system prompt
        const systemPrompt = ROOM_SYSTEM_PROMPTS[activeRoom] || HEART_SYSTEM_PROMPT;

        // Resolve local runtime model via Model Role routing (Ollama-first).
        const heart = await resolveModelRoleRuntime({
            depth: contextBudget.id,
            query,
            taskType,
        });

        const payload = {
            model:    heart.model,
            stream:   false,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user',   content: userContent },
            ],
        };
        if (isOllamaRuntime(heart) && runtimeGenerationProfile) {
            payload.options = {
                num_predict: runtimeGenerationProfile.numPredict,
                temperature: runtimeGenerationProfile.temperature,
            };
        }

        const promptAudit = {
            systemPromptLength: systemPrompt.length,
            rollingBootstrapLength: (
                sentinelIdentityPart.length +
                (summaryFirst.segmentLengths ? summaryFirst.segmentLengths.sentinelLoadout : 0) +
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
                const roleLabel = formatModelRoleLabel(heart && heart.modelRole, false);
                return res.status(504).json({
                    error: 'Generation timed out',
                    timeout: true,
                    requestId: normalizedRequestId,
                    message: roleLabel + ' model is taking longer than usual. You may wait or still the signal.',
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
        const continuationNudge = formatContinuationNudge({
            selectedCourtMember,
            retrievalState,
        });
        const answerWithDepthNudge = shouldAppendDeeperDepthNudge({
            depthId: contextBudget.id,
            answer,
            retrievedCount: retrieved.length,
            rawChunkCount: rawChunksForPrompt.length,
            summaryLayersUsed: summaryFirst.summaryLayersUsed,
        })
            ? (String(answer || '').trimEnd() + '\n\n' + continuationNudge)
            : answer;
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
        const runtimeConfidenceHints = computeRuntimeConfidenceHints({
            retrievalState,
            retrieved,
            rawChunksForPrompt,
            summaryFirst,
            loadedCaches,
        });
        const lensName = selectedCourtMember ? extractCourtLensLabel(selectedCourtMember) : 'Ember Prime';
        const lensGlyph = selectedCourtMember ? (COURT_MEMBER_GLYPHS[selectedCourtMember.id] || '') : '';
        const courtSourcesConsidered = courtPrioritySourcesConsidered.length > 0
            ? courtPrioritySourcesConsidered
            : (selectedCourtMember && Array.isArray(selectedCourtMember.prioritySources)
                ? selectedCourtMember.prioritySources.map(String).slice(0, MAX_SIGNAL_TRACE_ROUTING_LIST)
                : []);
        const compactSignalTrace = contextBudget.id === 'spark'
            ? [
                'Depth: ' + contextBudget.label,
                'Runtime Profile: ' + runtimeProfileLabel,
                'Predict: ' + runtimeGenerationProfile.numPredict,
                'Chunks: ' + rawChunksForPrompt.length,
                'Summaries: ' + summaryBudgetForContext(contextBudget),
                'Loadout Focus: ' + (loadoutFocusEnabled ? 'ON' : 'OFF'),
                'Distillation Guidance: ' + (distillationGuidanceEnabled ? 'ON' : 'OFF'),
                'Confidence: ' + runtimeConfidenceHints.retrievalConfidence +
                    ' · overlap ' + runtimeConfidenceHints.cacheOverlapStrength,
                'Budget: ' + formatBudgetLabel(effectiveMaxRawChunks, 'chunk', 'chunks') +
                    ' · ' + formatBudgetLabel(summaryBudgetForContext(contextBudget), 'summary', 'summaries'),
                'Bootstrap: compact',
                'Caches Loaded: ' + loadedCaches.length,
                'Route: ' + ([detectedRoute || 'general'].concat(relatedDomains).slice(0, 1).join(' → ')),
                'Context: ' + (sourceList.length > 0 ? sourceList.slice(0, 2).join(', ') : 'none'),
                'Model: ' + heart.model + ' / Ollama',
            ].join('\n')
            : [
                'Active archetype: ' + (
                    selectedCourtMember
                        ? ((lensGlyph ? (lensGlyph + ' ') : '') + lensName)
                        : 'Ember Prime'
                ),
                'Depth: ' + contextBudget.label,
                'Runtime Profile: ' + runtimeProfileLabel,
                'Predict: ' + runtimeGenerationProfile.numPredict,
                'Chunks: ' + rawChunksForPrompt.length,
                'Summaries: ' + summaryBudgetForContext(contextBudget),
                'Loadout Focus: ' + (loadoutFocusEnabled ? 'ON' : 'OFF'),
                'Distillation Guidance: ' + (distillationGuidanceEnabled ? 'ON' : 'OFF'),
                'Confidence: ' + runtimeConfidenceHints.retrievalConfidence +
                    ' · overlap ' + runtimeConfidenceHints.cacheOverlapStrength +
                    ' · continuity ' + runtimeConfidenceHints.continuityDensity,
                'Route: ' + ([detectedRoute || 'general'].concat(relatedDomains).slice(0, 2).join(' → ')),
                'Memory: bootstrap ' + rollingBootstrapStatus + ' · summaries ' +
                    (summaryFirst.summaryLayersUsed.cacheSummaries + summaryFirst.summaryLayersUsed.documentSummaries) +
                    ' · chunks ' + rawChunksForPrompt.length,
                'Cache Loadout: ' + loadedCaches.length + ' loaded',
                'Bootstrap: compact',
                'Loaded Caches: ' + (cacheLoadoutNames.length > 0 ? cacheLoadoutNames.join(', ') : 'none'),
                'Context: ' + (sourceList.length > 0 ? sourceList.join(', ') : 'none'),
                'Runtime: ~' + Math.ceil(promptAudit.finalPromptLength / CHARS_PER_TOKEN_ESTIMATE) +
                    ' tok · bootstrap ' + (sentinelIdentityPart ? 'on' : 'off') +
                    ' · archetype ' + (archetypePart ? 'on' : 'off'),
                'Model: ' + heart.model + ' / ' + formatModelRoleLabel(heart.modelRole, Boolean(heart.fallbackUsed)),
                ...(heart.fallbackUsed ? [formatModelFallbackNote(heart)] : []),
            ].join('\n');
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
            modelRole: heart.modelRole,
            provider: 'Ollama',
            modelResponseMs: modelResponseTimeMs,
            retrievalNote: buildRetrievalNote(retrievalState, retrieved.length, missingPinnedSources.length),
            rollingBootstrapStatus,
            rollingBootstrapThemes,
            runtimeProfile: runtimeProfileLabel,
            runtimeProfileId: selectedCognitionProfile.id,
            loadoutFocus: loadoutFocusEnabled,
            distillationGuidance: distillationGuidanceEnabled,
            loadedCacheCount: loadedCaches.length,
            cacheLoadout: cacheLoadoutNames,
            memoryFlow: {
                rollingBootstrap: rollingBootstrapStatus,
                archetypeMemory: activeArchetypeForMemory,
                cacheSummaries: summaryFirst.summaryLayersUsed.cacheSummaries,
                documentSummaries: summaryFirst.summaryLayersUsed.documentSummaries,
                rawChunks: rawChunksForPrompt.length,
            },
            runtimeDebug: {
                promptTokensEstimate: Math.ceil(promptAudit.finalPromptLength / CHARS_PER_TOKEN_ESTIMATE),
                retrievalChunksUsed: rawChunksForPrompt.length,
                bootstrapSummaryActive: Boolean(sentinelIdentityPart),
                archetypeDeltaActive: Boolean(archetypePart),
                numPredict: runtimeGenerationProfile.numPredict,
                temperature: runtimeGenerationProfile.temperature,
                runtimeProfileId: selectedCognitionProfile.id,
                retrievalConfidence: runtimeConfidenceHints.retrievalConfidence,
                cacheOverlapStrength: runtimeConfidenceHints.cacheOverlapStrength,
                continuityDensity: runtimeConfidenceHints.continuityDensity,
                loadedCacheHits: runtimeConfidenceHints.loadedCacheHits,
                modelRole: heart.modelRole,
                fallbackUsed: Boolean(heart.fallbackUsed),
                fallbackReason: heart.fallbackReason || null,
                requestedRoleModel: heart.requestedRoleModel || null,
            },
            compact: compactSignalTrace,
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
            answer: answerWithDepthNudge,
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
