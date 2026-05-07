/**
 * Ember Node v.ᚠ — Phase 3 Signal Trace
 *
 * Formats retrieval results into a structured signal trace
 * suitable for display alongside Heart responses.
 */

'use strict';

const { loadManifests } = require('./indexStore');

/**
 * Build a signal trace from the output of retrieve().
 *
 * @param {Array<{ chunk: object, score: number }>} retrievedChunks
 * @returns {Array<object>}  Array of source provenance records
 */
function buildSignalTrace(retrievedChunks) {
    if (!Array.isArray(retrievedChunks)) return [];

    const manifests = loadManifests();

    return retrievedChunks.map(({ chunk, score }) => {
        const manifest = (chunk && chunk.sourceId && manifests[chunk.sourceId]) || {};
        const title = manifest.title || chunk.file;

        return {
            sourceId:    chunk.sourceId || null,
            sourceName:  title,
            title,
            room:        chunk.room,
            shelf:       chunk.shelf,
            cacheId: chunk.cacheId || null,
            file:        chunk.file,
            chunkId:     chunk.id,
            score:       Math.round(score * 100) / 100,
        };
    });
}

/**
 * Format a compact text summary of the signal trace for server-side logging.
 *
 * @param {object[]} sources
 * @returns {string}
 */
function formatSignalTraceSummary(sources) {
    if (!sources || sources.length === 0) return 'no sources';
    return sources
        .map(s => `${s.room}/${s.title || s.file} (${s.score})`)
        .join(', ');
}

module.exports = { buildSignalTrace, formatSignalTraceSummary };
