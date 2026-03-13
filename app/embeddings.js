/**
 * Ember Node v.ᚠ — Phase 3 Embeddings
 *
 * Local embedding generation via Ollama.
 * Falls back to keyword-overlap scoring when embeddings are unavailable.
 *
 * Chat model and embedding model are independently configurable.
 * Default embedding model: nomic-embed-text (or EMBER_EMBEDDING_MODEL env var).
 */

'use strict';

const axios = require('axios');

const OLLAMA_BASE_URL  = process.env.OLLAMA_BASE_URL   || 'http://localhost:11434';
const EMBEDDING_MODEL  = process.env.EMBER_EMBEDDING_MODEL || 'nomic-embed-text';

/**
 * Generate an embedding vector for the given text string using Ollama.
 * Returns a float array, or null if Ollama is unreachable or the model
 * is not installed.
 *
 * @param {string} text
 * @returns {Promise<number[]|null>}
 */
async function generateEmbedding(text) {
    try {
        const response = await axios.post(
            `${OLLAMA_BASE_URL}/api/embeddings`,
            { model: EMBEDDING_MODEL, prompt: text },
            { timeout: 30000 },
        );
        return response.data && Array.isArray(response.data.embedding)
            ? response.data.embedding
            : null;
    } catch {
        return null;
    }
}

/**
 * Cosine similarity between two equal-length float vectors.
 * Returns a value in [-1, 1]; returns 0 for empty or mismatched inputs.
 *
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number}
 */
function cosineSimilarity(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) {
        return 0;
    }
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot   += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
}

/**
 * Simple keyword-overlap scoring used as a fallback when embeddings are
 * unavailable.  Returns a normalised score in [0, 1].
 *
 * @param {string} query
 * @param {string} text
 * @returns {number}
 */
function keywordScore(query, text) {
    const normalise  = s => s.toLowerCase().replace(/[^\w\s]/g, ' ');
    const queryWords = new Set(
        normalise(query).split(/\s+/).filter(w => w.length > 2),
    );
    if (queryWords.size === 0) return 0;

    const textWords = normalise(text).split(/\s+/);
    let matches = 0;
    for (const word of textWords) {
        if (queryWords.has(word)) matches++;
    }
    return Math.min(1, matches / queryWords.size);
}

module.exports = {
    generateEmbedding,
    cosineSimilarity,
    keywordScore,
    EMBEDDING_MODEL,
    OLLAMA_BASE_URL,
};
