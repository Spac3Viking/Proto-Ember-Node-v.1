/**
 * Ember Node v.ᚠ — Phase 3 Retrieval (Phase 15.5: multi-source + route-aware balancing)
 *
 * Room-aware local retrieval layer with lightweight heuristic routing,
 * source-diverse selection, and practical context budgeting support.
 */

'use strict';

const { generateEmbedding, cosineSimilarity, keywordScore } = require('./embeddings');
const { loadChunks, loadEmbeddings, loadExcluded, loadManifests } = require('./indexStore');
const { SOURCE_CLASS_ARCHIVE, SOURCE_CLASS_ARCHIVE_CACHE } = require('./archiveService');
const {
    loadConceptIndex,
    detectConceptDomains,
    detectConceptDomain,
    getPrioritySourcesForQuery,
    conceptBonusForSource,
} = require('./conceptIndex');
const { getLoadedCacheLookup } = require('./loadedCaches');

const DEFAULT_TOP_K = 12;
const DEFAULT_TARGET_SOURCES = 6;
const DEFAULT_MAX_CHUNKS_PER_SOURCE = 2;
const MIN_SCORE = 0.05;
const ROOM_PRIORITY = ['hearth', 'council', 'threshold'];

const DEFAULT_MAX_CONTEXT_CHARS = 16000;
const DEFAULT_MAX_CHUNK_CHARS = 2200;
const DEFAULT_MAX_HISTORY_CHARS = 4000;
const DEFAULT_MAX_HISTORY_TURNS = 8;
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
const MIN_PRIORITY_SOURCES_IN_SELECTION = 3;
const COURT_PRIORITY_SOURCE_BOOST = 1.25;
const COURT_PRIORITY_DOMAIN_BOOST = 1.12;
const ARCHETYPE_MEMORY_SOURCE_BOOST = 1.08;
const ARCHETYPE_MEMORY_DOMAIN_BOOST = 1.05;
// Keep loaded-cache preference modest so loaded sources are favored
// without overpowering concept routing, archetype memory, or court lenses.
const LOADED_CACHE_SOURCE_BOOST = 1.06;
const NON_LOADED_ARCHIVE_PENALTY = 1;
const MAX_LOADED_CACHE_BOOST = 1.5;
const MIN_NON_LOADED_ARCHIVE_PENALTY = 0.7;

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

function normalizeRoom(room) {
    // Legacy migration alias. Remove after user data migration stabilizes.
    return room === 'workshop' ? 'council' : room;
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
        chunk.cacheId,
    ].filter(Boolean).join(' '));
}

function normalizeCacheKey(value) {
    return normalizeText(String(value || ''));
}

function isLoadedSourceMatch({ entry, manifest, loadedIds }) {
    if (!entry || !entry.chunk || !manifest) return false;
    const chunkCacheId = normalizeCacheKey(entry.chunk.cacheId);
    if (chunkCacheId && loadedIds.has(chunkCacheId)) return true;
    const manifestCacheId = normalizeCacheKey(manifest.cacheId);
    if (manifestCacheId && loadedIds.has(manifestCacheId)) return true;
    const archiveCacheShelf = manifest.sourceClass === SOURCE_CLASS_ARCHIVE_CACHE &&
        normalizeCacheKey(manifest.shelf);
    if (archiveCacheShelf && loadedIds.has(archiveCacheShelf)) return true;
    const sourcePath = normalizeText(manifest.path || '');
    if (loadedIds.has('green-fire-core') && sourcePath.startsWith('archive/core/')) return true;
    return false;
}

function findMatchedPrioritySources(sourceMetaText, prioritySources) {
    if (!sourceMetaText || !Array.isArray(prioritySources) || prioritySources.length === 0) return [];

    const matches = [];
    for (const sourceName of prioritySources) {
        const normalizedSource = normalizeText(sourceName);
        if (!normalizedSource) continue;
        if (sourceMetaText.includes(normalizedSource)) matches.push(sourceName);
    }
    return matches;
}

