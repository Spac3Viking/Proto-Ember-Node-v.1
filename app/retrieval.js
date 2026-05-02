/**
 * Ember Node v.ᚠ — Phase 3 Retrieval (Phase 15.5: multi-source + route-aware balancing)
 *
 * Room-aware local retrieval layer with lightweight heuristic routing,
 * source-diverse selection, and practical context budgeting support.
 */

'use strict';

const { generateEmbedding, cosineSimilarity, keywordScore } = require('./embeddings');
const { loadChunks, loadEmbeddings, loadExcluded, loadManifests } = require('./indexStore');
const { SOURCE_CLASS_ARCHIVE } = require('./archiveService');
const {
    loadConceptIndex,
    detectConceptDomains,
    detectConceptDomain,
    getPrioritySourcesForQuery,
    conceptBonusForSource,
} = require('./conceptIndex');

const DEFAULT_TOP_K = 12;
const DEFAULT_TARGET_SOURCES = 6;
const DEFAULT_MAX_CHUNKS_PER_SOURCE = 2;
const MIN_SCORE = 0.05;
const ROOM_PRIORITY = ['hearth', 'workshop', 'threshold'];

const DEFAULT_MAX_CONTEXT_CHARS = 16000;
const DEFAULT_MAX_CHUNK_CHARS = 2200;
const DEFAULT_MAX_HISTORY_CHARS = 4000;
const MAX_ROUTE_BONUS = 0.24;
const BASE_ROUTE_BONUS = 0.12;
const ROUTE_BONUS_INCREMENT = 0.04;
const MAX_TITLE_BONUS = 0.12;
const TITLE_BONUS_PER_MATCH = 0.03;
const HIGH_RELEVANCE_MIN_SCORE = 0.2;
const HIGH_RELEVANCE_THRESHOLD_RATIO = 0.82;
const MAX_DUPLICATE_PENALTY = 0.24;
const DUPLICATE_PENALTY_PER_EXTRA = 0.08;
const MIN_REMAINING_HISTORY_CHARS = 120;
const MIN_REMAINING_CONTEXT_CHARS = 300;
const MIN_QUERY_TERM_LENGTH = 4;

const ROUTE_DEFINITIONS = [
    {
        id: 'symbolic',
        keywords: ['symbol', 'symbols', 'rune', 'runes', 'glyph', 'glyphs', 'element', 'elements', 'archetype', 'archetypes'],
        sourceHints: ['runelore', 'myth-tech', 'myth tech', 'symbol index', 'sentinel archetypes'],
    },
    {
        id: 'saga',
        keywords: ['story', 'stories', 'saga', 'sagas', 'narrative', 'character', 'characters', 'worldbuilding'],
        sourceHints: ['living sagas', 'saga seeds', 'sagas', 'sentinel game'],
    },
    {
        id: 'collapse',
        keywords: ['collapse', 'survival', 'continuity', 'systems failure', 'failure', 'breakdown'],
        sourceHints: ['fractured earth', 'green fire sentinels', 'codex', 'codices', 'practical'],
    },
    {
        id: 'ai',
        keywords: ['ai', 'mirror', 'node', 'prompt', 'forge', 'model', 'models'],
        sourceHints: ['mythic mirror seed', 'ember node forge', 'myth-tech', 'dialogues'],
    },
    {
        id: 'philosophy',
        keywords: ['philosophy', 'meaning', 'ontology', 'ontological', 'reality', 'perception'],
        sourceHints: ['green fire philosophy', 'ontological framework', 'signal and flame', 'dialogues'],
    },
    {
        id: 'practice',
        keywords: ['practice', 'grimoire', 'grimoires', 'journal', 'reflection', 'self refinement', 'self-refinement'],
        sourceHints: ['green fire grimoire', 'codices-grimoires-sagas', 'archetype'],
    },
];

function toLowerString(value) {
    return typeof value === 'string' ? value.toLowerCase() : '';
}

function normalizeText(value) {
    return toLowerString(value).replace(/\s+/g, ' ').trim();
}

function chunkFingerprint(text) {
    return normalizeText(text)
        .replace(/[^a-z0-9\s]/g, '')
        .slice(0, 240);
}

function routeDefinition(routeId) {
    return ROUTE_DEFINITIONS.find(r => r.id === routeId) || null;
}

function detectRoute(query) {
    const q = normalizeText(query);
    if (!q) return 'general';

    let bestRoute = 'general';
    let bestScore = 0;

    for (const route of ROUTE_DEFINITIONS) {
        let score = 0;
        for (const keyword of route.keywords) {
            if (q.includes(keyword)) score += 1;
        }
        if (score > bestScore) {
            bestScore = score;
            bestRoute = route.id;
        }
    }

    return bestScore > 0 ? bestRoute : 'general';
}

