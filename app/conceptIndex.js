'use strict';

const fs = require('fs');
const path = require('path');

const { INDEXES_DIR } = require('./storageConfig');

const BUNDLED_CONCEPT_INDEX_PATH = path.join(__dirname, 'concept-index', 'green-fire-concept-index.json');
const USER_CONCEPT_INDEX_PATH = path.join(INDEXES_DIR, 'green-fire-concept-index.json');
const CONCEPT_BONUS_BASE = 0.2;
const CONCEPT_BONUS_PER_MATCH = 0.08;
const CONCEPT_BONUS_MAX = 0.6;
let cachedUserConceptIndex = null;
let cachedUserConceptIndexMtimeMs = -1;

const DEFAULT_CONCEPT_INDEX = {
    version: '1.0',
    domains: [],
};
const MAX_DETECTED_DOMAINS = 3;

function _normalizeText(value) {
    return typeof value === 'string'
        ? value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
        : '';
}

function _safeParseJSON(raw) {
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function _looksLikeConceptIndex(value) {
    return !!(value && typeof value === 'object' && Array.isArray(value.domains));
}

function _readConceptIndex(pathname) {
    if (!fs.existsSync(pathname)) return null;
    const parsed = _safeParseJSON(fs.readFileSync(pathname, 'utf8'));
    return _looksLikeConceptIndex(parsed) ? parsed : null;
}

function loadBundledConceptIndex() {
    return _readConceptIndex(BUNDLED_CONCEPT_INDEX_PATH);
}

function ensureUserConceptIndex() {
    if (fs.existsSync(USER_CONCEPT_INDEX_PATH)) {
        let stat = null;
        try {
            stat = fs.statSync(USER_CONCEPT_INDEX_PATH);
        } catch { /* ignore stat failure */ }
        const existing = _readConceptIndex(USER_CONCEPT_INDEX_PATH);
        if (existing) {
            cachedUserConceptIndex = existing;
            cachedUserConceptIndexMtimeMs = stat ? stat.mtimeMs : -1;
        }
        return USER_CONCEPT_INDEX_PATH;
    }

    fs.mkdirSync(path.dirname(USER_CONCEPT_INDEX_PATH), { recursive: true });
    const bundled = loadBundledConceptIndex();
    const payload = bundled || DEFAULT_CONCEPT_INDEX;
    fs.writeFileSync(USER_CONCEPT_INDEX_PATH, JSON.stringify(payload, null, 2), 'utf8');
    try {
        const stat = fs.statSync(USER_CONCEPT_INDEX_PATH);
        cachedUserConceptIndex = payload;
        cachedUserConceptIndexMtimeMs = stat.mtimeMs;
    } catch {
        cachedUserConceptIndex = payload;
        cachedUserConceptIndexMtimeMs = -1;
    }
    return USER_CONCEPT_INDEX_PATH;
}

function loadConceptIndex() {
    let userStat = null;
    try {
        userStat = fs.statSync(USER_CONCEPT_INDEX_PATH);
    } catch {
        userStat = null;
    }

    if (
        userStat &&
        cachedUserConceptIndex &&
        cachedUserConceptIndexMtimeMs === userStat.mtimeMs
    ) {
        return cachedUserConceptIndex;
    }

    const fromUserData = _readConceptIndex(USER_CONCEPT_INDEX_PATH);
    if (fromUserData) {
        cachedUserConceptIndex = fromUserData;
        cachedUserConceptIndexMtimeMs = userStat ? userStat.mtimeMs : -1;
        return fromUserData;
    }

    const fromBundled = loadBundledConceptIndex();
    if (fromBundled) return fromBundled;

    return DEFAULT_CONCEPT_INDEX;
}

function getDomain(conceptIndex, domainId) {
    const domains = conceptIndex && Array.isArray(conceptIndex.domains)
        ? conceptIndex.domains
        : [];
    return domains.find(d => d && d.id === domainId) || null;
}

function _domainPrioritySources(domain) {
    if (!domain || typeof domain !== 'object') return [];
    if (Array.isArray(domain.priority_sources)) return domain.priority_sources;
    if (Array.isArray(domain.prioritizedWorks)) return domain.prioritizedWorks;
    return [];
}

function detectConceptDomains(query, conceptIndex) {
    const normalizedQuery = _normalizeText(query);
    if (!normalizedQuery) {
        return {
            primary: 'general',
            domains: ['general'],
            scores: {},
        };
    }

    const index = conceptIndex || loadConceptIndex();
    const domains = Array.isArray(index.domains) ? index.domains : [];
    const scoreEntries = [];

    for (const domain of domains) {
        if (!domain || !Array.isArray(domain.keywords)) continue;
        let score = 0;
        for (const keyword of domain.keywords) {
            const normalizedKeyword = _normalizeText(keyword);
            if (!normalizedKeyword) continue;
            if (normalizedQuery.includes(normalizedKeyword)) score += 1;
        }
        if (score > 0) scoreEntries.push({ domainId: domain.id || 'general', score });
    }

    scoreEntries.sort((a, b) => b.score - a.score);
    const top = scoreEntries.slice(0, MAX_DETECTED_DOMAINS);
    if (top.length === 0) {
        return {
            primary: 'general',
            domains: ['general'],
            scores: {},
        };
    }

    const scores = {};
    for (const entry of top) {
        scores[entry.domainId] = entry.score;
    }

    return {
        primary: top[0].domainId,
        domains: top.map(entry => entry.domainId),
        scores,
    };
}

function detectConceptDomain(query, conceptIndex) {
    const result = detectConceptDomains(query, conceptIndex);
    return result.primary || 'general';
}

function getPrioritySourcesForQuery(query, conceptIndex) {
    const index = conceptIndex || loadConceptIndex();
    const routed = detectConceptDomains(query, index);
    const deduped = new Set();
    const ordered = [];

    for (const domainId of routed.domains) {
        if (!domainId || domainId === 'general') continue;
        const domain = getDomain(index, domainId);
        const domainSources = _domainPrioritySources(domain);
        for (const sourceName of domainSources) {
            const normalized = _normalizeText(sourceName);
            if (!normalized || deduped.has(normalized)) continue;
            deduped.add(normalized);
            ordered.push(sourceName);
        }
    }

    return {
        primary: routed.primary || 'general',
        domains: Array.isArray(routed.domains) && routed.domains.length > 0 ? routed.domains : ['general'],
        scores: routed.scores || {},
        priority_sources: ordered,
    };
}

function conceptBonusForSource(sourceMetaText, prioritySources) {
    if (!sourceMetaText || !Array.isArray(prioritySources) || prioritySources.length === 0) return 0;
    const haystack = _normalizeText(sourceMetaText);
    let matches = 0;

    for (const source of prioritySources) {
        const normalizedSource = _normalizeText(source);
        if (!normalizedSource) continue;
        if (haystack.includes(normalizedSource)) matches += 1;
    }
    if (matches === 0) return 0;

    return Math.min(CONCEPT_BONUS_MAX, CONCEPT_BONUS_BASE + (matches * CONCEPT_BONUS_PER_MATCH));
}

module.exports = {
    BUNDLED_CONCEPT_INDEX_PATH,
    USER_CONCEPT_INDEX_PATH,
    loadBundledConceptIndex,
    ensureUserConceptIndex,
    loadConceptIndex,
    getDomain,
    detectConceptDomains,
    detectConceptDomain,
    getPrioritySourcesForQuery,
    conceptBonusForSource,
};
