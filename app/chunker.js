/**
 * Ember Node v.ᚠ — Phase 3 Chunker
 *
 * Simple deterministic sliding-window chunker.
 * Splits source text into manageable, overlapping chunks suitable for retrieval.
 */

'use strict';

const DEFAULT_CHUNK_SIZE    = 500;   // characters per chunk
const DEFAULT_CHUNK_OVERLAP = 100;   // character overlap between chunks

/**
 * Generate a deterministic chunk ID from room, cartridge, file, and position.
 *
 * @param {object} opts
 * @param {string}      opts.room
 * @param {string|null} opts.cartridgeId
 * @param {string}      opts.file
 * @param {number}      opts.index
 * @returns {string}
 */
function makeChunkId({ room, cartridgeId, file, index }) {
    const safeName       = file.replace(/[^a-z0-9]/gi, '-').toLowerCase();
    const safeCartridge  = cartridgeId
        ? cartridgeId.replace(/[^a-z0-9]/gi, '-').toLowerCase()
        : null;
    const parts = [room, safeCartridge, safeName, String(index).padStart(3, '0')];
    return parts.filter(Boolean).join('-');
}

/**
 * Split source text into overlapping chunks.
 *
 * @param {object} opts
 * @param {string}      opts.text             - Full source text
 * @param {object}      opts.sourceRecord     - Source metadata from ingest.buildSourceRecord()
 * @param {number}      [opts.chunkSize]      - Max characters per chunk
 * @param {number}      [opts.overlap]        - Character overlap between consecutive chunks
 * @returns {Array<object>}  Array of chunk records
 */
function chunkText({
    text,
    sourceRecord,
    chunkSize = DEFAULT_CHUNK_SIZE,
    overlap   = DEFAULT_CHUNK_OVERLAP,
}) {
    const {
        room,
        cartridgeId,
        file,
        path:       filePath,
        sourceType,
        id:         sourceId,
    } = sourceRecord;

    const shelf  = cartridgeId || 'default';
    const chunks = [];
    let start    = 0;
    let index    = 0;

    while (start < text.length) {
        const end       = Math.min(start + chunkSize, text.length);
        const chunkBody = text.slice(start, end).trim();

        if (chunkBody.length > 0) {
            chunks.push({
                id:          makeChunkId({ room, cartridgeId, file, index }),
                room,
                shelf,
                sourceType,
                cartridgeId: cartridgeId || null,
                file,
                path:        filePath,
                text:        chunkBody,
                index,
                sourceId,
            });
            index++;
        }

        if (end >= text.length) break;
        start = end - overlap;
    }

    return chunks;
}

module.exports = {
    chunkText,
    makeChunkId,
    DEFAULT_CHUNK_SIZE,
    DEFAULT_CHUNK_OVERLAP,
};