function buildSourceMetaText(chunk, manifestsById) {
    const manifest = manifestsById[chunk.sourceId] || {};
    return normalizeText([
        manifest.title,
        manifest.description,
        manifest.shelf,
        manifest.file,
        manifest.path,
        chunk.file,
        chunk.shelf,
        chunk.path,
        chunk.cartridgeId,
    ].filter(Boolean).join(' '));
}

function routeBonusForSource(sourceMetaText, routeId) {
    if (!sourceMetaText || routeId === 'general') return 0;
    const route = routeDefinition(routeId);
    if (!route) return 0;

    let matches = 0;
    for (const hint of route.sourceHints) {
        if (sourceMetaText.includes(hint)) matches += 1;
    }
    if (matches === 0) return 0;

    return Math.min(MAX_ROUTE_BONUS, BASE_ROUTE_BONUS + ((matches - 1) * ROUTE_BONUS_INCREMENT));
}

function titleBonusForQuery(sourceMetaText, query) {
    if (!sourceMetaText || !query) return 0;
    const queryTerms = normalizeText(query)
        .split(' ')
        .filter(Boolean)
        .filter(term => term.length >= MIN_QUERY_TERM_LENGTH);
    if (queryTerms.length === 0) return 0;

    let hits = 0;
    for (const term of queryTerms) {
        if (sourceMetaText.includes(term)) hits += 1;
    }
    return Math.min(MAX_TITLE_BONUS, hits * TITLE_BONUS_PER_MATCH);
}

function roomPriorityIndex(room) {
    const idx = ROOM_PRIORITY.indexOf(room);
    return idx === -1 ? ROOM_PRIORITY.length : idx;
}

function scoreChunks({ chunks, queryVector, queryText, embeddings }) {
    const useEmbeddings = queryVector !== null && queryVector !== undefined;
    return chunks
        .map(chunk => {
            let score;
            if (useEmbeddings) {
                const vec = embeddings[chunk.id];
                score = vec ? cosineSimilarity(queryVector, vec) : 0;
            } else {
                score = keywordScore(queryText, chunk.text);
            }
            return { chunk, score };
        })
        .filter(({ score }) => score >= MIN_SCORE);
}

function buildSourceBuckets(scoredEntries) {
    const bySource = {};
    for (const entry of scoredEntries) {
        const sid = entry.chunk.sourceId;
        if (!bySource[sid]) bySource[sid] = [];
        bySource[sid].push(entry);
    }

    for (const sid of Object.keys(bySource)) {
        bySource[sid].sort((a, b) => b.score - a.score);
    }

    return bySource;
}

function selectBalancedEntries({
    scoredEntries,
    topK,
    targetSources,
    maxChunksPerSource,
}) {
    if (!scoredEntries || scoredEntries.length === 0) return [];

    const bySource = buildSourceBuckets(scoredEntries);
    const sourceOrder = Object.keys(bySource)
        .map(sourceId => ({
            sourceId,
            bestScore: bySource[sourceId][0] ? bySource[sourceId][0].score : 0,
            roomPriority: roomPriorityIndex(bySource[sourceId][0] ? bySource[sourceId][0].chunk.room : ''),
        }))
        .sort((a, b) => {
            if (b.bestScore !== a.bestScore) return b.bestScore - a.bestScore;
            return a.roomPriority - b.roomPriority;
        })
        .map(x => x.sourceId);

    const pointers = {};
    const usageBySource = {};
    const bestBySource = {};
    const selected = [];
    const selectedSources = new Set();
    const seenChunkIds = new Set();
    const seenFingerprints = new Set();

    for (const sid of sourceOrder) {
        pointers[sid] = 0;
        usageBySource[sid] = 0;
        bestBySource[sid] = bySource[sid][0] ? bySource[sid][0].score : 0;
    }

    function pullNextEntry(sourceId) {
        const list = bySource[sourceId] || [];
        while (pointers[sourceId] < list.length) {
            const entry = list[pointers[sourceId]++];
            const id = entry.chunk.id;
            if (seenChunkIds.has(id)) continue;
            const fp = chunkFingerprint(entry.chunk.text || '');
            if (fp && seenFingerprints.has(fp)) continue;
            return entry;
        }
        return null;
    }

    function takeFromSource(sourceId, { requireHighRelevance = false } = {}) {
        if (selected.length >= topK) return false;
        if ((usageBySource[sourceId] || 0) >= maxChunksPerSource) return false;

        const entry = pullNextEntry(sourceId);
        if (!entry) return false;

        if (requireHighRelevance) {
            const threshold = Math.max(
                HIGH_RELEVANCE_MIN_SCORE,
                (bestBySource[sourceId] || 0) * HIGH_RELEVANCE_THRESHOLD_RATIO,
            );
            if (entry.score < threshold) return false;
        }

        selected.push(entry);
        usageBySource[sourceId] = (usageBySource[sourceId] || 0) + 1;
        selectedSources.add(sourceId);
        seenChunkIds.add(entry.chunk.id);
        const fp = chunkFingerprint(entry.chunk.text || '');
        if (fp) seenFingerprints.add(fp);
        return true;
    }

    // Pass 1: best chunk from top target sources
    for (const sourceId of sourceOrder) {
        if (selected.length >= topK) break;
        if (selectedSources.size >= targetSources) break;
        takeFromSource(sourceId, { requireHighRelevance: false });
    }

    // Pass 2: best chunk from additional sources for breadth
    for (const sourceId of sourceOrder) {
        if (selected.length >= topK) break;
        if (selectedSources.has(sourceId)) continue;
        takeFromSource(sourceId, { requireHighRelevance: false });
    }

    // Pass 3: second-pass fill with per-source cap and high-relevance guard
    let added = true;
    while (selected.length < topK && added) {
        added = false;
        for (const sourceId of sourceOrder) {
            if (selected.length >= topK) break;
            const alreadyUsed = usageBySource[sourceId] || 0;
            const requireHighRelevance = alreadyUsed >= 1;
            const didTake = takeFromSource(sourceId, { requireHighRelevance });
            if (didTake) added = true;
        }
    }

    return selected.slice(0, topK);
}

