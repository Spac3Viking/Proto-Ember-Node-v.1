'use strict';

/**
 * Ember Node v.ᚠ — Threshold Routes
 *
 * GET  /api/threshold/list
 * GET  /api/detected-files
 * POST /api/detected-files/import
 * POST /api/detected-files/acknowledge
 * POST /api/threshold/admit
 */

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const { readLimiter, writeLimiter, indexLimiter } = require('../rateLimiters');
const { DATA_ROOT, resolveSourcePath } = require('../storageConfig');
const { buildSourceRecord, extractTextAsync }      = require('../ingest');
const {
    upsertManifest, loadManifests,
    upsertChunks, upsertEmbeddings, loadChunks,
    removeEmbeddingsByChunkIds,
}                                                  = require('../indexStore');
const { loadIntakeState, upsertIntakeFile }        = require('../intakeState');
const { chunkText }                                = require('../chunker');
const { generateEmbedding }                        = require('../embeddings');
const {
    DETECT_SUPPORTED_EXTS,
    DETECT_IGNORE_FILES,
} = require('../startupCheck');

const router = express.Router();
const THRESHOLD_INBOX_DIR = path.join(DATA_ROOT, 'threshold', 'inbox');
const THRESHOLD_IMPORT_EXTS = new Set(['.md', '.txt', '.json', '.pdf']);

function isPathInside(baseDir, targetPath) {
    const normalize = (value) => {
        const resolved = path.resolve(value);
        return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    };
    const root = normalize(baseDir);
    const target = normalize(targetPath);
    return target === root || target.startsWith(root + path.sep);
}

function ensureThresholdInboxDir() {
    if (!fs.existsSync(THRESHOLD_INBOX_DIR)) {
        fs.mkdirSync(THRESHOLD_INBOX_DIR, { recursive: true });
    }
}

function normalizeImportType(ext) {
    if (ext === '.md') return 'markdown';
    if (ext === '.txt') return 'text';
    if (ext === '.json') return 'json';
    if (ext === '.pdf') return 'pdf';
    return 'unknown';
}

function sanitizeFilename(filename) {
    const base = path.basename(String(filename || '').replace(/\\/g, '/'));
    return base.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^_+/, '') || 'imported-file';
}

function uniqueInboxName(filename) {
    const safe = sanitizeFilename(filename);
    const ext = path.extname(safe).toLowerCase();
    const stem = path.basename(safe, ext);
    let candidate = safe;
    let i = 1;
    while (fs.existsSync(path.join(THRESHOLD_INBOX_DIR, candidate))) {
        if (i === 1) {
            candidate = stem + '-' + Date.now() + ext;
        } else {
            candidate = stem + '-' + Date.now() + '-' + i + ext;
        }
        i++;
    }
    return candidate;
}

function listThresholdInboxFiles() {
    ensureThresholdInboxDir();
    const entries = fs.readdirSync(THRESHOLD_INBOX_DIR, { withFileTypes: true });
    return entries
        .filter(entry => entry.isFile())
        .map(entry => {
            const ext = path.extname(entry.name).toLowerCase();
            if (!THRESHOLD_IMPORT_EXTS.has(ext)) return null;
            const absPath = path.join(THRESHOLD_INBOX_DIR, entry.name);
            let stats = null;
            try { stats = fs.statSync(absPath); } catch { return null; }
            const importedAt = (stats.birthtime || stats.mtime || new Date()).toISOString();
            return {
                name: entry.name,
                path: 'threshold/inbox/' + entry.name,
                type: normalizeImportType(ext),
                size: stats.size,
                imported_at: importedAt,
                status: ext === '.pdf' ? 'pdf_stored' : 'ready',
            };
        })
        .filter(Boolean)
        .sort((a, b) => b.imported_at.localeCompare(a.imported_at));
}

function resolveThresholdInboxPath(relPath) {
    const normalized = String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!normalized.startsWith('threshold/inbox/')) return null;
    const tail = normalized.slice('threshold/inbox/'.length);
    if (!tail || tail.includes('..')) return null;
    const absPath = path.resolve(THRESHOLD_INBOX_DIR, tail);
    if (!isPathInside(THRESHOLD_INBOX_DIR, absPath)) return null;
    return absPath;
}