function normalizeCourtMemberConfig(courtMember) {
    if (!courtMember || typeof courtMember !== 'object') return null;
    const prioritySources = Array.isArray(courtMember.prioritySources)
        ? courtMember.prioritySources.map(String)
        : (Array.isArray(courtMember.preferredSources) ? courtMember.preferredSources.map(String) : []);
    const priorityDomains = Array.isArray(courtMember.priorityDomains)
        ? courtMember.priorityDomains.map(String)
        : (Array.isArray(courtMember.primaryDomains) ? courtMember.primaryDomains.map(String) : []);
    return {
        id: courtMember.id ? String(courtMember.id) : null,
        name: courtMember.name ? String(courtMember.name) : null,
        prioritySources,
        priorityDomains,
    };
}

function normalizeArchetypeMemoryProfile(profile) {
    if (!profile || typeof profile !== 'object') return null;
    const preferredSources = Array.isArray(profile.preferred_sources)
        ? profile.preferred_sources.map(String)
        : (Array.isArray(profile.preferredSources) ? profile.preferredSources.map(String) : []);
    const preferredDomains = Array.isArray(profile.preferred_domains)
        ? profile.preferred_domains.map(String)
        : (Array.isArray(profile.preferredDomains) ? profile.preferredDomains.map(String) : []);
    return {
        preferredSources,
        preferredDomains,
    };
}

function normalizeRetrievalDiscipline(profile) {
    if (!profile || typeof profile !== 'object') {
        return {
            loadedCacheBoost: LOADED_CACHE_SOURCE_BOOST,
            nonLoadedArchivePenalty: NON_LOADED_ARCHIVE_PENALTY,
        };
    }
    const loadedCacheBoost = Number.isFinite(profile.loadedCacheBoost)
        ? Math.max(1, Math.min(MAX_LOADED_CACHE_BOOST, Number(profile.loadedCacheBoost)))
        : LOADED_CACHE_SOURCE_BOOST;
    const nonLoadedArchivePenalty = Number.isFinite(profile.nonLoadedArchivePenalty)
        ? Math.max(MIN_NON_LOADED_ARCHIVE_PENALTY, Math.min(1, Number(profile.nonLoadedArchivePenalty)))
        : NON_LOADED_ARCHIVE_PENALTY;
    return {
        loadedCacheBoost,
        nonLoadedArchivePenalty,
    };
}

function buildPrioritySourceSetForDomains(conceptIndex, domainIds) {
    const normalized = new Set();
    if (!conceptIndex || !Array.isArray(conceptIndex.domains) || !Array.isArray(domainIds) || domainIds.length === 0) {
        return normalized;
    }
    const targetDomains = new Set(domainIds.map(d => String(d)));
    for (const domain of conceptIndex.domains) {
        if (!domain || !targetDomains.has(String(domain.id || ''))) continue;
        const domainSources = Array.isArray(domain.priority_sources) ? domain.priority_sources : [];
        for (const source of domainSources) {
            const normalizedSource = normalizeText(source);
            if (normalizedSource) normalized.add(normalizedSource);
        }
    }
    return normalized;
}