function normalizeRoomCandidates(candidates, rooms, sourceClassById) {
    if (rooms !== null) {
        return candidates.filter(c => {
            if (rooms.includes(c.room)) return true;
            if (rooms.includes('hearth') && sourceClassById[c.sourceId] === SOURCE_CLASS_ARCHIVE) return true;
            return false;
        });
    }

    return candidates.filter(c => {
        if (c.room === 'hearth' || c.room === 'workshop') return true;
        if (sourceClassById[c.sourceId] === SOURCE_CLASS_ARCHIVE) return true;
        return false;
    });
}

async function retrieve({
    query,
    topK = DEFAULT_TOP_K,
    rooms = null,
    cartridgeId = null,
    sourceClass = null,
    routeHint = null,
    targetSources = DEFAULT_TARGET_SOURCES,
    maxChunksPerSource = DEFAULT_MAX_CHUNKS_PER_SOURCE,
}) {
    const allChunks = loadChunks();
    const embeddings = loadEmbeddings();
    const excluded = loadExcluded();
    const manifests = loadManifests();

    const sourceClassById = {};
    Object.values(manifests).forEach(m => {
        if (m && m.sourceClass) sourceClassById[m.id] = m.sourceClass;
    });

    let candidates = allChunks.filter(c => !excluded.includes(c.sourceId));

    if (sourceClass) {
        candidates = candidates.filter(c => sourceClassById[c.sourceId] === sourceClass);
    }

    candidates = normalizeRoomCandidates(candidates, rooms, sourceClassById);

    if (cartridgeId) {
        candidates = candidates.filter(c => c.cartridgeId === cartridgeId);
    }

    if (candidates.length === 0) return [];

    const queryVector = await generateEmbedding(query);
    const routedAs = routeHint || detectRoute(query);
    let conceptRouting = {
        primary: 'general',
        domains: ['general'],
        scores: {},
        priority_sources: [],
    };
    try {
        const conceptIndex = loadConceptIndex();
        conceptRouting = getPrioritySourcesForQuery(query, conceptIndex);
    } catch (err) {
        console.warn('[retrieval] concept routing unavailable; falling back to base retrieval:', err.message);
    }

    const baseScored = scoreChunks({ chunks: candidates, queryVector, queryText: query, embeddings });
    if (baseScored.length === 0) return [];

    const fingerprintCounts = {};
    for (const entry of baseScored) {
        const fp = chunkFingerprint(entry.chunk.text || '');
        if (!fp) continue;
        fingerprintCounts[fp] = (fingerprintCounts[fp] || 0) + 1;
    }

    const scored = baseScored
        .map(entry => {
            const sourceMetaText = buildSourceMetaText(entry.chunk, manifests);
            const routeBonus = routeBonusForSource(sourceMetaText, routedAs);
            const titleBonus = titleBonusForQuery(sourceMetaText, query);
            const conceptBonus = conceptBonusForSource(sourceMetaText, conceptRouting.priority_sources);
            const fp = chunkFingerprint(entry.chunk.text || '');
            const duplicatePenalty = fp && fingerprintCounts[fp] > 1
                ? Math.min(MAX_DUPLICATE_PENALTY, (fingerprintCounts[fp] - 1) * DUPLICATE_PENALTY_PER_EXTRA)
                : 0;
            const finalScore = entry.score + routeBonus + titleBonus + conceptBonus - duplicatePenalty;

            return {
                chunk: entry.chunk,
                score: finalScore,
                textMatchScore: entry.score,
                routeBonus,
                titleBonus,
                conceptBonus,
                duplicatePenalty,
                conceptDomain: conceptRouting.primary,
                conceptDomains: conceptRouting.domains,
                conceptScores: conceptRouting.scores,
                prioritySourcesConsidered: conceptRouting.priority_sources,
            };
        })
        .filter(entry => entry.score >= MIN_SCORE);

    if (scored.length === 0) return [];

    return selectBalancedEntries({
        scoredEntries: scored,
        topK,
        targetSources,
        maxChunksPerSource,
    });
}

