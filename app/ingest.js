/**
 * Ember Node v.ᚠ — Phase 4 Ingest
 *
 * Lightweight local ingestion pipeline.
 * Supports .txt, .md, .pdf, and .docx files.
 * Builds source metadata records for chunking and indexing.
 *
 * Data storage is resolved via storageConfig — see app/storageConfig.js.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const { DATA_ROOT: DATA_DIR, ROOM_DIRS } = require('./storageConfig');

const SUPPORTED_EXTENSIONS = new Set(['.txt', '.md', '.pdf', '.docx']);
const TEXT_EXTENSIONS       = new Set(['.txt', '.md']);

/**
 * Extract plain text content from a file.
 * Supports .txt and .md (sync), and .pdf/.docx (async).
 * Returns the file content string, or null if unsupported.
 *
 * For .pdf and .docx, use extractTextAsync instead.
 *
 * @param {string} filePath
 * @returns {string|null}
 */
function extractText(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (!TEXT_EXTENSIONS.has(ext)) return null;
    try {
        return fs.readFileSync(filePath, 'utf8');
    } catch {
        return null;
    }
}

/**
 * Extract plain text content from a file asynchronously.
 * Handles .txt, .md, .pdf, and .docx.
 * Returns { text, error } — text is null on failure.
 *
 * @param {string} filePath
 * @returns {Promise<{ text: string|null, error: string|null }>}
 */
async function extractTextAsync(filePath) {
    const ext = path.extname(filePath).toLowerCase();

    if (TEXT_EXTENSIONS.has(ext)) {
        try {
            return { text: fs.readFileSync(filePath, 'utf8'), error: null };
        } catch (e) {
            return { text: null, error: 'Could not read file: ' + e.message };
        }
    }

    if (ext === '.pdf') {
        try {
            // pdf-parse is a CommonJS module; require lazily to avoid side-effects in tests
            const pdfParse = require('pdf-parse');
            const buffer   = fs.readFileSync(filePath);
            const data     = await pdfParse(buffer);
            return { text: data.text || '', error: null };
        } catch (e) {
            return { text: null, error: 'PDF extraction failed: ' + e.message };
        }
    }

    if (ext === '.docx') {
        try {
            const mammoth = require('mammoth');
            const result  = await mammoth.extractRawText({ path: filePath });
            return { text: result.value || '', error: null };
        } catch (e) {
            return { text: null, error: 'DOCX extraction failed: ' + e.message };
        }
    }

    return { text: null, error: 'File type not supported: ' + ext };
}

/**
 * Build a source metadata record for an ingested file.
 *
 * Source IDs are deterministic: the same file re-ingested into the same room
 * always produces the same ID, preventing duplicate source records.
 *
 * @param {object} opts
 * @param {string} opts.filePath       - Absolute path to the file
 * @param {string} opts.room           - Target room (hearth | workshop | threshold)
 * @param {string|null} opts.cartridgeId
 * @param {string|null} opts.manifestId
 * @param {string|null} opts.title     - Human-readable title for the source
 * @param {string|null} opts.description - Short description of the source
 * @param {string|null} opts.shelf     - Category or shelf tag
 * @returns {object}
 */
function buildSourceRecord({ filePath, room, cartridgeId = null, manifestId = null, title = null, description = null, shelf = null }) {
    const fileName = path.basename(filePath);
    const ext      = path.extname(filePath).toLowerCase().slice(1);

    // Path relative to the storage root — storage-root-native, no app-folder assumptions.
    // e.g. 'workshop/file.md' rather than 'data/workshop/file.md'.
    const relPath  = path.relative(DATA_DIR, filePath).replace(/\\/g, '/');

    // Deterministic ID: stable across re-ingestion of the same file.
    // Uses room + cartridgeId + normalised relative path — no timestamps.
    const safePath = relPath
        .replace(/\\/g, '/')          // normalise Windows separators
        .replace(/[^a-z0-9/]/gi, '-') // sanitise non-alphanumeric chars
        .toLowerCase()
        .replace(/\/+/g, '-')         // replace slashes with dashes
        .replace(/-+/g, '-')          // collapse consecutive dashes
        .replace(/^-|-$/g, '');       // trim leading/trailing dashes

    const id = [room, cartridgeId, safePath].filter(Boolean).join('-');

    return {
        id,
        room,
        file:             fileName,
        path:             relPath,
        cartridgeId:      cartridgeId  || null,
        manifestId:       manifestId   || null,
        ingestTimestamp:  new Date().toISOString(),
        sourceType:       ext,
        title:            title        || null,
        description:      description  || null,
        shelf:            shelf        || null,
        // lifecycle status: 'waiting' | 'indexed' | 'remembered'
        status:           room === 'threshold' ? 'waiting'
                        : room === 'workshop'  ? 'indexed'
                        : 'remembered',
    };
}

/**
 * Ingest a single file: extract text and build source record.
 * Returns { source, text } or null if the file cannot be processed.
 *
 * @param {object} opts
 * @returns {{ source: object, text: string }|null}
 */
function ingestFile({ filePath, room, cartridgeId = null, manifestId = null, title = null, description = null, shelf = null }) {
    if (!fs.existsSync(filePath)) return null;
    const text = extractText(filePath);
    if (text === null) return null;
    const source = buildSourceRecord({ filePath, room, cartridgeId, manifestId, title, description, shelf });
    return { source, text };
}

/**
 * Recursively collect all supported files from a directory.
 * Includes .txt, .md, .pdf, and .docx files.
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
    extractTextAsync,
    buildSourceRecord,
    ingestFile,
    ingestCartridge,
    collectFiles,
    DATA_DIR,
    ROOM_DIRS,
    SUPPORTED_EXTENSIONS,
    TEXT_EXTENSIONS,
};