function hasSourceMatch(sourceMetaText, normalizedPrioritySourceSet) {
    if (!sourceMetaText || !(normalizedPrioritySourceSet instanceof Set) || normalizedPrioritySourceSet.size === 0) {
        return false;
    }
    for (const source of normalizedPrioritySourceSet) {
        if (sourceMetaText.includes(source)) return true;
    }
    return false;
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
    const idx = ROOM_PRIORITY.indexOf(normalizeRoom(room));
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
    prioritySourceIds = [],
    minPrioritySources = 0,
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

    const prioritySourceSet = new Set(prioritySourceIds || []);
    const orderedPrioritySources = sourceOrder.filter(sourceId => prioritySourceSet.has(sourceId));
    const requiredPrioritySources = Math.min(
        topK,
        orderedPrioritySources.length,
        Math.max(0, minPrioritySources || 0),
    );

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

    // Pass 0: enforce minimum distinct priority sources (if available)
    if (requiredPrioritySources > 0) {
        for (const sourceId of orderedPrioritySources) {
            if (selected.length >= topK) break;
            if (selectedSources.size >= requiredPrioritySources) break;
            takeFromSource(sourceId, { requireHighRelevance: false });
        }
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
        const normalizedRooms = Array.isArray(rooms) ? rooms.map(normalizeRoom) : [];
        return candidates.filter(c => {
            const candidateRoom = normalizeRoom(c.room);
            if (normalizedRooms.includes(candidateRoom)) return true;
            if (normalizedRooms.includes('hearth') && sourceClassById[c.sourceId] === SOURCE_CLASS_ARCHIVE) return true;
            return false;
        });
    }

    return candidates.filter(c => {
        const candidateRoom = normalizeRoom(c.room);
        if (candidateRoom === 'hearth' || candidateRoom === 'council') return true;
        if (sourceClassById[c.sourceId] === SOURCE_CLASS_ARCHIVE) return true;
        return false;
    });
}

