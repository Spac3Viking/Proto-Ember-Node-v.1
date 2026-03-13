/**
 * Ember Node v.ᚠ — Phase 3 Retrieval
 *
 * Room-aware local retrieval layer.
 *
 * Retrieval priority:
 *   1. Hearth (remembered, trusted material)
 *   2. Workshop (active, draft material)
 *   3. Threshold (only when explicitly included via the rooms parameter)
 *
 * Scoring strategy:
 *   - Uses cosine similarity when Ollama embeddings are available.
 *   - Falls back to keyword-overlap scoring otherwise.
 */

'use strict';

const { generateEmbedding, cosineSimilarity, keywordScore } = require('./embeddings');
const { loadChunks, loadEmbeddings, loadExcluded }          = require('./indexStore');

const DEFAULT_TOP_K    = 5;
const MIN_SCORE        = 0.05;
const ROOM_PRIORITY    = ['hearth', 'workshop', 'threshold'];

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
 * @param {string[]|null} [opts.rooms=null]  - null → hearth + workshop only
 * @param {string|null}  [opts.cartridgeId]
 * @returns {Promise<Array<{ chunk: object, score: number }>>}
 */
async function retrieve({ query, topK = DEFAULT_TOP_K, rooms = null, cartridgeId = null }) {
    const allChunks  = loadChunks();
    const embeddings = loadEmbeddings();
    const excluded   = loadExcluded();

    // Filter: exclude suppressed sources
    let candidates = allChunks.filter(c => !excluded.includes(c.sourceId));

    // Filter: room scope
    if (rooms !== null) {
        candidates = candidates.filter(c => rooms.includes(c.room));
    } else {
        // Default: hearth + workshop (not threshold unless caller requests it)
        candidates = candidates.filter(c => c.room === 'hearth' || c.room === 'workshop');
    }

    // Filter: specific cartridge
    if (cartridgeId) {
        candidates = candidates.filter(c => c.cartridgeId === cartridgeId);
    }

    if (candidates.length === 0) return [];

    // Embed the query (may return null if Ollama unavailable)
    const queryVector = await generateEmbedding(query);

    const scored = scoreChunks({ chunks: candidates, queryVector, queryText: query, embeddings });

    // Hearth-priority deduplication: fill slots hearth-first, then workshop
    const byRoom = {};
    for (const entry of scored) {
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
};
