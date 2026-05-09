'use strict';

/**
 * Ember Node v.ᚠ — Source Routes
 *
 * POST /api/ingest
 * POST /api/index/cache/:id
 * POST /api/index/file
 * GET  /api/sources
 * POST /api/sources/:id/exclude
 * GET  /api/sources/:id
 * POST /api/sources/:id/remember
 * POST /api/council/drafts
 * GET  /api/council/drafts
 * POST /api/sources/:id/flag
 * POST /api/sources/:id/inspect
 * POST /api/sources/:id/reject
 */

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const { readLimiter, writeLimiter, indexLimiter } = require('../rateLimiters');
const { DATA_ROOT, resolveSourcePath }            = require('../storageConfig');
const { resolveBundledCacheDir } = require('../cacheLoader');
const { ingestCache, extractTextAsync, buildSourceRecord } = require('../ingest');
const { chunkText }                                   = require('../chunker');
const { generateEmbedding }                           = require('../embeddings');
const {
    upsertChunks, upsertEmbeddings, upsertManifest,
    loadManifests, loadExcluded, setExcluded,
    loadChunks, removeEmbeddingsByChunkIds,
}                                                     = require('../indexStore');
const { upsertIntakeFile }                            = require('../intakeState');
const {
    buildSourceAbstract,
    loadDocumentSummaries,
    loadCacheSummaries,
} = require('../memoryCompression');

const router = express.Router();

/** Maximum number of characters returned by the source preview endpoint. */
const PREVIEW_MAX_LENGTH = 600;
const VALID_ROOMS = ['hearth', 'council', 'threshold'];

function normalizeRoom(room) {
    // Legacy migration alias. Remove after user data migration stabilizes.
    return room === 'workshop' ? 'council' : room;
}

function isSafeManifestKey(value) {
    return typeof value === 'string'
        && value.length > 0
        && value !== '__proto__'
        && value !== 'prototype'
        && value !== 'constructor';
}

/**
 * Remove any stored embeddings belonging to the old chunks of a source,
 * preventing stale embedding accumulation across reindex cycles.
 *
 * @param {string} sourceId
 */
function removeStaleEmbeddingsForSource(sourceId) {
    const oldChunkIds = loadChunks()
        .filter(c => c.sourceId === sourceId)
        .map(c => c.id);
    removeEmbeddingsByChunkIds(oldChunkIds);
}

// ── Phase 4: ingestion ────────────────────────────────────────────────────────

/**
 * POST /api/ingest
 * Body: { filename, content, room?, cacheId?, title?, description?, shelf?, encoding? }
 */
