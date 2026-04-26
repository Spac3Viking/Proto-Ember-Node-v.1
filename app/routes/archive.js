'use strict';

/**
 * Ember Node v.ᚠ — Phase 11 Archive Routes
 *
 * GET  /api/archive          — list all trusted archive sources
 * POST /api/archive/bootstrap — re-scan and index archive directory
 * POST /api/archive/ingest   — ingest a file directly into the archive
 */

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const { readLimiter, writeLimiter, indexLimiter } = require('../rateLimiters');
const { ARCHIVE_DIR, ARCHIVE_DIRS, DATA_ROOT }    = require('../storageConfig');
const {
    listArchiveSources,
    bootstrapArchive,
    registerArchiveSource,
    SOURCE_CLASS_ARCHIVE,
}                                                  = require('../archiveService');
const { extractTextAsync }                         = require('../ingest');
const { chunkText }                                = require('../chunker');
const { generateEmbedding }                        = require('../embeddings');
const {
    upsertManifest, loadChunks,
    upsertChunks, upsertEmbeddings, removeEmbeddingsByChunkIds,
}                                                  = require('../indexStore');
const {
    ARCHIVE_ENDPOINTS,
    CANONICAL_CACHE_PACKAGE_IDS,
    fetchAvailableArchiveCachePackages,
    listInstalledArchiveCaches,
    compareInstalledWithUpstream,
    installArchiveCachePackage,
}                                                  = require('../archiveCacheService');

const router = express.Router();

const VALID_SHELVES = Object.keys(ARCHIVE_DIRS);
const ALLOWED_EXTENSIONS = new Set(['.txt', '.md', '.pdf', '.docx']);

function removeStaleEmbeddingsForSource(sourceId) {
    const oldChunkIds = loadChunks()
        .filter(c => c.sourceId === sourceId)
        .map(c => c.id);
    removeEmbeddingsByChunkIds(oldChunkIds);
}

/**
 * GET /api/archive
 * Returns all registered trusted archive sources.
 */
router.get('/api/archive', readLimiter, (req, res) => {
    const { shelf } = req.query;
    let sources = listArchiveSources();
    if (shelf) sources = sources.filter(s => s.shelf === shelf);
    res.json({ sources, shelves: VALID_SHELVES });
});

/**
 * POST /api/archive/bootstrap
 * Re-scan the archive directory and register / index any new files.
 * Returns a summary of what was found and processed.
 */
router.post('/api/archive/bootstrap', indexLimiter, async (req, res) => {
    try {
        const result = await bootstrapArchive();
        res.json({ success: true, ...result });
    } catch (err) {
        console.error('[archive/bootstrap] Error:', err.message);
        res.status(500).json({ error: 'Archive bootstrap failed: ' + err.message });
    }
});

/**
 * POST /api/archive/ingest
 * Body: { filename, content, shelf, title?, description?, encoding? }
 *
 * Directly ingest a file into the trusted archive (bypasses Threshold).
 * shelf must be one of: codices, grimoires, sagas, literature, history, science, green-fire
 */
router.post('/api/archive/ingest', writeLimiter, async (req, res) => {
    try {
        const {
            filename,
            content,
            shelf       = 'literature',
            title       = null,
            description = null,
            encoding    = 'utf8',
        } = req.body;

        if (!filename || typeof filename !== 'string') {
            return res.status(400).json({ error: 'filename is required' });
        }
        if (typeof content !== 'string') {
            return res.status(400).json({ error: 'content is required' });
        }
        if (!VALID_SHELVES.includes(shelf)) {
            return res.status(400).json({
                error: 'Invalid shelf "' + shelf + '". Valid shelves: ' + VALID_SHELVES.join(', '),
            });
        }

        const ext = path.extname(filename).toLowerCase();
        if (!ALLOWED_EXTENSIONS.has(ext)) {
            return res.status(400).json({
                error: 'Unsupported file type "' + ext + '". Allowed: ' + [...ALLOWED_EXTENSIONS].join(', '),
            });
        }

        const shelfDir = ARCHIVE_DIRS[shelf];
        if (!fs.existsSync(shelfDir)) {
            fs.mkdirSync(shelfDir, { recursive: true });
        }

        const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
        const filePath = path.join(shelfDir, safeName);

        if (encoding === 'base64') {
            const buffer = Buffer.from(content, 'base64');
            fs.writeFileSync(filePath, buffer);
        } else {
            fs.writeFileSync(filePath, content, 'utf8');
        }

        const source = registerArchiveSource(filePath, shelf);
        if (title)       { source.title       = title;       upsertManifest(source.id, source); }
        if (description) { source.description = description; upsertManifest(source.id, source); }

        // Index immediately
        try {
            const { text } = await extractTextAsync(filePath);
            if (text) {
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
                source.status = 'remembered';
                upsertManifest(source.id, source);
            }
        } catch { /* indexing is best-effort */ }

        res.json({ success: true, source, shelf });
    } catch (error) {
        console.error('[archive/ingest] Error:', error.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

/**
 * GET /api/archive/caches/available
 * Fetch canonical cache package metadata from Green Fire Archive index.json.
 * Falls back to local cached metadata when upstream is unavailable.
 */
router.get('/api/archive/caches/available', readLimiter, async (req, res) => {
    try {
        const result = await fetchAvailableArchiveCachePackages();
        res.json({
            success: true,
            endpoints: ARCHIVE_ENDPOINTS,
            canonicalPackageIds: CANONICAL_CACHE_PACKAGE_IDS,
            ...result,
        });
    } catch (err) {
        res.status(500).json({ error: 'Could not load archive cache index: ' + err.message });
    }
});

/**
 * GET /api/archive/caches/installed
 * List canonical Green Fire cache packages installed in local data root.
 */
router.get('/api/archive/caches/installed', readLimiter, (req, res) => {
    const caches = listInstalledArchiveCaches();
    res.json({
        success: true,
        canonicalPackageIds: CANONICAL_CACHE_PACKAGE_IDS,
        caches,
    });
});

/**
 * GET /api/archive/caches/updates
 * Compare local installed versions against upstream versions.
 */
router.get('/api/archive/caches/updates', readLimiter, async (req, res) => {
    try {
        const result = await compareInstalledWithUpstream();
        res.json({
            success: true,
            canonicalPackageIds: CANONICAL_CACHE_PACKAGE_IDS,
            ...result,
        });
    } catch (err) {
        res.status(500).json({ error: 'Could not compare archive cache versions: ' + err.message });
    }
});

/**
 * POST /api/archive/caches/install
 * Body: { packageId }
 *
 * Installs one canonical Green Fire cache zip package.
 * - green-fire-core merges into archive/core/
 * - all other canonical packages install into archive/caches/<package-id>/
 */
router.post('/api/archive/caches/install', writeLimiter, async (req, res) => {
    try {
        const packageId = typeof req.body.packageId === 'string' ? req.body.packageId.trim() : '';

        if (!packageId) {
            return res.status(400).json({ error: 'packageId is required' });
        }

        if (!CANONICAL_CACHE_PACKAGE_IDS.includes(packageId)) {
            return res.status(400).json({
                error: 'Unknown packageId "' + packageId + '". Valid IDs: ' + CANONICAL_CACHE_PACKAGE_IDS.join(', '),
            });
        }

        const installed = await installArchiveCachePackage({ packageId });
        const bootstrap = await bootstrapArchive();

        res.json({
            success: true,
            installed,
            bootstrap,
        });
    } catch (err) {
        res.status(500).json({ error: 'Archive cache install failed: ' + err.message });
    }
});

module.exports = router;
