/**
 * Ember Node v.ᚠ — Phase 11 Archive Service
 *
 * Trusted Archive — privileged curated path that bypasses Threshold workflow.
 *
 * Archive sources are:
 *   - Green Fire Codices, Grimoires, Sagas
 *   - Curated historical / literary / scientific sources
 *   - Archive packs / trusted source bundles
 *
 * On startup, detectArchiveSources() scans DATA_ROOT/archive/ and registers
 * any found files as trusted-archive sources available to Hearth retrieval.
 * No Threshold airlock discipline is applied — these are privileged paths.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const { ARCHIVE_DIR, ARCHIVE_DIRS, DATA_ROOT } = require('./storageConfig');
const { buildSourceRecord, collectFiles }       = require('./ingest');
const {
    upsertManifest, loadManifests,
    upsertChunks, upsertEmbeddings, loadChunks,
    removeEmbeddingsByChunkIds,
}                                               = require('./indexStore');
const { chunkText }                             = require('./chunker');
const { extractTextAsync }                      = require('./ingest');
const { generateEmbedding }                     = require('./embeddings');

/** Source class identifier for trusted archive sources */
const SOURCE_CLASS_ARCHIVE = 'trusted-archive';

/**
 * Shelf name derived from the archive subdirectory name.
 * e.g. 'codices' → 'codex', 'grimoires' → 'grimoire'
 *
 * @param {string} subDir  Name of the archive sub-directory
 * @returns {string}
 */
function shelfFromSubDir(subDir) {
    const map = {
        codices:      'codex',
        grimoires:    'grimoire',
        sagas:        'saga',
        literature:   'literature',
        history:      'history',
        science:      'science',
        'green-fire': 'green-fire',
    };
    return map[subDir] || subDir;
}

/**
 * Remove stale embeddings for a source before re-indexing.
 * @param {string} sourceId
 */
function removeStaleEmbeddingsForSource(sourceId) {
    const oldChunkIds = loadChunks()
        .filter(c => c.sourceId === sourceId)
        .map(c => c.id);
    removeEmbeddingsByChunkIds(oldChunkIds);
}

/**
 * Detect all supported files in the archive directory tree.
 * Returns an array of { filePath, shelf } objects.
 *
 * @returns {Array<{ filePath: string, shelf: string }>}
 */
function detectArchiveFiles() {
    if (!fs.existsSync(ARCHIVE_DIR)) return [];

    const found = [];

    // Scan each named sub-directory
    for (const [subDirName, subDirPath] of Object.entries(ARCHIVE_DIRS)) {
        if (!fs.existsSync(subDirPath)) continue;
        const files = collectFiles(subDirPath);
        const shelf = shelfFromSubDir(subDirName);
        for (const filePath of files) {
            found.push({ filePath, shelf });
        }
    }

    // Also scan the archive root itself (files placed directly there)
    let rootEntries;
    try { rootEntries = fs.readdirSync(ARCHIVE_DIR, { withFileTypes: true }); }
    catch { rootEntries = []; }

    for (const entry of rootEntries) {
        if (!entry.isFile()) continue;
        const ext = path.extname(entry.name).toLowerCase();
        const SUPPORTED = new Set(['.txt', '.md', '.pdf', '.docx']);
        if (!SUPPORTED.has(ext)) continue;
        found.push({ filePath: path.join(ARCHIVE_DIR, entry.name), shelf: 'archive' });
    }

    return found;
}

/**
 * Register (but do not index) a single archive file in the manifest.
 * Idempotent — safe to call on already-registered files.
 *
 * @param {string} filePath  Absolute path
 * @param {string} shelf     Archive shelf name
 * @returns {object}         Source manifest record
 */
function registerArchiveSource(filePath, shelf) {
    const source = buildSourceRecord({
        filePath,
        room:  'hearth',
        shelf: shelf || 'archive',
    });

    // Tag as trusted-archive so retrieval and context maps can distinguish it
    source.sourceClass = SOURCE_CLASS_ARCHIVE;
    source.status      = 'remembered';

    upsertManifest(source.id, source);
    return source;
}

/**
 * Detect, register, and index all archive files that are not yet in the
 * manifest or whose index is outdated.
 *
 * This is called once at server startup.  It is non-blocking per file
 * (uses async text extraction + embeddings) but resolves only after all
 * files have been processed.
 *
 * @returns {Promise<{ registered: number, indexed: number, skipped: number }>}
 */
async function bootstrapArchive() {
    const files    = detectArchiveFiles();
    const manifests = loadManifests();

    // Build a lookup by file path to detect already-registered sources
    const byPath = {};
    Object.values(manifests).forEach(m => {
        if (m.path) byPath[m.path.replace(/\\/g, '/')] = m;
    });

    let registered = 0;
    let indexed    = 0;
    let skipped    = 0;

    for (const { filePath, shelf } of files) {
        const relPath = path.relative(DATA_ROOT, filePath).replace(/\\/g, '/');
        const existing = byPath[relPath];

        if (existing && existing.sourceClass === SOURCE_CLASS_ARCHIVE) {
            // Already registered — skip re-registration but re-index if needed
            skipped++;
        } else {
            registerArchiveSource(filePath, shelf);
            registered++;
        }

        // Re-load manifests to get the current record after upsert
        const currentManifests = loadManifests();
        const byPathNow = {};
        Object.values(currentManifests).forEach(m => {
            if (m.path) byPathNow[m.path.replace(/\\/g, '/')] = m;
        });
        const source = byPathNow[relPath];
        if (!source) continue;

        // Index if no chunks exist yet for this source
        const existingChunks = loadChunks().filter(c => c.sourceId === source.id);
        if (existingChunks.length > 0) continue;

        try {
            const { text } = await extractTextAsync(filePath);
            if (!text) continue;

            const chunks = chunkText({ text, sourceRecord: source });
            removeStaleEmbeddingsForSource(source.id);
            upsertChunks(chunks);

            const embeddingMap = {};
            for (const chunk of chunks) {
                const vector = await generateEmbedding(chunk.text);
                if (vector) embeddingMap[chunk.id] = vector;
            }
            if (Object.keys(embeddingMap).length > 0) {
                upsertEmbeddings(embeddingMap);
            }
            indexed++;
        } catch (err) {
            console.warn('[archive] Failed to index ' + filePath + ': ' + err.message);
        }
    }

    if (files.length > 0) {
        console.log(
            '[archive] Bootstrap complete — ' +
            registered + ' registered, ' +
            indexed + ' indexed, ' +
            skipped + ' already registered.',
        );
    }

    return { registered, indexed, skipped };
}

/**
 * Return all archive source records from the manifest.
 *
 * @returns {object[]}
 */
function listArchiveSources() {
    const manifests = loadManifests();
    return Object.values(manifests).filter(m => m.sourceClass === SOURCE_CLASS_ARCHIVE);
}

module.exports = {
    SOURCE_CLASS_ARCHIVE,
    detectArchiveFiles,
    registerArchiveSource,
    bootstrapArchive,
    listArchiveSources,
};
