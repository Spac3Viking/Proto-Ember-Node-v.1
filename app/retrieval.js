/**
 * Ember Node v.ᚠ — Phase 3 Retrieval (Phase 11: room-bounded + archive-aware)
 *
 * Room-aware local retrieval layer.
 *
 * Retrieval priority:
 *   1. Hearth (remembered + trusted-archive material)
 *   2. Workshop (active, draft material)
 *   3. Threshold (only when explicitly included via the rooms parameter)
 *
 * Phase 11 retrieval pools by room:
 *   hearth    — hearth-native sources + trusted-archive sources
 *   workshop  — workshop-draft sources only
 *   threshold — threshold-intake sources only
 *
 * Scoring strategy:
 *   - Uses cosine similarity when Ollama embeddings are available.
 *   - Falls back to keyword-overlap scoring otherwise.
 */

'use strict';

const { generateEmbedding, cosineSimilarity, keywordScore } = require('./embeddings');
const { loadChunks, loadEmbeddings, loadExcluded, loadManifests }          = require('./indexStore');
const { SOURCE_CLASS_ARCHIVE } = require('./archiveService');

const DEFAULT_TOP_K    = 5;
const MIN_SCORE        = 0.05;
const ROOM_PRIORITY    = ['hearth', 'workshop', 'threshold'];

/**
 * Maximum chunks selected per source in multi-source retrieval.
 * Prevents a single large source from dominating the result set.
 */
const PER_SOURCE_TOP_K = 3;

/**
 * Score a set of chunks against a query.
 *
 * @param {object}       opts
 * @param {object[]}     opts.chunks
 * @param {number[]|null} opts.queryVector  - null triggers keyword fallback
 * @param {string}       opts.queryText
 * @param {object}       opts.embeddings    - chunkId → float[]
 * @returns {Array<{ chunk: object, score: number }>}
 */
function scoreChunks({ chunks, queryVector, queryText, embeddings }) {
    const useEmbeddings = queryVector !== null && queryVector !== undefined;
    return chunks
        .map(chunk => {
            let score;
            if (useEmbeddings) {
                const vec = embeddings[chunk.id];
                score     = vec ? cosineSimilarity(queryVector, vec) : 0;
            } else {
                score = keywordScore(queryText, chunk.text);
            }
            return { chunk, score };
        })
        .filter(({ score }) => score >= MIN_SCORE);
}

/**
 * Retrieve the most relevant chunks for a query string.
 *
 * @param {object}       opts
 * @param {string}       opts.query
 * @param {number}       [opts.topK=5]
 * @param {string[]|null} [opts.rooms=null]  - null → hearth + archive + workshop
 * @param {string|null}  [opts.cartridgeId]
 * @param {string|null}  [opts.sourceClass] - filter to a specific source class
 * @returns {Promise<Array<{ chunk: object, score: number }>>}
 */
async function retrieve({ query, topK = DEFAULT_TOP_K, rooms = null, cartridgeId = null, sourceClass = null }) {
    const allChunks  = loadChunks();
    const embeddings = loadEmbeddings();
    const excluded   = loadExcluded();
    const manifests  = loadManifests();

    // Build a lookup of sourceId → sourceClass from manifests
    const sourceClassById = {};
    Object.values(manifests).forEach(m => {
        if (m.sourceClass) sourceClassById[m.id] = m.sourceClass;
    });

    // Filter: exclude suppressed sources
    let candidates = allChunks.filter(c => !excluded.includes(c.sourceId));

    // Filter: source class (optional explicit filter)
    if (sourceClass) {
        candidates = candidates.filter(c => sourceClassById[c.sourceId] === sourceClass);
    }

    // Filter: room scope
    if (rooms !== null) {
        // When caller specifies rooms explicitly, include archive chunks for hearth
        candidates = candidates.filter(c => {
            if (rooms.includes(c.room)) return true;
            // Include archive (trusted-archive) when hearth is in scope
            if (rooms.includes('hearth') && sourceClassById[c.sourceId] === SOURCE_CLASS_ARCHIVE) return true;
            return false;
        });
    } else {
        // Default: hearth + archive + workshop (not threshold unless caller requests it)
        candidates = candidates.filter(c => {
            if (c.room === 'hearth' || c.room === 'workshop') return true;
            // Trusted archive sources are always available to the default pool
            if (sourceClassById[c.sourceId] === SOURCE_CLASS_ARCHIVE) return true;
            return false;
        });
    }

    // Filter: specific cartridge
    if (cartridgeId) {
        candidates = candidates.filter(c => c.cartridgeId === cartridgeId);
    }

    if (candidates.length === 0) return [];

    // Embed the query (may return null if Ollama unavailable)
    const queryVector = await generateEmbedding(query);

    const scored = scoreChunks({ chunks: candidates, queryVector, queryText: query, embeddings });

    // Per-source top-k: cap contribution from each individual source to
    // PER_SOURCE_TOP_K chunks.  This prevents a single large document from
    // monopolising all retrieval slots and ensures multi-source synthesis.
    const bySource = {};
    for (const entry of scored) {
        const sid = entry.chunk.sourceId;
        if (!bySource[sid]) bySource[sid] = [];
        bySource[sid].push(entry);
    }
    const perSourceCapped = [];
    for (const entries of Object.values(bySource)) {
        entries.sort((a, b) => b.score - a.score);
        perSourceCapped.push(...entries.slice(0, PER_SOURCE_TOP_K));
    }

    // Hearth-priority deduplication: fill slots hearth-first, then workshop
    const byRoom = {};
    for (const entry of perSourceCapped) {
        const r = entry.chunk.room;
        if (!byRoom[r]) byRoom[r] = [];
        byRoom[r].push(entry);
    }

    // Sort each room bucket by descending score
    for (const r of Object.keys(byRoom)) {
        byRoom[r].sort((a, b) => b.score - a.score);
    }

    const result = [];
    const seen   = new Set();

    for (const r of ROOM_PRIORITY) {
        if (!byRoom[r]) continue;
        for (const entry of byRoom[r]) {
            if (seen.has(entry.chunk.id)) continue;
            seen.add(entry.chunk.id);
            result.push(entry);
            if (result.length >= topK) break;
        }
        if (result.length >= topK) break;
    }

    return result;
}

/**
 * Build a grounded LLM prompt from retrieved chunks.
 * When no chunks are provided, returns the original query unchanged.
 *
 * @param {object}  opts
 * @param {string}  opts.query
 * @param {Array}   opts.retrievedChunks
 * @returns {string}
 */
function buildGroundedPrompt({ query, retrievedChunks }) {
    if (!retrievedChunks || retrievedChunks.length === 0) return query;

    const contextBlocks = retrievedChunks
        .map(({ chunk }) =>
            `[Source: ${chunk.room}/${chunk.shelf}/${chunk.file}]\n${chunk.text}`,
        )
        .join('\n\n---\n\n');

    return (
        `You are answering based on the following local knowledge sources:\n\n` +
        `${contextBlocks}\n\n---\n\n` +
        `User question: ${query}`
    );
}

module.exports = {
    retrieve,
    buildGroundedPrompt,
    scoreChunks,
    DEFAULT_TOP_K,
    MIN_SCORE,
    PER_SOURCE_TOP_K,
};
