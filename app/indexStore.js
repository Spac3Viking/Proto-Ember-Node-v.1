/**
 * Ember Node v.ᚠ — Phase 3 Index Store
 *
 * JSON-based local index for chunks, embeddings, manifests, and exclusions.
 * All data persists under <data-root>/indexes/ (see app/storageConfig.js).
 *
 * Files:
 *   chunks.json      — array of chunk records
 *   embeddings.json  — map of chunkId → float[] vector
 *   manifests.json   — map of sourceId → source metadata
 *   excluded.json    — array of excluded sourceIds
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const { INDEXES_DIR }  = require('./storageConfig');
const CHUNKS_FILE      = path.join(INDEXES_DIR, 'chunks.json');
const EMBEDDINGS_FILE  = path.join(INDEXES_DIR, 'embeddings.json');
const MANIFESTS_FILE   = path.join(INDEXES_DIR, 'manifests.json');
const EXCLUDED_FILE    = path.join(INDEXES_DIR, 'excluded.json');

// ── Internal helpers ──────────────────────────────────────────────────────────

function ensureDir() {
    if (!fs.existsSync(INDEXES_DIR)) {
        fs.mkdirSync(INDEXES_DIR, { recursive: true });
    }
}

function readJSON(filePath, defaultValue) {
    if (!fs.existsSync(filePath)) return defaultValue;
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return defaultValue;
    }
}

function writeJSON(filePath, data) {
    ensureDir();
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

// ── Chunks ────────────────────────────────────────────────────────────────────

/**
 * Load all chunk records from the index.
 * @returns {object[]}
 */
function loadChunks() {
    return readJSON(CHUNKS_FILE, []);
}

/**
 * Persist the full chunks array.
 * @param {object[]} chunks
 */
function saveChunks(chunks) {
    writeJSON(CHUNKS_FILE, chunks);
}

/**
 * Add or replace chunks for the source IDs present in the provided array.
 * Existing chunks that share a sourceId are removed before inserting.
 *
 * @param {object[]} chunks
 */
function upsertChunks(chunks) {
    const sourceIds = new Set(chunks.map(c => c.sourceId));
    const existing  = loadChunks().filter(c => !sourceIds.has(c.sourceId));
    saveChunks([...existing, ...chunks]);
}

/**
 * Return all chunks belonging to a given room.
 * @param {string} room
 * @returns {object[]}
 */
function getChunksByRoom(room) {
    return loadChunks().filter(c => c.room === room);
}

/**
 * Return all chunks belonging to a given cartridge.
 * @param {string} cartridgeId
 * @returns {object[]}
 */
function getChunksByCartridge(cartridgeId) {
    return loadChunks().filter(c => c.cartridgeId === cartridgeId);
}

// ── Embeddings ────────────────────────────────────────────────────────────────

/**
 * Load the embeddings map (chunkId → float[]).
 * @returns {object}
 */
function loadEmbeddings() {
    return readJSON(EMBEDDINGS_FILE, {});
}

/**
 * Persist the full embeddings map.
 * @param {object} embeddings
 */
function saveEmbeddings(embeddings) {
    writeJSON(EMBEDDINGS_FILE, embeddings);
}

/**
 * Merge new entries into the existing embeddings map.
 * @param {object} entries  { chunkId: float[] }
 */
function upsertEmbeddings(entries) {
    const existing = loadEmbeddings();
    Object.assign(existing, entries);
    saveEmbeddings(existing);
}

/**
 * Remove embeddings for the given chunk IDs.
 * Called before reindexing a source to prevent stale embedding accumulation.
 *
 * @param {string[]} chunkIds
 */
function removeEmbeddingsByChunkIds(chunkIds) {
    if (!chunkIds || chunkIds.length === 0) return;
    const existing = loadEmbeddings();
    for (const id of chunkIds) {
        delete existing[id];
    }
    saveEmbeddings(existing);
}

// ── Manifests ─────────────────────────────────────────────────────────────────

/**
 * Load the manifests map (sourceId → source metadata).
 * @returns {object}
 */
function loadManifests() {
    return readJSON(MANIFESTS_FILE, {});
}

/**
 * Persist the full manifests map.
 * @param {object} manifests
 */
function saveManifests(manifests) {
    writeJSON(MANIFESTS_FILE, manifests);
}

/**
 * Add or update a single source manifest record.
 * @param {string} sourceId
 * @param {object} record
 */
function upsertManifest(sourceId, record) {
    const existing    = loadManifests();
    existing[sourceId] = record;
    saveManifests(existing);
}

// ── Exclusions ────────────────────────────────────────────────────────────────

/**
 * Load the list of excluded sourceIds.
 * @returns {string[]}
 */
function loadExcluded() {
    return readJSON(EXCLUDED_FILE, []);
}

/**
 * Persist the full exclusions list.
 * @param {string[]} sourceIds
 */
function setExcluded(sourceIds) {
    writeJSON(EXCLUDED_FILE, sourceIds);
}

module.exports = {
    loadChunks,
    saveChunks,
    upsertChunks,
    getChunksByRoom,
    getChunksByCartridge,
    loadEmbeddings,
    saveEmbeddings,
    upsertEmbeddings,
    removeEmbeddingsByChunkIds,
    loadManifests,
    saveManifests,
    upsertManifest,
    loadExcluded,
    setExcluded,
    INDEXES_DIR,
    CHUNKS_FILE,
    EMBEDDINGS_FILE,
    MANIFESTS_FILE,
    EXCLUDED_FILE,
};