function formatRecentHistory(recentHistory, maxHistoryChars) {
    if (!Array.isArray(recentHistory) || recentHistory.length === 0) return '';

    const lines = [];
    let totalChars = 0;

    for (let i = recentHistory.length - 1; i >= 0; i--) {
        const msg = recentHistory[i];
        if (!msg || typeof msg.content !== 'string') continue;
        const role = msg.role === 'assistant' ? 'Assistant' : 'User';
        const content = msg.content.trim();
        if (!content) continue;

        const line = role + ': ' + content;
        if (totalChars + line.length > maxHistoryChars) {
            const remaining = maxHistoryChars - totalChars;
            if (remaining < MIN_REMAINING_HISTORY_CHARS) break;
            lines.unshift(line.slice(0, remaining));
            totalChars = maxHistoryChars;
            break;
        }

        lines.unshift(line);
        totalChars += line.length;
    }

    if (lines.length === 0) return '';
    return '=== Recent Chat Context ===\n' + lines.join('\n') + '\n\n';
}

function buildGroundedPrompt({
    query,
    retrievedChunks,
    recentHistory = null,
    maxContextChars = DEFAULT_MAX_CONTEXT_CHARS,
    maxChunkChars = DEFAULT_MAX_CHUNK_CHARS,
    maxHistoryChars = DEFAULT_MAX_HISTORY_CHARS,
}) {
    const historyBlock = formatRecentHistory(recentHistory, maxHistoryChars);

    if (!retrievedChunks || retrievedChunks.length === 0) {
        return historyBlock + query;
    }

    const contextBlocks = [];
    let contextChars = 0;

    for (const { chunk } of retrievedChunks) {
        if (!chunk) continue;
        const chunkText = typeof chunk.text === 'string' ? chunk.text.trim() : '';
        if (!chunkText) continue;

        const trimmedChunkText = chunkText.length > maxChunkChars
            ? chunkText.slice(0, maxChunkChars)
            : chunkText;

        const block = `[Source: ${chunk.room}/${chunk.shelf}/${chunk.file}]\n${trimmedChunkText}`;
        if (contextChars + block.length > maxContextChars) {
            const remaining = maxContextChars - contextChars;
            if (remaining < MIN_REMAINING_CONTEXT_CHARS) break;
            contextBlocks.push(block.slice(0, remaining));
            contextChars = maxContextChars;
            break;
        }

        contextBlocks.push(block);
        contextChars += block.length;

        if (contextChars >= maxContextChars) break;
    }

    if (contextBlocks.length === 0) {
        return historyBlock + query;
    }

    return (
        `You are answering based on the following local knowledge sources:\n\n` +
        `${historyBlock}` +
        `${contextBlocks.join('\n\n---\n\n')}\n\n---\n\n` +
        `User question: ${query}`
    );
}

module.exports = {
    retrieve,
    buildGroundedPrompt,
    scoreChunks,
    detectRoute,
    detectConceptDomains,
    detectConceptDomain,
    getPrioritySourcesForQuery,
    DEFAULT_TOP_K,
    DEFAULT_TARGET_SOURCES,
    DEFAULT_MAX_CHUNKS_PER_SOURCE,
    MIN_SCORE,
    DEFAULT_MAX_CONTEXT_CHARS,
    DEFAULT_MAX_CHUNK_CHARS,
    DEFAULT_MAX_HISTORY_CHARS,
};
