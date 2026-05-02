'use strict';

const fs = require('fs');
const path = require('path');

const { INDEXES_DIR } = require('./storageConfig');

const BUNDLED_CONCEPT_INDEX_PATH = path.join(__dirname, 'concept-index', 'green-fire-concept-index.json');
const USER_CONCEPT_INDEX_PATH = path.join(INDEXES_DIR, 'green-fire-concept-index.json');
const CONCEPT_BONUS_BASE = 0.1;
const CONCEPT_BONUS_PER_MATCH = 0.04;
const CONCEPT_BONUS_MAX = 0.22;

const DEFAULT_CONCEPT_INDEX = {
    version: '1.0',
    domains: [],
};

function _normalizeText(value) {
    return typeof value === 'string' ? value.toLowerCase().replace(/\s+/g, ' ').trim() : '';
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
    if (fs.existsSync(USER_CONCEPT_INDEX_PATH)) return USER_CONCEPT_INDEX_PATH;

    fs.mkdirSync(path.dirname(USER_CONCEPT_INDEX_PATH), { recursive: true });
    const bundled = loadBundledConceptIndex();
    const payload = bundled || DEFAULT_CONCEPT_INDEX;
    fs.writeFileSync(USER_CONCEPT_INDEX_PATH, JSON.stringify(payload, null, 2), 'utf8');
    return USER_CONCEPT_INDEX_PATH;
}

function loadConceptIndex() {
    const fromUserData = _readConceptIndex(USER_CONCEPT_INDEX_PATH);
    if (fromUserData) return fromUserData;

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

function detectConceptDomain(query, conceptIndex) {
    const normalizedQuery = _normalizeText(query);
    if (!normalizedQuery) return 'general';

    const index = conceptIndex || loadConceptIndex();
    const domains = Array.isArray(index.domains) ? index.domains : [];
    let bestDomain = 'general';
    let bestScore = 0;

    for (const domain of domains) {
        if (!domain || !Array.isArray(domain.keywords)) continue;
        let score = 0;
        for (const keyword of domain.keywords) {
            const normalizedKeyword = _normalizeText(keyword);
            if (!normalizedKeyword) continue;
            if (normalizedQuery.includes(normalizedKeyword)) score += 1;
        }
        if (score > bestScore) {
            bestScore = score;
            bestDomain = domain.id || 'general';
        }
    }

    return bestScore > 0 ? bestDomain : 'general';
}

function conceptBonusForSource(sourceMetaText, conceptDomain, conceptIndex) {
    if (!sourceMetaText || !conceptDomain || conceptDomain === 'general') return 0;
    const index = conceptIndex || loadConceptIndex();
    const domain = getDomain(index, conceptDomain);
    if (!domain || !Array.isArray(domain.prioritizedWorks) || domain.prioritizedWorks.length === 0) return 0;

    const haystack = _normalizeText(sourceMetaText);
    let matches = 0;
    for (const work of domain.prioritizedWorks) {
        const normalizedWork = _normalizeText(work);
        if (!normalizedWork) continue;
        if (haystack.includes(normalizedWork)) matches += 1;
    }
    if (matches === 0) return 0;

    return Math.min(CONCEPT_BONUS_MAX, CONCEPT_BONUS_BASE + ((matches - 1) * CONCEPT_BONUS_PER_MATCH));
}

module.exports = {
    BUNDLED_CONCEPT_INDEX_PATH,
    USER_CONCEPT_INDEX_PATH,
    loadBundledConceptIndex,
    ensureUserConceptIndex,
    loadConceptIndex,
    getDomain,
    detectConceptDomain,
    conceptBonusForSource,
};
