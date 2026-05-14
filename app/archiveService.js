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

const { ARCHIVE_DIR, ARCHIVE_DIRS, ARCHIVE_CACHES_DIR, DATA_ROOT } = require('./storageConfig');
const { buildSourceRecord, collectFiles }       = require('./ingest');
const {
    upsertManifest, loadManifests,
    upsertChunks, upsertEmbeddings, loadChunks,
    removeEmbeddingsByChunkIds,
}                                               = require('./indexStore');
const { chunkText }                             = require('./chunker');
const { extractTextAsync }                      = require('./ingest');
const { generateEmbedding }                     = require('./embeddings');

/** Source class identifier for trusted archive sources (core archive) */
const SOURCE_CLASS_ARCHIVE = 'trusted-archive';

/** Source class identifier for archive cache sources (downloadable expansions) */
const SOURCE_CLASS_ARCHIVE_CACHE = 'archive-cache';

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
        reference:    'reference',
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
 * Scans:
 *   - archive/core/*  (trusted-archive, core trusted knowledge)
 *   - archive/*       (legacy flat shelves — backward compat)
 *   - archive/caches/**  (archive-cache, downloadable expansions)
 *
 * Returns an array of { filePath, shelf, sourceClass } objects.
 *
 * @returns {Array<{ filePath: string, shelf: string, sourceClass: string }>}
 */
function detectArchiveFiles(options = {}) {
    if (!fs.existsSync(ARCHIVE_DIR)) return [];
    const includeArtifacts = options && options.includeArtifacts === true;

    const found = [];

    // Scan each named sub-directory (ARCHIVE_DIRS now points core shelves to archive/core/*)
    for (const [subDirName, subDirPath] of Object.entries(ARCHIVE_DIRS)) {
        if (!fs.existsSync(subDirPath)) continue;
        const files = collectFiles(subDirPath);
        const shelf = shelfFromSubDir(subDirName);
        for (const filePath of files) {
            found.push({ filePath, shelf, sourceClass: SOURCE_CLASS_ARCHIVE });
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
        found.push({ filePath: path.join(ARCHIVE_DIR, entry.name), shelf: 'archive', sourceClass: SOURCE_CLASS_ARCHIVE });
    }

    // Scan archive/caches/ — each cache is a sub-directory with documents/artifacts layers.
    // Default behavior is documents-first; artifacts are included only when explicitly requested.
    if (fs.existsSync(ARCHIVE_CACHES_DIR)) {
        let cacheEntries;
        try { cacheEntries = fs.readdirSync(ARCHIVE_CACHES_DIR, { withFileTypes: true }); }
        catch { cacheEntries = []; }
        for (const cacheEntry of cacheEntries) {
            if (!cacheEntry.isDirectory()) continue;
            const cacheDir = path.join(ARCHIVE_CACHES_DIR, cacheEntry.name);
            const documentsDir = path.join(cacheDir, 'documents');
            const artifactsDir = path.join(cacheDir, 'artifacts');
            const hasDocumentsLayer = fs.existsSync(documentsDir) && fs.statSync(documentsDir).isDirectory();

            const scanRoots = [];
            if (hasDocumentsLayer) {
                scanRoots.push({ dir: documentsDir, type: 'documents' });
                if (includeArtifacts && fs.existsSync(artifactsDir)) {
                    scanRoots.push({ dir: artifactsDir, type: 'artifacts' });
                }
            }

            for (const scanRoot of scanRoots) {
                const files = collectFiles(scanRoot.dir);
                for (const filePath of files) {
                    // Skip manifest.json — it is metadata, not content
                    if (path.basename(filePath) === 'manifest.json') continue;
                    found.push({ filePath, shelf: cacheEntry.name, sourceClass: SOURCE_CLASS_ARCHIVE_CACHE });
                }
            }
        }
    }

    return found;
}

/**
 * Register (but do not index) a single archive file in the manifest.
 * Idempotent — safe to call on already-registered files.
 *
 * @param {string} filePath    Absolute path
 * @param {string} shelf       Archive shelf name
 * @param {string} [sourceClass]  Source class override (defaults to SOURCE_CLASS_ARCHIVE)
 * @returns {object}           Source manifest record
 */
function registerArchiveSource(filePath, shelf, sourceClass) {
    const source = buildSourceRecord({
        filePath,
        room:  'hearth',
        shelf: shelf || 'archive',
    });

    // Tag with source class so retrieval and continuity layers can distinguish origin
    source.sourceClass = sourceClass || SOURCE_CLASS_ARCHIVE;
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

    for (const { filePath, shelf, sourceClass } of files) {
        const relPath = path.relative(DATA_ROOT, filePath).replace(/\\/g, '/');
        const existing = byPath[relPath];

        if (existing && existing.sourceClass === sourceClass) {
            // Already registered with correct source class — skip re-registration
            skipped++;
        } else {
            registerArchiveSource(filePath, shelf, sourceClass);
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
 * Optionally filter by sourceClass.
 *
 * @param {string} [sourceClass]  If provided, only return sources with this class
 * @returns {object[]}
 */
function listArchiveSources(sourceClass) {
    const manifests = loadManifests();
    const ARCHIVE_CLASSES = new Set([SOURCE_CLASS_ARCHIVE, SOURCE_CLASS_ARCHIVE_CACHE]);
    return Object.values(manifests).filter(m => {
        if (sourceClass) return m.sourceClass === sourceClass;
        return ARCHIVE_CLASSES.has(m.sourceClass);
    });
}

module.exports = {
    SOURCE_CLASS_ARCHIVE,
    SOURCE_CLASS_ARCHIVE_CACHE,
    detectArchiveFiles,
    registerArchiveSource,
    bootstrapArchive,
    listArchiveSources,
};
