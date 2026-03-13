/**
 * Ember Node v.ᚠ — Phase 3 Ingest
 *
 * Lightweight local ingestion pipeline.
 * Supports .txt and .md files.
 * Builds source metadata records for chunking and indexing.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

const ROOM_DIRS = {
    hearth:    path.join(DATA_DIR, 'hearth'),
    workshop:  path.join(DATA_DIR, 'workshop'),
    threshold: path.join(DATA_DIR, 'threshold'),
};

const SUPPORTED_EXTENSIONS = new Set(['.txt', '.md']);

/**
 * Extract plain text content from a file.
 * Returns the file content string, or null if unsupported.
 *
 * @param {string} filePath
 * @returns {string|null}
 */
function extractText(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) return null;
    try {
        return fs.readFileSync(filePath, 'utf8');
    } catch {
        return null;
    }
}

/**
 * Build a source metadata record for an ingested file.
 *
 * @param {object} opts
 * @param {string} opts.filePath       - Absolute path to the file
 * @param {string} opts.room           - Target room (hearth | workshop | threshold)
 * @param {string|null} opts.cartridgeId
 * @param {string|null} opts.manifestId
 * @returns {object}
 */
function buildSourceRecord({ filePath, room, cartridgeId = null, manifestId = null }) {
    const fileName = path.basename(filePath);
    const ext      = path.extname(filePath).toLowerCase().slice(1);
    const relPath  = path.relative(path.join(__dirname, '..'), filePath);

    // Deterministic-ish ID: room + cartridge + sanitised filename + timestamp
    const safeName = fileName.replace(/[^a-z0-9]/gi, '-').toLowerCase();
    const id       = [room, cartridgeId, safeName, Date.now()].filter(Boolean).join('-');

    return {
        id,
        room,
        file: fileName,
        path: relPath,
        cartridgeId:      cartridgeId  || null,
        manifestId:       manifestId   || null,
        ingestTimestamp:  new Date().toISOString(),
        sourceType:       ext,
    };
}

/**
 * Ingest a single file: extract text and build source record.
 * Returns { source, text } or null if the file cannot be processed.
 *
 * @param {object} opts
 * @returns {{ source: object, text: string }|null}
 */
function ingestFile({ filePath, room, cartridgeId = null, manifestId = null }) {
    if (!fs.existsSync(filePath)) return null;
    const text = extractText(filePath);
    if (text === null) return null;
    const source = buildSourceRecord({ filePath, room, cartridgeId, manifestId });
    return { source, text };
}

/**
 * Recursively collect all supported text files from a directory.
 *
 * @param {string} dir
 * @returns {string[]} Array of absolute file paths
 */
function collectFiles(dir) {
    if (!fs.existsSync(dir)) return [];
    const results = [];
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return [];
    }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...collectFiles(full));
        } else if (entry.isFile()) {
            if (SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
                results.push(full);
            }
        }
    }
    return results;
}

/**
 * Ingest all supported files from a cartridge directory.
 * Returns an array of { source, text } records.
 *
 * @param {object} opts
 * @param {string} opts.cartridgeDir
 * @param {string} opts.cartridgeId
 * @param {string} [opts.room='workshop']
 * @returns {Array<{ source: object, text: string }>}
 */
function ingestCartridge({ cartridgeDir, cartridgeId, room = 'workshop' }) {
    const files = collectFiles(cartridgeDir);
    return files
        .map(filePath => ingestFile({ filePath, room, cartridgeId }))
        .filter(Boolean);
}

module.exports = {
    extractText,
    buildSourceRecord,
    ingestFile,
    ingestCartridge,
    collectFiles,
    DATA_DIR,
    ROOM_DIRS,
    SUPPORTED_EXTENSIONS,
};