router.post('/api/ingest', writeLimiter, async (req, res) => {
    try {
        const {
            filename,
            content,
            room: roomInput = 'threshold',
            cacheId = null,
            title       = null,
            description = null,
            shelf       = null,
            encoding    = 'utf8',
        } = req.body;

        if (!filename || typeof filename !== 'string') {
            return res.status(400).json({ error: 'filename is required' });
        }
        if (typeof content !== 'string') {
            return res.status(400).json({ error: 'content is required' });
        }

        const ext = path.extname(filename).toLowerCase();
        const ALLOWED_EXTENSIONS = ['.txt', '.md', '.pdf', '.docx'];

        const room = normalizeRoom(roomInput);
        if (!VALID_ROOMS.includes(room)) {
            return res.status(400).json({ error: 'Invalid room "' + room + '"' });
        }

        const roomDir = path.join(DATA_ROOT, room);
        if (!fs.existsSync(roomDir)) {
            fs.mkdirSync(roomDir, { recursive: true });
        }

        const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
        const filePath = path.join(roomDir, safeName);

        if (!ALLOWED_EXTENSIONS.includes(ext)) {
            const safeId = [room, cacheId, safeName.replace(/[^a-z0-9]/gi, '-').toLowerCase()]
                .filter(Boolean)
                .join('-')
                .replace(/-+/g, '-')
                .replace(/^-|-$/g, '');
            const metaRecord = {
                id:               safeId,
                room,
                file:             safeName,
                path:             room + '/' + safeName,
                cacheId:      cacheId || null,
                manifestId:       null,
                ingestTimestamp:  new Date().toISOString(),
                sourceType:       ext.slice(1) || 'unknown',
                title:            title        || null,
                description:      description  || null,
                shelf:            shelf        || null,
                status:           'waiting',
                metaOnly:         true,
            };
            upsertManifest(metaRecord.id, metaRecord);
            return res.json({ success: true, source: metaRecord, metaOnly: true });
        }

        if (encoding === 'base64') {
            const buffer = Buffer.from(content, 'base64');
            fs.writeFileSync(filePath, buffer);
        } else {
            fs.writeFileSync(filePath, content, 'utf8');
        }

        const source = buildSourceRecord({ filePath, room, cacheId, title, description, shelf });
        upsertManifest(source.id, source);

        res.json({ success: true, source });
    } catch (error) {
        console.error('Error ingesting file:', error.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// ── Phase 3: indexing ─────────────────────────────────────────────────────────

/**
 * POST /api/index/cache/:id
 * Body: { room? }
 */
router.post('/api/index/cache/:id', indexLimiter, async (req, res) => {
    try {
        const cacheId  = req.params.id;
        const cacheDir = resolveBundledCacheDir(cacheId);

        if (!cacheDir || !fs.existsSync(cacheDir)) {
            return res.status(404).json({ error: 'Cache "' + cacheId + '" not found' });
        }

        const room = normalizeRoom((req.body && req.body.room) || 'council');

        const ingested = ingestCache({ cacheDir, cacheId, room });

        let totalChunks   = 0;
        let totalEmbedded = 0;

        for (const { source, text } of ingested) {
            const chunks = chunkText({ text, sourceRecord: source });

            removeStaleEmbeddingsForSource(source.id);

            upsertChunks(chunks);
            upsertManifest(source.id, source);
            totalChunks += chunks.length;

            const embeddingMap = {};
            for (const chunk of chunks) {
                const vector = await generateEmbedding(chunk.text);
                if (vector) {
                    embeddingMap[chunk.id] = vector;
                    totalEmbedded++;
                }
            }
            if (Object.keys(embeddingMap).length > 0) {
                upsertEmbeddings(embeddingMap);
            }
        }

        res.json({
            success:             true,
            cacheId,
            filesIngested:       ingested.length,
            chunksCreated:       totalChunks,
            embeddingsGenerated: totalEmbedded,
        });
    } catch (error) {
        console.error('Error indexing cache:', error.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

/**
 * POST /api/index/file
 * Body: { sourceId, targetRoom? }
 */
router.post('/api/index/file', indexLimiter, async (req, res) => {
    try {
        const { sourceId, targetRoom: targetRoomInput } = req.body;
        if (!sourceId) {
            return res.status(400).json({ error: 'sourceId is required' });
        }
        if (!isSafeManifestKey(sourceId)) {
            return res.status(400).json({ error: 'Invalid source id' });
        }

        const manifests = loadManifests();
        const source    = manifests[sourceId];
        if (!source) {
            return res.status(404).json({ error: 'Source not found in manifest' });
        }

        if (targetRoomInput) {
            const targetRoom = normalizeRoom(targetRoomInput);
            if (!VALID_ROOMS.includes(targetRoom)) {
                return res.status(400).json({ error: 'Invalid room "' + targetRoom + '"' });
            }

            if (source.room !== targetRoom) {
                const oldAbsPath = resolveSourcePath(source.path);
                const newRoomDir = path.join(DATA_ROOT, targetRoom);

                if (!fs.existsSync(newRoomDir)) {
                    fs.mkdirSync(newRoomDir, { recursive: true });
                }

                const newAbsPath = path.join(newRoomDir, path.basename(source.path));
                const newRelPath = path.relative(DATA_ROOT, newAbsPath).replace(/\\/g, '/');

                const dataRoot = path.resolve(DATA_ROOT);
                if (oldAbsPath && path.resolve(oldAbsPath).startsWith(dataRoot)) {
                    try {
                        fs.renameSync(oldAbsPath, newAbsPath);
                    } catch (moveErr) {
                        try {
                            fs.copyFileSync(oldAbsPath, newAbsPath);
                            fs.unlinkSync(oldAbsPath);
                        } catch (copyErr) {
                            return res.status(500).json({
                                error: 'Failed to move file to target room: ' + copyErr.message,
                            });
                        }
                    }
                    source.path = newRelPath;
                }

                source.room   = targetRoom;
                source.status = targetRoom === 'hearth'    ? 'remembered'
                              : targetRoom === 'council'   ? 'indexed'
                              : 'waiting';
                upsertManifest(sourceId, source);
            }
        }

        const filePath = resolveSourcePath(source.path);
        if (!filePath || !fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'File not found on disk' });
        }

        const { text, error: extractError } = await extractTextAsync(filePath);
        if (!text) {
            const reason = extractError || 'Could not extract text from file';
            return res.status(400).json({ error: reason });
        }

        source.status = 'indexed';
        upsertManifest(sourceId, source);

        const chunks = chunkText({ text, sourceRecord: source });

        removeStaleEmbeddingsForSource(sourceId);

        upsertChunks(chunks);

        let embeddingsGenerated = 0;
        const embeddingMap      = {};
        for (const chunk of chunks) {
            const vector = await generateEmbedding(chunk.text);
            if (vector) {
                embeddingMap[chunk.id] = vector;
                embeddingsGenerated++;
            }
        }
        if (Object.keys(embeddingMap).length > 0) {
            upsertEmbeddings(embeddingMap);
        }

        res.json({ success: true, sourceId, chunksCreated: chunks.length, embeddingsGenerated });
    } catch (error) {
        console.error('Error indexing file:', error.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// ── Phase 3: source management ────────────────────────────────────────────────

/**
 * GET /api/sources
 * Query params: room?, cacheId?
 */
router.get('/api/sources', (req, res) => {
    const { room, cacheId } = req.query;
    let sources = Object.values(loadManifests());
    if (room) {
        const normalizedRoom = normalizeRoom(room);
        sources = sources.filter(s => normalizeRoom(s.room) === normalizedRoom);
    }
    if (cacheId) sources = sources.filter(s => s.cacheId === cacheId);
    const documentSummaries = loadDocumentSummaries();
    const cacheSummaries = loadCacheSummaries();
    sources = sources.map(source => ({
        ...source,
        room: normalizeRoom(source.room),
        abstract: buildSourceAbstract({
            sourceId: source.id,
            sourceName: source.title || source.file || source.id,
            title: source.title || source.file || source.id,
            cacheId: source.cacheId || null,
            documentSummaries,
            cacheSummaries,
        }),
    }));
    res.json({ sources });
});

/**
 * POST /api/sources/:id/exclude
 * Body: { exclude: bool }
 */
router.post('/api/sources/:id/exclude', writeLimiter, (req, res) => {
    const { id }             = req.params;
    const { exclude = true } = req.body || {};
    const current            = loadExcluded();
    const updated            = exclude
        ? (current.includes(id) ? current : [...current, id])
        : current.filter(e => e !== id);
    setExcluded(updated);
    res.json({ success: true, sourceId: id, excluded: exclude });
});

/**
 * GET /api/sources/:id
 * Returns the full source manifest plus a short plaintext preview.
 */
router.get('/api/sources/:id', readLimiter, (req, res) => {
    if (!isSafeManifestKey(req.params.id)) {
        return res.status(400).json({ error: 'Invalid source id' });
    }
    const manifests = loadManifests();
    const source    = manifests[req.params.id];
    if (!source) return res.status(404).json({ error: 'Source not found' });

    let preview = null;
    const filePath = resolveSourcePath(source.path);
    if (filePath && fs.existsSync(filePath)) {
        const ext = path.extname(filePath).toLowerCase();
        if (ext === '.txt' || ext === '.md') {
            try {
                const content = fs.readFileSync(filePath, 'utf8');
                preview = content.slice(0, PREVIEW_MAX_LENGTH);
            } catch { /* skip preview on read error */ }
        }
    }

    const normalizedSource = { ...source, room: normalizeRoom(source.room) };
    res.json({ source: normalizedSource, preview });
});

/**
 * POST /api/sources/:id/remember
 * Promotes an Ember Council or Threshold source to Hearth.
 */
router.post('/api/sources/:id/remember', writeLimiter, async (req, res) => {
    try {
        if (!isSafeManifestKey(req.params.id)) {
            return res.status(400).json({ error: 'Invalid source id' });
        }
        const manifests = loadManifests();
        const source    = manifests[req.params.id];
        if (!source) return res.status(404).json({ error: 'Source not found' });

        if (source.room === 'hearth') {
            return res.json({ success: true, source, alreadyRemembered: true });
        }

        const oldAbsPath = resolveSourcePath(source.path);
        const hearthDir  = path.join(DATA_ROOT, 'hearth');
        if (!fs.existsSync(hearthDir)) fs.mkdirSync(hearthDir, { recursive: true });

        const baseName    = path.basename(source.file || source.path);
        const destFile    = path.join(hearthDir, baseName);
        const destRelPath = 'hearth/' + baseName;

        if (oldAbsPath && fs.existsSync(oldAbsPath)) {
            fs.copyFileSync(oldAbsPath, destFile);
        }

        source.room         = 'hearth';
        source.status       = 'remembered';
        source.path         = destRelPath;
        source.rememberedAt = new Date().toISOString();
        upsertManifest(source.id, source);

        try {
            const { text } = await extractTextAsync(destFile);
            if (text) {
                const chunks = chunkText({ text, sourceRecord: source });
                removeStaleEmbeddingsForSource(source.id);
                upsertChunks(chunks);
                const embeddingMap = {};
                for (const chunk of chunks) {
                    const vector = await generateEmbedding(chunk.text);
                    if (vector) embeddingMap[chunk.id] = vector;
                }
                if (Object.keys(embeddingMap).length > 0) upsertEmbeddings(embeddingMap);
            }
        } catch { /* indexing is best-effort */ }

        console.log('[remember] ' + req.params.id + ' promoted to Hearth');
        res.json({ success: true, source });
    } catch (error) {
        console.error('Error remembering source:', error.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// ── Council drafts ─────────────────────────────────────────────────────────────

/**
 * POST /api/council/drafts
 * Body: { content, title? }
 */
router.post('/api/council/drafts', writeLimiter, (req, res) => {
    try {
        const { content, title } = req.body;
        if (!content || typeof content !== 'string') {
            return res.status(400).json({ error: 'content is required' });
        }

        const councilDraftsDir = path.join(DATA_ROOT, 'council', 'drafts');
        if (!fs.existsSync(councilDraftsDir)) {
            fs.mkdirSync(councilDraftsDir, { recursive: true });
        }

        const safeTitle = (title || 'council-draft')
            .replace(/[^a-zA-Z0-9-_]/g, '-')
            .toLowerCase()
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
        const filename  = safeTitle + '.md';
        const filePath  = path.join(councilDraftsDir, filename);
        const noteText  = '# ' + (title || 'Council Draft') + '\n\n' + content + '\n';

        fs.writeFileSync(filePath, noteText, 'utf8');
        // Council drafts are treated as workspace artifacts and are not indexed as sources.

        res.json({ success: true, filename, path: 'council/drafts/' + filename });
    } catch (error) {
        console.error('Error saving council draft:', error.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

/**
 * GET /api/council/drafts
 */
router.get('/api/council/drafts', readLimiter, (req, res) => {
    const councilDraftsDir = path.join(DATA_ROOT, 'council', 'drafts');
    if (!fs.existsSync(councilDraftsDir)) return res.json({ drafts: [] });

    const drafts = fs.readdirSync(councilDraftsDir)
        .filter(f => f.endsWith('.md') || f.endsWith('.txt'))
        .map(f => {
            const stats = fs.statSync(path.join(councilDraftsDir, f));
            return {
                filename: f,
                path:     'council/drafts/' + f,
                size:     stats.size,
                created:  (stats.birthtime || stats.mtime).toISOString(),
            };
        })
        .sort(function(a, b) { return b.created.localeCompare(a.created); });

    res.json({ drafts });
});

// ── Phase 8: Source triage actions ───────────────────────────────────────────

/**
 * POST /api/sources/:id/flag
 * Body: { flagged: boolean }
 */
router.post('/api/sources/:id/flag', writeLimiter, (req, res) => {
    const { id }             = req.params;
    if (!isSafeManifestKey(id)) {
        return res.status(400).json({ error: 'Invalid source id' });
    }
    const { flagged = true } = req.body || {};

    const manifests = loadManifests();
    const source    = manifests[id];
    if (!source) return res.status(404).json({ error: 'Source not found' });

    const currentStatus = source.status || 'waiting';
    if (flagged) {
        source.status = 'flagged';
    } else {
        source.status = currentStatus === 'flagged' ? 'waiting' : currentStatus;
    }
    upsertManifest(id, source);
    res.json({ success: true, source });
});

// ── Phase 8.5: Source intake actions ─────────────────────────────────────────

/**
 * POST /api/sources/:id/inspect
 * Marks a source as inspected in the persistent intake state.
 */
router.post('/api/sources/:id/inspect', writeLimiter, (req, res) => {
    const { id }    = req.params;
    if (!isSafeManifestKey(id)) {
        return res.status(400).json({ error: 'Invalid source id' });
    }
    const manifests = loadManifests();
    const source    = manifests[id];
    if (!source) return res.status(404).json({ error: 'Source not found' });

    const filePath = source.path;
    if (!filePath) return res.status(400).json({ error: 'Source has no stored path' });

    const entry = upsertIntakeFile(filePath, { state: 'inspected' });
    res.json({ success: true, intake: entry });
});

/**
 * POST /api/sources/:id/reject
 * Persistently rejects a source.
 * Body: { notes? }
 */
router.post('/api/sources/:id/reject', writeLimiter, (req, res) => {
    const { id }           = req.params;
    if (!isSafeManifestKey(id)) {
        return res.status(400).json({ error: 'Invalid source id' });
    }
    const { notes = null } = req.body || {};
    const manifests        = loadManifests();
    const source           = manifests[id];
    if (!source) return res.status(404).json({ error: 'Source not found' });

    const filePath = source.path;
    if (!filePath) return res.status(400).json({ error: 'Source has no stored path' });

    const absPath = resolveSourcePath(filePath);
    let lastKnownMtime = null;
    if (absPath && fs.existsSync(absPath)) {
        try { lastKnownMtime = fs.statSync(absPath).mtime.toISOString(); }
        catch { /* ignore */ }
    }

    const entry = upsertIntakeFile(filePath, {
        state:          'rejected',
        lastKnownMtime,
        notes:          notes || undefined,
    });

    source.status = 'rejected';
    upsertManifest(id, source);

    res.json({ success: true, intake: entry });
});

module.exports = router;
