'use strict';

const fs = require('fs');
const path = require('path');
const {
    CACHE_SUMMARIES_PATH,
    DOCUMENT_SUMMARIES_PATH,
    ARCHETYPE_MEMORY_PATH,
} = require('./storageConfig');
const { loadChunks, loadManifests } = require('./indexStore');

const STAGES = Object.freeze({
    ALL: 'all',
    DOCUMENT_SUMMARIES: 'document_summaries',
    CACHE_SUMMARIES: 'cache_summaries',
    ARCHETYPE_MEMORY: 'archetype_memory',
});

const ARCHETYPE_GLYPHS = Object.freeze({
    ember_prime: '🜂',
    builder: 'ᛒ',
    warrior: 'ᛏ',
    scholar: 'ᚨ',
    scribe: 'ᚲ',
    mystic: 'ᛇ',
});

const THEME_RULES = [
    { id: 'symbolic_language', label: 'symbolic language', match: ['symbol', 'glyph', 'rune', 'sigil', 'archetype'] },
    { id: 'memory_systems', label: 'memory systems', match: ['memory', 'recall', 'bootstrap', 'continuity'] },
    { id: 'thresholds', label: 'thresholds', match: ['threshold', 'intake', 'inspection', 'triage'] },
    { id: 'myth_tech', label: 'myth tech', match: ['myth', 'myth-tech', 'mirror', 'forge'] },
    { id: 'collapse_continuity', label: 'collapse continuity', match: ['collapse', 'survival', 'sentinel', 'pressure'] },
    { id: 'living_sagas', label: 'living sagas', match: ['saga', 'story', 'narrative', 'chapter'] },
    { id: 'triform_system', label: 'triform system', match: ['hearth', 'council', 'threshold'] },
    { id: 'practice_reflection', label: 'practice reflection', match: ['practice', 'journal', 'reflection', 'discipline'] },
    { id: 'core_orientation', label: 'core orientation', match: ['orientation', 'framework', 'ontology', 'principle'] },
    { id: 'sentinel_identity', label: 'sentinel identity', match: ['warrior', 'builder', 'scholar', 'scribe', 'mystic', 'sentinel'] },
];
// Use a minimum boundary so clipped summaries do not collapse into ultra-short fragments.
const MIN_WORD_BOUNDARY_POSITION = 60;
const SYMBOLIC_GLYPHS_REGEX = /[ᚠ-ᛯ🜂🜁🜃🜄]/g;

function readJson(pathname) {
    if (!fs.existsSync(pathname)) return null;
    try { return JSON.parse(fs.readFileSync(pathname, 'utf8')); }
    catch { return null; }
}

function writeJson(pathname, value) {
    fs.mkdirSync(path.dirname(pathname), { recursive: true });
    fs.writeFileSync(pathname, JSON.stringify(value, null, 2), 'utf8');
}

