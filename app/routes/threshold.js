'use strict';

/**
 * Ember Node v.ᚠ — Threshold Routes
 *
 * GET  /api/threshold/list
 * GET  /api/detected-files
 * POST /api/detected-files/import
 * POST /api/detected-files/acknowledge
 */

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const { readLimiter, writeLimiter }    = require('../rateLimiters');
const { DATA_ROOT, resolveSourcePath } = require('../storageConfig');
const { buildSourceRecord }            = require('../ingest');
const { upsertManifest, loadManifests } = require('../indexStore');
const { loadIntakeState, upsertIntakeFile } = require('../intakeState');
const {
    DETECT_SUPPORTED_EXTS,
    DETECT_IGNORE_FILES,
} = require('../startupCheck');

const router = express.Router();

// ── Phase 4: Threshold intake ─────────────────────────────────────────────────

/**
 * GET /api/threshold/list
 * Returns files in the Threshold intake queue, including metadata.
 * Augments each file record with its persistent intake state.
 */
router.get('/api/threshold/list', readLimiter, (req, res) => {
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

module.exports = router;