async function retrieve({
    query,
    topK = DEFAULT_TOP_K,
    rooms = null,
    cacheId = null,
    sourceClass = null,
    routeHint = null,
    targetSources = DEFAULT_TARGET_SOURCES,
    maxChunksPerSource = DEFAULT_MAX_CHUNKS_PER_SOURCE,
    courtMember = null,
    archetypeMemoryProfile = null,
    retrievalDiscipline = null,
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

    if (cacheId) {
        candidates = candidates.filter(c => c.cacheId === cacheId);
    }

    if (candidates.length === 0) return [];

    const queryVector = await generateEmbedding(query);
    const routedAs = routeHint || detectRoute(query);
    const normalizedCourtMember = normalizeCourtMemberConfig(courtMember);
    const normalizedArchetypeMemory = normalizeArchetypeMemoryProfile(archetypeMemoryProfile);
    const normalizedRetrievalDiscipline = normalizeRetrievalDiscipline(retrievalDiscipline);
    const loadedLookup = getLoadedCacheLookup();
    const loadedIds = new Set(Array.from(loadedLookup.ids || []).map(normalizeCacheKey).filter(Boolean));
    let conceptRouting = {
        primary: 'general',
        domains: ['general'],
        scores: {},
        priority_sources: [],
    };
    let conceptIndex = null;
    try {
        conceptIndex = loadConceptIndex();
        conceptRouting = getPrioritySourcesForQuery(query, conceptIndex);
    } catch (err) {
        console.warn('[retrieval] concept routing unavailable; falling back to base retrieval:', err.message);
    }
    const courtPrioritySources = normalizedCourtMember ? normalizedCourtMember.prioritySources : [];
    const courtPriorityDomains = normalizedCourtMember ? normalizedCourtMember.priorityDomains : [];
    const normalizedCourtDomainPrioritySources = buildPrioritySourceSetForDomains(conceptIndex, courtPriorityDomains);
    const normalizedArchetypeDomainPrioritySources = buildPrioritySourceSetForDomains(
        conceptIndex,
        normalizedArchetypeMemory ? normalizedArchetypeMemory.preferredDomains : [],
    );

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
            const manifest = manifests[entry.chunk.sourceId] || {};
            const sourceMetaText = buildSourceMetaText(entry.chunk, manifests);
            const routeBonus = routeBonusForSource(sourceMetaText, routedAs);
            const titleBonus = titleBonusForQuery(sourceMetaText, query);
            const conceptBonus = conceptBonusForSource(sourceMetaText, conceptRouting.priority_sources);
            const matchedPrioritySources = findMatchedPrioritySources(sourceMetaText, conceptRouting.priority_sources);
            const matchedCourtPrioritySources = findMatchedPrioritySources(sourceMetaText, courtPrioritySources);
            const courtPrioritySourceMatch = matchedCourtPrioritySources.length > 0;
            const courtPriorityDomainMatch = hasSourceMatch(sourceMetaText, normalizedCourtDomainPrioritySources);
            const archetypeMemorySourceMatch = hasSourceMatch(
                sourceMetaText,
                new Set((normalizedArchetypeMemory && normalizedArchetypeMemory.preferredSources || [])
                    .map(source => normalizeText(source))
                    .filter(Boolean)),
            );
            const archetypeMemoryDomainMatch = hasSourceMatch(sourceMetaText, normalizedArchetypeDomainPrioritySources);
            const fp = chunkFingerprint(entry.chunk.text || '');
            const duplicatePenalty = fp && fingerprintCounts[fp] > 1
                ? Math.min(MAX_DUPLICATE_PENALTY, (fingerprintCounts[fp] - 1) * DUPLICATE_PENALTY_PER_EXTRA)
                : 0;
            const preConceptScore = entry.score + routeBonus + titleBonus - duplicatePenalty;
            // Compose scoring in conservative layers:
            // [base similarity + route/title adjustments - duplicate penalty]
            // × concept index weighting
            // × court source/domain boosts (when a court lens is active)
            // This keeps concept routing as the core signal while allowing court lenses
            // to bend retrieval paths without hard-locking source selection.
            const postConceptScore = preConceptScore * (1 + conceptBonus);
            const courtSourceBoost = courtPrioritySourceMatch ? COURT_PRIORITY_SOURCE_BOOST : 1;
            const courtDomainBoost = courtPriorityDomainMatch ? COURT_PRIORITY_DOMAIN_BOOST : 1;
            const archetypeMemorySourceBoost = archetypeMemorySourceMatch ? ARCHETYPE_MEMORY_SOURCE_BOOST : 1;
            const archetypeMemoryDomainBoost = archetypeMemoryDomainMatch ? ARCHETYPE_MEMORY_DOMAIN_BOOST : 1;
            const loadedCacheMatch = loadedIds.size > 0 && isLoadedSourceMatch({
                entry,
                manifest,
                loadedIds,
            });
            const loadedCacheBoost = loadedCacheMatch ? normalizedRetrievalDiscipline.loadedCacheBoost : 1;
            const nonLoadedArchivePenalty = (
                !loadedCacheMatch &&
                sourceClassById[entry.chunk.sourceId] === SOURCE_CLASS_ARCHIVE
            )
                ? normalizedRetrievalDiscipline.nonLoadedArchivePenalty
                : 1;
            const finalScore = postConceptScore *
                courtSourceBoost *
                courtDomainBoost *
                archetypeMemorySourceBoost *
                archetypeMemoryDomainBoost *
                loadedCacheBoost *
                nonLoadedArchivePenalty;

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
                courtMemberId: normalizedCourtMember ? normalizedCourtMember.id : null,
                courtMemberName: normalizedCourtMember ? normalizedCourtMember.name : null,
                courtDomainsConsidered: courtPriorityDomains,
                courtPrioritySourcesConsidered: courtPrioritySources,
                matchedPrioritySources,
                matchedCourtPrioritySources,
                courtPrioritySourceMatch,
                courtPriorityDomainMatch,
                courtSourceBoost,
                courtDomainBoost,
                archetypeMemorySourceMatch,
                archetypeMemoryDomainMatch,
                archetypeMemorySourceBoost,
                archetypeMemoryDomainBoost,
                loadedCacheMatch,
                loadedCacheBoost,
                nonLoadedArchivePenalty,
            };
        })
        .filter(entry => entry.score >= MIN_SCORE);

    if (scored.length === 0) return [];

    const priorityMatchedSourceIds = [];
    const seenPriorityMatchedSourceIds = new Set();
    for (const entry of scored.slice().sort((a, b) => b.score - a.score)) {
        if (!entry || !entry.chunk) continue;
        const hasConceptPriorityMatch = Array.isArray(entry.matchedPrioritySources) && entry.matchedPrioritySources.length > 0;
        const hasCourtPriorityMatch = Array.isArray(entry.matchedCourtPrioritySources) && entry.matchedCourtPrioritySources.length > 0;
        if (!hasConceptPriorityMatch && !hasCourtPriorityMatch) continue;
        const sourceId = entry.chunk.sourceId;
        if (!sourceId || seenPriorityMatchedSourceIds.has(sourceId)) continue;
        seenPriorityMatchedSourceIds.add(sourceId);
        priorityMatchedSourceIds.push(sourceId);
    }

    const hasAnyPriorityRouting = (
        Array.isArray(conceptRouting.priority_sources) && conceptRouting.priority_sources.length > 0
    ) || (
        Array.isArray(courtPrioritySources) && courtPrioritySources.length > 0
    );
    const minPrioritySources = hasAnyPriorityRouting
        ? MIN_PRIORITY_SOURCES_IN_SELECTION
        : 0;

    return selectBalancedEntries({
        scoredEntries: scored,
        topK,
        targetSources,
        maxChunksPerSource,
        prioritySourceIds: priorityMatchedSourceIds,
        minPrioritySources,
    });
}