function slugify(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function summarizeText(rawText, maxChars = 320) {
    const text = String(rawText || '')
        .replace(/\s+/g, ' ')
        .trim();
    if (!text) return '';
    if (text.length <= maxChars) return text;
    const clipped = text.slice(0, maxChars);
    const cut = clipped.lastIndexOf(' ');
    const shouldRespectWordBoundary = cut > MIN_WORD_BOUNDARY_POSITION;
    return (shouldRespectWordBoundary ? clipped.slice(0, cut) : clipped).trim() + '…';
}

function detectThemes(text, limit = 5) {
    const normalized = String(text || '').toLowerCase();
    const found = [];
    for (const rule of THEME_RULES) {
        if (rule.match.some(token => normalized.includes(token))) found.push(rule);
    }
    return found.slice(0, limit);
}

function inferPreferredArchetypes(themes) {
    const ids = new Set();
    themes.forEach(theme => {
        if (!theme) return;
        if (theme.id === 'symbolic_language' || theme.id === 'myth_tech') ids.add('mystic');
        if (theme.id === 'core_orientation' || theme.id === 'symbolic_language') ids.add('scholar');
        if (theme.id === 'practice_reflection' || theme.id === 'collapse_continuity') ids.add('builder');
        if (theme.id === 'collapse_continuity' || theme.id === 'sentinel_identity') ids.add('warrior');
        if (theme.id === 'living_sagas' || theme.id === 'triform_system') ids.add('scribe');
    });
    if (ids.size === 0) ids.add('ember_prime');
    return Array.from(ids).slice(0, 3);
}

function buildDocumentSummaries() {
    const manifests = Object.values(loadManifests());
    const chunks = loadChunks();
    const bySource = {};
    chunks.forEach(chunk => {
        if (!chunk || !chunk.sourceId) return;
        if (!bySource[chunk.sourceId]) bySource[chunk.sourceId] = [];
        bySource[chunk.sourceId].push(chunk);
    });

    const documents = {};
    manifests.forEach(source => {
        if (!source || !source.id) return;
        const sourceChunks = bySource[source.id] || [];
        const textSample = sourceChunks.slice(0, 2).map(c => c.text || '').join(' ');
        const title = String(source.title || source.file || source.id || '').trim();
        const docKey = slugify(path.basename(title || source.id, path.extname(title || ''))) || slugify(source.id);
        if (!docKey) return;
        const mergedText = [source.description, source.shelf, source.path, textSample].filter(Boolean).join(' ');
        const themes = detectThemes(mergedText, 4);
        const preferredArchetypes = inferPreferredArchetypes(themes);
        const symbolMatches = Array.from(new Set((mergedText.match(SYMBOLIC_GLYPHS_REGEX) || [])));

        documents[docKey] = {
            title: title || docKey,
            summary: summarizeText(
                source.description ||
                sourceChunks.map(c => c.text || '').join(' ') ||
                (source.path || ''),
                320,
            ),
            themes: themes.map(t => t.label),
            symbols: symbolMatches.slice(0, 6),
            domains: themes.map(t => t.id),
            preferred_archetypes: preferredArchetypes,
        };
    });

    return {
        version: '0.1.0',
        updated_at: new Date().toISOString(),
        documents,
    };
}

function buildCacheSummaries(documentSummaries) {
    const manifests = Object.values(loadManifests());
    const docsById = (documentSummaries && documentSummaries.documents) || {};
    const caches = {};

    manifests.forEach(source => {
        if (!source || !source.cacheId) return;
        const cacheId = String(source.cacheId).trim();
        if (!cacheId) return;
        if (!caches[cacheId]) {
            caches[cacheId] = {
                summary: '',
                themes: [],
                dominant_archetypes: [],
                documents: [],
            };
        }
        const title = String(source.title || source.file || source.id || '').trim();
        const docKey = slugify(path.basename(title || source.id, path.extname(title || ''))) || slugify(source.id);
        const docSummary = docsById[docKey] || null;
        const docLabel = title || docKey || source.id;
        if (docLabel && !caches[cacheId].documents.includes(docLabel)) {
            caches[cacheId].documents.push(docLabel);
        }
        if (docSummary && Array.isArray(docSummary.themes)) {
            docSummary.themes.forEach(theme => {
                if (!caches[cacheId].themes.includes(theme)) caches[cacheId].themes.push(theme);
            });
        }
        if (docSummary && Array.isArray(docSummary.preferred_archetypes)) {
            docSummary.preferred_archetypes.forEach(id => {
                if (!caches[cacheId].dominant_archetypes.includes(id)) caches[cacheId].dominant_archetypes.push(id);
            });
        }
    });

    Object.keys(caches).forEach(cacheId => {
        const entry = caches[cacheId];
        const themes = entry.themes.slice(0, 5);
        const dominant = entry.dominant_archetypes.slice(0, 4);
        entry.themes = themes;
        entry.dominant_archetypes = dominant;
        entry.summary = summarizeText(
            'Scribe compression map for ' + cacheId + ': ' +
            (themes.length > 0 ? ('themes ' + themes.join(', ')) : 'themes pending') + '; ' +
            entry.documents.length + ' documents in continuity window.',
            220,
        );
    });

    return {
        version: '0.1.0',
        updated_at: new Date().toISOString(),
        caches,
    };
}

/**
 * Build archetype memory geometry from compressed document/cache maps.
 * The output keeps archetypes as retrieval geometries (domains, source priorities,
 * compression posture), not personalities.
 *
 * @param {object} documentSummaries
 * @param {object} cacheSummaries
 * @returns {{version: string, updated_at: string, archetypes: object}}
 */
function buildArchetypeMemory(documentSummaries, cacheSummaries) {
    const docs = Object.values((documentSummaries && documentSummaries.documents) || {});
    const caches = Object.values((cacheSummaries && cacheSummaries.caches) || {});
    const base = {
        ember_prime: {
            summary: '',
            preferred_domains: [],
            preferred_sources: [],
            compression_style: 'balanced continuity synthesis',
            retrieval_geometry: {
                raw_chunk_target: 5,
                cache_summary_limit: 3,
                document_summary_limit: 4,
                source_line_limit: 4,
            },
            prompt_modifier: {
                posture: 'balanced continuity synthesis',
                bias: 'preserve grounding while keeping response lean',
                avoid: 'excessive preamble and duplicate context',
            },
        },
        builder: {
            summary: '',
            preferred_domains: ['collapse_continuity', 'practice_reflection'],
            preferred_sources: [],
            compression_style: 'practical sequence, material constraints, grounded systems',
            retrieval_geometry: {
                raw_chunk_target: 6,
                cache_summary_limit: 3,
                document_summary_limit: 4,
                source_line_limit: 4,
            },
            prompt_modifier: {
                posture: 'practical sequence, constraints, systems, material application',
                bias: 'show structure, constraints, and what can be built',
                avoid: 'abstraction without application',
            },
        },
        warrior: {
            summary: '',
            preferred_domains: ['collapse_continuity', 'sentinel_identity'],
            preferred_sources: [],
            compression_style: 'stakes, discipline, decision, pressure',
            retrieval_geometry: {
                raw_chunk_target: 5,
                cache_summary_limit: 2,
                document_summary_limit: 3,
                source_line_limit: 3,
            },
            prompt_modifier: {
                posture: 'stakes, risk, discipline, decisive action',
                bias: 'clarify risk and immediate bounded moves',
                avoid: 'grandstanding and escalation without need',
            },
        },
        scholar: {
            summary: '',
            preferred_domains: ['core_orientation', 'myth_tech', 'symbolic_language'],
            preferred_sources: [],
            compression_style: 'taxonomy, comparison, conceptual relation',
            retrieval_geometry: {
                raw_chunk_target: 5,
                cache_summary_limit: 3,
                document_summary_limit: 4,
                source_line_limit: 4,
            },
            prompt_modifier: {
                posture: 'structure, comparison, taxonomy, conceptual relation',
                bias: 'define terms and compare frameworks before synthesis',
                avoid: 'unsupported certainty',
            },
        },
        scribe: {
            summary: '',
            preferred_domains: ['living_sagas', 'triform_system'],
            preferred_sources: [],
            compression_style: 'transmission, narrative coherence, signal compression',
            retrieval_geometry: {
                raw_chunk_target: 4,
                cache_summary_limit: 2,
                document_summary_limit: 4,
                source_line_limit: 4,
            },
            prompt_modifier: {
                posture: 'compression, narrative coherence, transmission',
                bias: 'shape output into reusable outlines and drafts',
                avoid: 'ornament without communicative purpose',
            },
        },
        mystic: {
            summary: '',
            preferred_domains: ['symbolic_language', 'myth_tech'],
            preferred_sources: [],
            compression_style: 'symbolic density, threshold resonance, hidden pattern',
            retrieval_geometry: {
                raw_chunk_target: 5,
                cache_summary_limit: 2,
                document_summary_limit: 3,
                source_line_limit: 3,
            },
            prompt_modifier: {
                posture: 'symbolic density, pattern resonance, threshold meaning',
                bias: 'interpret symbols with grounded implications',
                avoid: 'ungrounded mystification',
            },
        },
    };

    const sourceTitles = docs
        .map(d => String(d.title || '').trim())
        .filter(Boolean)
        .slice(0, 12);
    const globalThemes = Array.from(new Set(docs.flatMap(d => Array.isArray(d.domains) ? d.domains : []))).slice(0, 8);
    const cacheThemes = Array.from(new Set(caches.flatMap(c => Array.isArray(c.themes) ? c.themes : []))).slice(0, 8);

    Object.keys(base).forEach(id => {
        const entry = base[id];
        const preferredSourceTitles = docs
            .filter(d => Array.isArray(d.preferred_archetypes) && d.preferred_archetypes.includes(id))
            .map(d => d.title)
            .filter(Boolean)
            .slice(0, 8);
        entry.preferred_sources = preferredSourceTitles;
        const favoredSources = preferredSourceTitles.length > 0 ? preferredSourceTitles.join(', ') : 'pending';
        if (id === 'builder') {
            entry.summary = summarizeText(
                'Builder posture favors practical sequence and constraints across systems. Domains: ' +
                entry.preferred_domains.join(', ') + '. Sources: ' + favoredSources + '.',
                280,
            );
        } else if (id === 'warrior') {
            entry.summary = summarizeText(
                'Warrior posture tracks stakes, risk, and disciplined action under pressure. Domains: ' +
                entry.preferred_domains.join(', ') + '. Sources: ' + favoredSources + '.',
                280,
            );
        } else if (id === 'scholar') {
            entry.summary = summarizeText(
                'Scholar posture organizes structure, comparison, taxonomy, and conceptual relation. Domains: ' +
                entry.preferred_domains.join(', ') + '. Sources: ' + favoredSources + '.',
                280,
            );
        } else if (id === 'scribe') {
            entry.summary = summarizeText(
                'Scribe posture compresses for transmission, narrative coherence, and reusable drafts. Domains: ' +
                entry.preferred_domains.join(', ') + '. Sources: ' + favoredSources + '.',
                280,
            );
        } else if (id === 'mystic') {
            entry.summary = summarizeText(
                'Mystic posture reads symbolic density and threshold resonance while staying grounded. Domains: ' +
                entry.preferred_domains.join(', ') + '. Sources: ' + favoredSources + '.',
                280,
            );
        } else {
            entry.summary = summarizeText(
                'Ember Prime continuity posture balances compression and synthesis. Domains: ' +
                (entry.preferred_domains.length > 0 ? entry.preferred_domains.join(', ') : 'continuity synthesis') +
                '. Sources: ' + favoredSources + '.',
                280,
            );
        }
    });

    if (base.ember_prime) {
        base.ember_prime.preferred_domains = Array.from(new Set([...globalThemes, ...cacheThemes])).slice(0, 8);
        base.ember_prime.preferred_sources = sourceTitles;
    }

    return {
        version: '0.1.0',
        updated_at: new Date().toISOString(),
        archetypes: base,
    };
}

function normalizeStage(stage) {
    const raw = String(stage || STAGES.ALL).trim().toLowerCase();
    if (raw === 'documents' || raw === 'document' || raw === STAGES.DOCUMENT_SUMMARIES) return STAGES.DOCUMENT_SUMMARIES;
    if (raw === 'caches' || raw === 'cache' || raw === STAGES.CACHE_SUMMARIES) return STAGES.CACHE_SUMMARIES;
    if (raw === 'archetypes' || raw === 'archetype' || raw === STAGES.ARCHETYPE_MEMORY) return STAGES.ARCHETYPE_MEMORY;
    return STAGES.ALL;
}

/**
 * Manually refresh memory compression layers.
 * Supports staged runs (`document_summaries`, `cache_summaries`, `archetype_memory`)
 * or a full pass (`all`).
 *
 * @param {{stage?: string}} [options]
 * @returns {{stage: string, refreshed: {documentSummaries: boolean, cacheSummaries: boolean, archetypeMemory: boolean}, documentSummaries: object|null, cacheSummaries: object|null, archetypeMemory: object|null}}
 */
function refreshMemoryCompression({ stage = STAGES.ALL } = {}) {
    const normalizedStage = normalizeStage(stage);
    let documentSummaries = loadDocumentSummaries();
    let cacheSummaries = loadCacheSummaries();
    let archetypeMemory = loadArchetypeMemory();

    const refreshed = {
        documentSummaries: false,
        cacheSummaries: false,
        archetypeMemory: false,
    };

    if (normalizedStage === STAGES.ALL || normalizedStage === STAGES.DOCUMENT_SUMMARIES) {
        documentSummaries = buildDocumentSummaries();
        writeJson(DOCUMENT_SUMMARIES_PATH, documentSummaries);
        refreshed.documentSummaries = true;
    }
    if (normalizedStage === STAGES.ALL || normalizedStage === STAGES.CACHE_SUMMARIES) {
        if (!documentSummaries) documentSummaries = buildDocumentSummaries();
        cacheSummaries = buildCacheSummaries(documentSummaries);
        writeJson(CACHE_SUMMARIES_PATH, cacheSummaries);
        refreshed.cacheSummaries = true;
    }
    if (normalizedStage === STAGES.ALL || normalizedStage === STAGES.ARCHETYPE_MEMORY) {
        if (!documentSummaries) documentSummaries = buildDocumentSummaries();
        if (!cacheSummaries) cacheSummaries = buildCacheSummaries(documentSummaries);
        archetypeMemory = buildArchetypeMemory(documentSummaries, cacheSummaries);
        writeJson(ARCHETYPE_MEMORY_PATH, archetypeMemory);
        refreshed.archetypeMemory = true;
    }

    return {
        stage: normalizedStage,
        refreshed,
        documentSummaries,
        cacheSummaries,
        archetypeMemory,
    };
}

function loadCacheSummaries() {
    return readJson(CACHE_SUMMARIES_PATH);
}

function loadDocumentSummaries() {
    return readJson(DOCUMENT_SUMMARIES_PATH);
}

function loadArchetypeMemory() {
    return readJson(ARCHETYPE_MEMORY_PATH);
}

/**
 * Resolve the archetype memory profile used for lightweight retrieval influence.
 *
 * @param {string} archetypeId
 * @returns {{preferredSources: string[], preferredDomains: string[]}|object|null}
 */
function getArchetypeMemoryProfile(archetypeId) {
    const id = String(archetypeId || 'ember_prime').trim().toLowerCase() || 'ember_prime';
    const memory = loadArchetypeMemory();
    if (!memory || !memory.archetypes || typeof memory.archetypes !== 'object') return null;
    return memory.archetypes[id] || memory.archetypes.ember_prime || null;
}

function getMemoryCompressionStatus() {
    const cacheSummaries = loadCacheSummaries();
    const documentSummaries = loadDocumentSummaries();
    const archetypeMemory = loadArchetypeMemory();
    const cacheCount = cacheSummaries && cacheSummaries.caches ? Object.keys(cacheSummaries.caches).length : 0;
    const documentCount = documentSummaries && documentSummaries.documents ? Object.keys(documentSummaries.documents).length : 0;
    const archetypeCount = archetypeMemory && archetypeMemory.archetypes ? Object.keys(archetypeMemory.archetypes).length : 0;

    return {
        cacheSummariesStatus: cacheCount > 0 ? 'ready' : (cacheSummaries ? 'empty' : 'missing'),
        documentSummariesStatus: documentCount > 0 ? 'ready' : (documentSummaries ? 'empty' : 'missing'),
        archetypeMemoryStatus: archetypeCount > 0 ? 'ready' : (archetypeMemory ? 'empty' : 'missing'),
        cacheSummariesCount: cacheCount,
        documentSummariesCount: documentCount,
        archetypeMemoryCount: archetypeCount,
        updatedAt: {
            cacheSummaries: cacheSummaries && cacheSummaries.updated_at ? cacheSummaries.updated_at : null,
            documentSummaries: documentSummaries && documentSummaries.updated_at ? documentSummaries.updated_at : null,
            archetypeMemory: archetypeMemory && archetypeMemory.updated_at ? archetypeMemory.updated_at : null,
        },
    };
}

function buildSourceAbstract({ sourceId, sourceName, title, cacheId, documentSummaries = null, cacheSummaries = null }) {
    const docs = documentSummaries || loadDocumentSummaries();
    const caches = cacheSummaries || loadCacheSummaries();
    const name = String(sourceName || title || sourceId || '').trim();
    const key = slugify(path.basename(name, path.extname(name))) || slugify(sourceId);
    const docSummary = (docs && docs.documents && key)
        ? docs.documents[key]
        : null;
    const cacheSummary = (cacheId && caches && caches.caches)
        ? caches.caches[String(cacheId)]
        : null;

    return {
        summary: docSummary && docSummary.summary ? String(docSummary.summary) : '',
        themes: docSummary && Array.isArray(docSummary.themes) ? docSummary.themes.slice(0, 3) : [],
        preferred_archetypes: docSummary && Array.isArray(docSummary.preferred_archetypes)
            ? docSummary.preferred_archetypes.map(id => {
                const label = String(id || '');
                const glyph = ARCHETYPE_GLYPHS[label] || '';
                const nameText = label
                    .split(/[_-]+/)
                    .filter(Boolean)
                    .map(part => part[0].toUpperCase() + part.slice(1))
                    .join(' ');
                return (glyph ? glyph + ' ' : '') + nameText;
            }).slice(0, 3)
            : [],
        cache_summary: cacheSummary && cacheSummary.summary ? String(cacheSummary.summary) : '',
    };
}

module.exports = {
    STAGES,
    loadCacheSummaries,
    loadDocumentSummaries,
    loadArchetypeMemory,
    getArchetypeMemoryProfile,
    getMemoryCompressionStatus,
    refreshMemoryCompression,
    buildSourceAbstract,
};
