/**
 * Ember Node v.ᚠ — Phase 3 Embeddings
 *
 * Local embedding generation via Ollama.
 * Falls back to keyword-overlap scoring when embeddings are unavailable.
 *
 * Supports both Ollama endpoint variants automatically:
 *   - /api/embeddings  (older Ollama, body: { prompt })
 *   - /api/embed       (newer Ollama ≥0.1.33, body: { input })
 * The first working endpoint is cached for the duration of the session.
 *
 * Chat model and embedding model are independently configurable.
 * Default embedding model: nomic-embed-text (or EMBER_EMBEDDING_MODEL env var).
 */

'use strict';

const axios = require('axios');

const OLLAMA_BASE_URL  = process.env.OLLAMA_BASE_URL   || 'http://localhost:11434';
const EMBEDDING_MODEL  = process.env.EMBER_EMBEDDING_MODEL || 'nomic-embed-text';

// ── Endpoint definitions ──────────────────────────────────────────────────────

// Ordered list of endpoints to try.  The first one that returns a valid vector
// wins and is cached for the rest of the session.
const EMBEDDING_ENDPOINTS = [
    { path: '/api/embeddings', bodyKey: 'prompt',  vectorKey: 'embedding'  },
    { path: '/api/embed',      bodyKey: 'input',   vectorKey: 'embeddings' },
];

// Module-level cache: set once a working endpoint is confirmed.
let _activeEndpoint    = null;  // reference to one of EMBEDDING_ENDPOINTS
let _embeddingsWorking = false;

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Extract a flat float[] from an Ollama response body.
 * /api/embeddings returns  { embedding: [...] }        (flat array)
 * /api/embed      returns  { embeddings: [[...]] }     (array of arrays)
 */
function _extractVector(data, vectorKey) {
    const raw = data[vectorKey];
    if (!Array.isArray(raw) || raw.length === 0) return null;
    // Handle both flat array and array-of-arrays
    if (Array.isArray(raw[0])) return raw[0].length > 0 ? raw[0] : null;
    return raw;
}

/**
 * Return the ordered list of endpoints, with the cached working endpoint
 * promoted to the front when one is known.
 */
function _orderedEndpoints() {
    if (!_activeEndpoint) return EMBEDDING_ENDPOINTS;
    return [
        _activeEndpoint,
        ...EMBEDDING_ENDPOINTS.filter(ep => ep !== _activeEndpoint),
    ];
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generate an embedding vector for the given text string using Ollama.
 * Automatically tries both endpoint variants; caches the working one.
 * Returns a float array, or null if no endpoint is available.
 *
 * @param {string} text
 * @returns {Promise<number[]|null>}
 */
async function generateEmbedding(text) {
    for (const ep of _orderedEndpoints()) {
        try {
            const body     = { model: EMBEDDING_MODEL, [ep.bodyKey]: text };
            const response = await axios.post(
                `${OLLAMA_BASE_URL}${ep.path}`,
                body,
                { timeout: 30000 },
            );
            const vec = _extractVector(response.data, ep.vectorKey);
            if (vec && vec.length > 0) {
                _activeEndpoint    = ep;
                _embeddingsWorking = true;
                return vec;
            }
        } catch {
            // Endpoint unavailable or incompatible — try the next one
        }
    }
    _embeddingsWorking = false;
    return null;
}

/**
 * Return the current embedding subsystem status.
 * Exposed for use in /api/status.
 *
 * @returns {{ working: boolean, activeEndpoint: string|null, model: string }}
 */
function getEmbeddingStatus() {
    return {
        working:        _embeddingsWorking,
        activeEndpoint: _activeEndpoint ? _activeEndpoint.path : null,
        model:          EMBEDDING_MODEL,
    };
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
    getEmbeddingStatus,
    cosineSimilarity,
    keywordScore,
    EMBEDDING_MODEL,
    OLLAMA_BASE_URL,
    EMBEDDING_ENDPOINTS,
};