function parseMultipartUploads(req) {
    return new Promise((resolve, reject) => {
        const contentType = req.headers['content-type'] || '';
        const boundaryMatch = contentType.match(/boundary=([^;]+)/i);
        if (!boundaryMatch) {
            reject(new Error('Expected multipart form-data upload.'));
            return;
        }

        const boundary = boundaryMatch[1].trim().replace(/^"|"$/g, '');
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('error', reject);
        req.on('end', () => {
            try {
                const body = Buffer.concat(chunks);
                const delimiter = Buffer.from('--' + boundary);
                const parts = [];
                let start = body.indexOf(delimiter);
                while (start !== -1) {
                    const next = body.indexOf(delimiter, start + delimiter.length);
                    if (next === -1) break;
                    const part = body.slice(start + delimiter.length, next);
                    start = next;
                    if (part.length === 0) continue;
                    const trimmed = part.slice(part.indexOf('\r\n') === 0 ? 2 : 0);
                    const headerEnd = trimmed.indexOf(Buffer.from('\r\n\r\n'));
                    if (headerEnd === -1) continue;
                    const headerText = trimmed.slice(0, headerEnd).toString('utf8');
                    const filenameMatch = headerText.match(/filename="([^"]*)"/i);
                    if (!filenameMatch) continue;
                    const filename = filenameMatch[1];
                    if (!filename) continue;
                    let content = trimmed.slice(headerEnd + 4);
                    if (content.slice(-2).toString() === '\r\n') {
                        content = content.slice(0, -2);
                    }
                    parts.push({ filename, buffer: content });
                }
                resolve(parts);
            } catch (err) {
                reject(err);
            }
        });
    });
}

// ── Internal helpers ──────────────────────────────────────────────────────────

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
 * Auto-register any unmanaged files found in the threshold directory.
 * Creates manifest entries (without indexing) so files become actionable
 * in the Threshold intake queue immediately — no manual re-upload required.
 *
 * Safe to call repeatedly: uses upsertManifest which is idempotent.
 */
function autoRegisterThresholdFiles() {
    const thresholdDir = path.join(DATA_ROOT, 'threshold');
    if (!fs.existsSync(thresholdDir)) return;

    const manifests = loadManifests();
    const byPath    = {};
    Object.values(manifests).forEach(m => {
        if (m.path) byPath[m.path.replace(/\\/g, '/')] = m;
    });

    let entries;
    try { entries = fs.readdirSync(thresholdDir, { withFileTypes: true }); }
    catch { return; }

    for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (DETECT_IGNORE_FILES.has(entry.name)) continue;
        const ext = path.extname(entry.name).toLowerCase();
        if (!DETECT_SUPPORTED_EXTS.has(ext)) continue;

        const relPath = 'threshold/' + entry.name;
        if (byPath[relPath]) continue;   // already registered

        const absPath = path.join(thresholdDir, entry.name);
        try {
            const source = buildSourceRecord({
                filePath: absPath,
                room:     'threshold',
            });
            upsertManifest(source.id, source);
        } catch { /* skip files that cannot be read */ }
    }
}

// ── Phase 4: Threshold intake ─────────────────────────────────────────────────

/**
 * GET /api/threshold/list
 * Returns files in the Threshold intake queue, including metadata.
 * Augments each file record with its persistent intake state.
 *
 * Auto-registers any unmanaged files found in the threshold directory so
 * files placed directly in the folder appear immediately with sourceIds.
 */
router.get('/api/threshold/list', readLimiter, (req, res) => {
    // Auto-register unmanaged threshold files so they surface with sourceIds
    autoRegisterThresholdFiles();
    const thresholdDir = path.join(DATA_ROOT, 'threshold');
    if (!fs.existsSync(thresholdDir)) return res.json({ files: [] });

    const manifests   = loadManifests();
    const intakeState = loadIntakeState();

    const fromManifests = Object.values(manifests)
        .filter(m => m.room === 'threshold')
        .map(m => {
            let size = 0;
            const absPath = resolveSourcePath(m.path);
            if (fs.existsSync(absPath)) {
                try { size = fs.statSync(absPath).size; } catch { /* ignore */ }
            }
            const relPath = (m.path || '').replace(/\\/g, '/');
            const intake  = (intakeState.files && intakeState.files[relPath]) || null;
            return {
                filename:    m.file,
                path:        m.path,
                size,
                created:     m.ingestTimestamp,
                sourceId:    m.id,
                title:       m.title       || null,
                description: m.description || null,
                shelf:       m.shelf       || null,
                status:      m.status      || 'waiting',
                sourceType:  m.sourceType  || null,
                metaOnly:    m.metaOnly    || false,
                intake,
            };
        });

    const manifestFiles = new Set(fromManifests.map(f => f.filename));
    const extra = fs.readdirSync(thresholdDir)
        .filter(f => DETECT_SUPPORTED_EXTS.has(path.extname(f).toLowerCase()) && !manifestFiles.has(f))
        .map(f => {
            const stats   = fs.statSync(path.join(thresholdDir, f));
            const relPath = 'threshold/' + f;
            const intake  = (intakeState.files && intakeState.files[relPath]) || null;
            return {
                filename:    f,
                path:        relPath,
                size:        stats.size,
                created:     (stats.birthtime || stats.mtime).toISOString(),
                sourceId:    null,
                title:       null,
                description: null,
                shelf:       null,
                status:      'waiting',
                sourceType:  path.extname(f).toLowerCase().slice(1),
                metaOnly:    false,
                intake,
            };
        });

    const files = [...fromManifests, ...extra]
        .sort(function(a, b) { return b.created.localeCompare(a.created); });

    res.json({ files });
});