function formatRecentHistory(recentHistory, maxHistoryChars, maxHistoryTurns = DEFAULT_MAX_HISTORY_TURNS) {
    if (!Array.isArray(recentHistory) || recentHistory.length === 0) {
        return { block: '', chars: 0, turns: 0 };
    }

    const lines = [];
    let totalChars = 0;
    const boundedTurns = Math.max(1, Number.isFinite(maxHistoryTurns) ? Math.floor(maxHistoryTurns) : DEFAULT_MAX_HISTORY_TURNS);

    for (let i = recentHistory.length - 1; i >= 0; i--) {
        if (lines.length >= boundedTurns) break;
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

    if (lines.length === 0) {
        return { block: '', chars: 0, turns: 0 };
    }
    return {
        block: '=== Recent Chat Context ===\n' + lines.join('\n') + '\n\n',
        chars: totalChars,
        turns: lines.length,
    };
}

function buildGroundedPrompt({
    query,
    retrievedChunks,
    recentHistory = null,
    maxContextChars = DEFAULT_MAX_CONTEXT_CHARS,
    maxChunkChars = DEFAULT_MAX_CHUNK_CHARS,
    maxHistoryChars = DEFAULT_MAX_HISTORY_CHARS,
    maxHistoryTurns = DEFAULT_MAX_HISTORY_TURNS,
    includeMetrics = false,
}) {
    const historyInfo = formatRecentHistory(recentHistory, maxHistoryChars, maxHistoryTurns);
    const historyBlock = historyInfo.block;
    const rawChunkStats = {
        rawContextChars: 0,
        rawChunkCount: 0,
        historyChars: historyInfo.chars,
        historyTurns: historyInfo.turns,
    };

    if (!retrievedChunks || retrievedChunks.length === 0) {
        const promptWithoutChunks = historyBlock + query;
        if (includeMetrics) {
            return {
                prompt: promptWithoutChunks,
                metrics: rawChunkStats,
            };
        }
        return promptWithoutChunks;
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
        const promptWithoutContext = historyBlock + query;
        if (includeMetrics) {
            return {
                prompt: promptWithoutContext,
                metrics: rawChunkStats,
            };
        }
        return promptWithoutContext;
    }

    rawChunkStats.rawContextChars = contextChars;
    rawChunkStats.rawChunkCount = contextBlocks.length;

    // Keep grounded chunks ahead of recent chat history so retrieval remains primary
    // context while still retaining short-turn continuity near the active question.
    const prompt = (
        `You are answering based on the following local knowledge sources:\n\n` +
        `${contextBlocks.join('\n\n---\n\n')}\n\n---\n\n` +
        `${historyBlock}` +
        `User question: ${query}`
    );
    if (includeMetrics) {
        return {
            prompt,
            metrics: rawChunkStats,
        };
    }
    return prompt;
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
    DEFAULT_MAX_HISTORY_TURNS,
};
