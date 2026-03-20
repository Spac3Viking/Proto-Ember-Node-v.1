'use strict';

/**
 * Ember Node v.ᚠ — Source Routes
 *
 * POST /api/ingest
 * POST /api/index/cartridge/:id
 * POST /api/index/file
 * GET  /api/sources
 * POST /api/sources/:id/exclude
 * GET  /api/sources/:id
 * POST /api/sources/:id/remember
 * POST /api/notes
 * GET  /api/notes
 * POST /api/sources/:id/flag
 * POST /api/sources/:id/inspect
 * POST /api/sources/:id/reject
 */

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const { readLimiter, writeLimiter, indexLimiter } = require('../rateLimiters');
const { DATA_ROOT, resolveSourcePath }            = require('../storageConfig');
const { BUNDLED_CARTRIDGES_DIR }                  = require('../cartridgeLoader');
const { ingestFile, ingestCartridge, extractTextAsync, buildSourceRecord } = require('../ingest');
const { chunkText }                                   = require('../chunker');
const { generateEmbedding }                           = require('../embeddings');
const {
    upsertChunks, upsertEmbeddings, upsertManifest,
    loadManifests, loadExcluded, setExcluded,
    loadChunks, removeEmbeddingsByChunkIds,
}                                                     = require('../indexStore');
const { upsertIntakeFile }                            = require('../intakeState');

const router = express.Router();

/** Maximum number of characters returned by the source preview endpoint. */
const PREVIEW_MAX_LENGTH = 600;

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
 * Body: { filename, content, room?, cartridgeId?, title?, description?, shelf?, encoding? }
 */
router.post('/api/ingest', writeLimiter, async (req, res) => {
    try {
        const {
            filename,
            content,
            room        = 'threshold',
            cartridgeId = null,
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

        const validRooms = ['hearth', 'workshop', 'threshold'];
        if (!validRooms.includes(room)) {
            return res.status(400).json({ error: 'Invalid room "' + room + '"' });
        }

        const roomDir = path.join(DATA_ROOT, room);
        if (!fs.existsSync(roomDir)) {
            fs.mkdirSync(roomDir, { recursive: true });
        }

        const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
        const filePath = path.join(roomDir, safeName);

        if (!ALLOWED_EXTENSIONS.includes(ext)) {
            const safeId = [room, cartridgeId, safeName.replace(/[^a-z0-9]/gi, '-').toLowerCase()]
                .filter(Boolean)
                .join('-')
                .replace(/-+/g, '-')
                .replace(/^-|-$/g, '');
            const metaRecord = {
                id:               safeId,
                room,
                file:             safeName,
                path:             room + '/' + safeName,
                cartridgeId:      cartridgeId || null,
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

        const source = buildSourceRecord({ filePath, room, cartridgeId, title, description, shelf });
        upsertManifest(source.id, source);

        res.json({ success: true, source });
    } catch (error) {
        console.error('Error ingesting file:', error.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// ── Phase 3: indexing ─────────────────────────────────────────────────────────

/**
 * POST /api/index/cartridge/:id
 * Body: { room? }
 */
router.post('/api/index/cartridge/:id', indexLimiter, async (req, res) => {
    try {
        const cartridgeId  = req.params.id;
        const cartridgeDir = path.join(BUNDLED_CARTRIDGES_DIR, cartridgeId);

        if (!fs.existsSync(cartridgeDir)) {
            return res.status(404).json({ error: 'Cartridge "' + cartridgeId + '" not found' });
        }

        const room = (req.body && req.body.room) || 'workshop';

        const ingested = ingestCartridge({ cartridgeDir, cartridgeId, room });

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
            cartridgeId,
            filesIngested:       ingested.length,
            chunksCreated:       totalChunks,
            embeddingsGenerated: totalEmbedded,
        });
    } catch (error) {
        console.error('Error indexing cartridge:', error.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

/**
 * POST /api/index/file
 * Body: { sourceId, targetRoom? }
 */
router.post('/api/index/file', indexLimiter, async (req, res) => {
    try {
        const { sourceId, targetRoom } = req.body;
        if (!sourceId) {
            return res.status(400).json({ error: 'sourceId is required' });
        }

        const manifests = loadManifests();
        const source    = manifests[sourceId];
        if (!source) {
            return res.status(404).json({ error: 'Source not found in manifest' });
        }

        if (targetRoom) {
            const validRooms = ['hearth', 'workshop', 'threshold'];
            if (!validRooms.includes(targetRoom)) {
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
                              : targetRoom === 'workshop'  ? 'indexed'
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
 * Query params: room?, cartridgeId?
 */
router.get('/api/sources', (req, res) => {
    const { room, cartridgeId } = req.query;
    let sources = Object.values(loadManifests());
    if (room)        sources = sources.filter(s => s.room === room);
    if (cartridgeId) sources = sources.filter(s => s.cartridgeId === cartridgeId);
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

    res.json({ source, preview });
});

/**
 * POST /api/sources/:id/remember
 * Promotes a Workshop or Threshold source to Hearth.
 */
router.post('/api/sources/:id/remember', writeLimiter, async (req, res) => {
    try {
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

// ── Phase 3: Workshop notes ───────────────────────────────────────────────────

/**
 * POST /api/notes
 * Body: { content, title? }
 */
router.post('/api/notes', writeLimiter, (req, res) => {
    try {
        const { content, title } = req.body;
        if (!content || typeof content !== 'string') {
            return res.status(400).json({ error: 'content is required' });
        }

        const workshopDir = path.join(DATA_ROOT, 'workshop');
        if (!fs.existsSync(workshopDir)) {
            fs.mkdirSync(workshopDir, { recursive: true });
        }

        const safeTitle = (title || 'workshop-note')
            .replace(/[^a-zA-Z0-9-_]/g, '-')
            .toLowerCase()
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
        const filename  = safeTitle + '.md';
        const filePath  = path.join(workshopDir, filename);
        const noteText  = '# ' + (title || 'Workshop Note') + '\n\n' + content + '\n';

        fs.writeFileSync(filePath, noteText, 'utf8');

        const result = ingestFile({ filePath, room: 'workshop' });
        if (result) {
            upsertManifest(result.source.id, result.source);
        }

        res.json({ success: true, filename, path: 'workshop/' + filename });
    } catch (error) {
        console.error('Error saving note:', error.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

/**
 * GET /api/notes
 */
router.get('/api/notes', readLimiter, (req, res) => {
    const workshopDir = path.join(DATA_ROOT, 'workshop');
    if (!fs.existsSync(workshopDir)) return res.json({ notes: [] });

    const notes = fs.readdirSync(workshopDir)
        .filter(f => f.endsWith('.md') || f.endsWith('.txt'))
        .map(f => {
            const stats = fs.statSync(path.join(workshopDir, f));
            return {
                filename: f,
                path:     'workshop/' + f,
                size:     stats.size,
                created:  (stats.birthtime || stats.mtime).toISOString(),
            };
        })
        .sort(function(a, b) { return b.created.localeCompare(a.created); });

    res.json({ notes });
});

// ── Phase 8: Source triage actions ───────────────────────────────────────────

/**
 * POST /api/sources/:id/flag
 * Body: { flagged: boolean }
 */
router.post('/api/sources/:id/flag', writeLimiter, (req, res) => {
    const { id }             = req.params;
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