/**
 * POST /api/threshold/import
 * Accept one or more uploaded files and store them in threshold/inbox/.
 */
router.post('/api/threshold/import', writeLimiter, async (req, res) => {
    try {
        const contentType = req.headers['content-type'] || '';
        if (!/multipart\/form-data/i.test(contentType)) {
            return res.status(400).json({ error: 'Expected multipart form-data upload.' });
        }

        const uploads = await parseMultipartUploads(req);
        if (!Array.isArray(uploads) || uploads.length === 0) {
            return res.status(400).json({ error: 'No files uploaded.' });
        }

        ensureThresholdInboxDir();
        const imported = [];
        for (const upload of uploads) {
            const ext = path.extname(upload.filename || '').toLowerCase();
            if (!THRESHOLD_IMPORT_EXTS.has(ext)) {
                return res.status(400).json({
                    error: 'Unsupported file type "' + ext + '". Allowed: ' + [...THRESHOLD_IMPORT_EXTS].join(', '),
                });
            }
            const finalName = uniqueInboxName(upload.filename);
            const absPath = path.resolve(THRESHOLD_INBOX_DIR, finalName);
            if (!isPathInside(THRESHOLD_INBOX_DIR, absPath)) {
                return res.status(400).json({ error: 'Invalid upload target path.' });
            }
            fs.writeFileSync(absPath, upload.buffer);
            const stats = fs.statSync(absPath);
            imported.push({
                name: finalName,
                path: 'threshold/inbox/' + finalName,
                type: normalizeImportType(ext),
                size: stats.size,
                imported_at: (stats.birthtime || stats.mtime || new Date()).toISOString(),
            });
        }

        res.json({ imported });
    } catch (error) {
        console.error('Error importing threshold files:', error.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

/**
 * GET /api/threshold/files
 * List imported files in threshold/inbox/.
 */
router.get('/api/threshold/files', readLimiter, (req, res) => {
    try {
        res.json({ files: listThresholdInboxFiles() });
    } catch (error) {
        console.error('Error listing threshold files:', error.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

/**
 * GET /api/threshold/files/content?path=threshold/inbox/<name>
 * Return reader-safe text content for markdown/text/json files.
 */
router.get('/api/threshold/files/content', readLimiter, (req, res) => {
    try {
        const relPath = String(req.query.path || '');
        const absPath = resolveThresholdInboxPath(relPath);
        if (!absPath) {
            return res.status(400).json({ error: 'Invalid threshold file path.' });
        }
        if (!fs.existsSync(absPath)) {
            return res.status(404).json({ error: 'File not found.' });
        }

        const ext = path.extname(absPath).toLowerCase();
        if (ext === '.pdf') {
            return res.status(400).json({ error: 'PDF stored — reader support later.' });
        }
        if (!['.md', '.txt', '.json'].includes(ext)) {
            return res.status(400).json({ error: 'Unsupported reader type.' });
        }

        const content = fs.readFileSync(absPath, 'utf8');
        const contentType = ext === '.md'
            ? 'text/markdown'
            : ext === '.json'
                ? 'application/json'
                : 'text/plain';
        res.json({
            success: true,
            name: path.basename(absPath),
            path: relPath.replace(/\\/g, '/'),
            title: path.basename(absPath, ext),
            contentType,
            content,
            sourceLabel: 'Threshold',
            sourceType: normalizeImportType(ext),
        });
    } catch (error) {
        console.error('Error reading threshold file:', error.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

/**
 * DELETE /api/threshold/files
 * Body: { path: "threshold/inbox/<name>" }
 */
router.delete('/api/threshold/files', writeLimiter, (req, res) => {
    try {
        const relPath = (req.body && req.body.path) || '';
        const absPath = resolveThresholdInboxPath(relPath);
        if (!absPath) {
            return res.status(400).json({ error: 'Invalid threshold file path.' });
        }
        if (!fs.existsSync(absPath)) {
            return res.status(404).json({ error: 'File not found.' });
        }
        fs.unlinkSync(absPath);
        res.json({ success: true, deleted: relPath.replace(/\\/g, '/') });
    } catch (error) {
        console.error('Error deleting threshold file:', error.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// ── Phase 6: Local file detection ────────────────────────────────────────────

/**
 * GET /api/detected-files
 * Scans threshold/, workshop/, and hearth/ for:
 *   - Unmanaged files: exist on disk but are not in the manifest index
 *   - Changed files:   in the manifest but mtime is newer than ingestTimestamp
 *
 * Never auto-imports, indexes, or mutates anything.
 */
router.get('/api/detected-files', readLimiter, (req, res) => {
    const manifests   = loadManifests();
    const intakeState = loadIntakeState();

    const byPath = {};
    Object.values(manifests).forEach(m => {
        if (m.path) byPath[m.path.replace(/\\/g, '/')] = m;
    });

    const unmanaged = [];
    const changed   = [];

    const rooms = ['threshold', 'workshop', 'hearth'];
    for (const room of rooms) {
        const roomDir = path.join(DATA_ROOT, room);
        if (!fs.existsSync(roomDir)) continue;

        let entries;
        try { entries = fs.readdirSync(roomDir, { withFileTypes: true }); }
        catch { continue; }

        for (const entry of entries) {
            if (!entry.isFile()) continue;
            if (DETECT_IGNORE_FILES.has(entry.name)) continue;
            const ext = path.extname(entry.name).toLowerCase();
            if (!DETECT_SUPPORTED_EXTS.has(ext)) continue;

            const relPath = room + '/' + entry.name;
            const absPath = path.join(roomDir, entry.name);

            let stats;
            try { stats = fs.statSync(absPath); }
            catch { continue; }

            const manifest   = byPath[relPath];
            const fileIntake = intakeState.files && intakeState.files[relPath];
            const mtimeMs    = stats.mtime.getTime();

            if (!manifest) {
                if (fileIntake && fileIntake.state === 'rejected') {
                    const rejectedAt = new Date(fileIntake.lastReviewed).getTime();
                    if (mtimeMs <= rejectedAt + 2000) continue;
                }

                unmanaged.push({
                    filename:   entry.name,
                    path:       relPath,
                    room,
                    size:       stats.size,
                    mtime:      stats.mtime.toISOString(),
                    sourceType: ext.slice(1),
                });
            } else {
                if (!manifest.ingestTimestamp) continue;

                const ingestMs = new Date(manifest.ingestTimestamp).getTime();

                if (mtimeMs > ingestMs + 2000) {
                    if (fileIntake && fileIntake.state === 'rejected') {
                        const lastKnown = fileIntake.lastKnownMtime
                            ? new Date(fileIntake.lastKnownMtime).getTime()
                            : 0;
                        if (mtimeMs <= lastKnown + 2000) continue;
                    }

                    changed.push({
                        filename:        entry.name,
                        path:            relPath,
                        room,
                        sourceId:        manifest.id,
                        title:           manifest.title       || null,
                        description:     manifest.description || null,
                        shelf:           manifest.shelf       || null,
                        size:            stats.size,
                        mtime:           stats.mtime.toISOString(),
                        ingestTimestamp: manifest.ingestTimestamp,
                        sourceType:      ext.slice(1),
                    });
                }
            }
        }
    }

    res.json({ unmanaged, changed });
});

/**
 * POST /api/detected-files/import
 * Body: { filename, room, title?, description?, shelf? }
 */
router.post('/api/detected-files/import', writeLimiter, (req, res) => {
    try {
        const { filename, room, title = null, description = null, shelf = null } = req.body;

        if (!filename || typeof filename !== 'string') {
            return res.status(400).json({ error: 'filename is required' });
        }
        const validRooms = ['hearth', 'workshop', 'threshold'];
        if (!validRooms.includes(room)) {
            return res.status(400).json({ error: 'Invalid room "' + room + '"' });
        }

        const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
        const filePath = path.join(DATA_ROOT, room, safeName);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'File not found on disk: ' + safeName });
        }

        const source = buildSourceRecord({ filePath, room, title, description, shelf });
        upsertManifest(source.id, source);

        res.json({ success: true, source });
    } catch (error) {
        console.error('Error importing detected file:', error.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

/**
 * POST /api/detected-files/acknowledge
 * Body: { sourceId }
 *
 * Marks a changed file as "reviewed" by updating its ingestTimestamp to now.
 */
router.post('/api/detected-files/acknowledge', writeLimiter, (req, res) => {
    try {
        const { sourceId } = req.body;
        if (!sourceId || typeof sourceId !== 'string') {
            return res.status(400).json({ error: 'sourceId is required' });
        }

        const manifests = loadManifests();
        const source    = manifests[sourceId];
        if (!source) {
            return res.status(404).json({ error: 'Source not found in manifest' });
        }

        const now = new Date().toISOString();
        source.ingestTimestamp = now;
        upsertManifest(sourceId, source);

        if (source.path) {
            const absPath = resolveSourcePath(source.path);
            let mtime = now;
            if (absPath && fs.existsSync(absPath)) {
                try { mtime = fs.statSync(absPath).mtime.toISOString(); }
                catch { /* fall back to now */ }
            }
            upsertIntakeFile(source.path, {
                state:          'inspected',
                lastKnownMtime: mtime,
            });
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Error acknowledging file change:', error.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// ── Phase 10.5: One-step admit ────────────────────────────────────────────────

/**
 * POST /api/threshold/admit
 * Body: { sourceId }
 *
 * Admits a Threshold file to Workshop in a single action:
 *   1. Marks as inspected in intake state
 *   2. Indexes the file (chunks + embeddings)
 *   3. Moves to Workshop room
 *
 * This is the primary "Admit to Workshop" action — reduces the previous
 * multi-step flow (inspect → index → move) to one click.
 */
router.post('/api/threshold/admit', indexLimiter, async (req, res) => {
    try {
        const { sourceId } = req.body;
        if (!sourceId || typeof sourceId !== 'string') {
            return res.status(400).json({ error: 'sourceId is required' });
        }

        const manifests = loadManifests();
        const source    = manifests[sourceId];
        if (!source) {
            return res.status(404).json({ error: 'Source not found in manifest' });
        }

        if (source.room !== 'threshold') {
            return res.status(400).json({ error: 'Source is not in Threshold' });
        }

        // Step 1: mark inspected
        if (source.path) {
            upsertIntakeFile(source.path, { state: 'inspected' });
        }

        // Step 2: move file to Workshop
        const oldAbsPath = resolveSourcePath(source.path);
        const workshopDir = path.join(DATA_ROOT, 'workshop');
        if (!fs.existsSync(workshopDir)) {
            fs.mkdirSync(workshopDir, { recursive: true });
        }
        const baseName    = path.basename(source.file || source.path);
        const newAbsPath  = path.join(workshopDir, baseName);
        const newRelPath  = 'workshop/' + baseName;

        if (oldAbsPath && fs.existsSync(oldAbsPath)) {
            try {
                fs.renameSync(oldAbsPath, newAbsPath);
            } catch {
                try {
                    fs.copyFileSync(oldAbsPath, newAbsPath);
                    fs.unlinkSync(oldAbsPath);
                } catch (copyErr) {
                    return res.status(500).json({ error: 'Failed to move file: ' + copyErr.message });
                }
            }
        } else if (!fs.existsSync(newAbsPath)) {
            return res.status(404).json({ error: 'File not found on disk' });
        }

        source.room   = 'workshop';
        source.path   = newRelPath;
        source.status = 'admitted';   // intermediate: moved but not yet indexed
        upsertManifest(sourceId, source);

        // Step 3: index (extract text, chunk, embed)
        const targetPath = resolveSourcePath(newRelPath);
        if (!targetPath || !fs.existsSync(targetPath)) {
            return res.status(404).json({ error: 'File not found after move' });
        }

        const { text, error: extractError } = await extractTextAsync(targetPath);
        if (!text) {
            const reason = extractError || 'Could not extract text from file';
            console.warn('[admit] Indexing skipped for ' + sourceId + ': ' + reason);
            source.status = 'waiting';   // admitted but not indexed
            upsertManifest(sourceId, source);
            return res.json({
                success:      true,
                sourceId,
                room:         'workshop',
                indexed:      false,
                indexWarning: reason,
            });
        }

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

        // Update status to indexed only after successful indexing
        source.status = 'indexed';
        upsertManifest(sourceId, source);

        console.log('[admit] ' + sourceId + ' admitted to Workshop (' + chunks.length + ' chunks)');
        res.json({
            success:             true,
            sourceId,
            room:                'workshop',
            indexed:             true,
            chunksCreated:       chunks.length,
            embeddingsGenerated,
        });
    } catch (error) {
        console.error('Error admitting file:', error.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

module.exports = router;
module.exports.autoRegisterThresholdFiles = autoRegisterThresholdFiles;
