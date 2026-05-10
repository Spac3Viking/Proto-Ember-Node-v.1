'use strict';

/**
 * Ember Node v.ᚠ — Threshold Routes
 *
 * GET  /api/threshold/list
 * POST /api/threshold/import
 * GET  /api/threshold/files
 * GET  /api/threshold/files/content
 * DELETE /api/threshold/files
 */

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const { readLimiter, writeLimiter } = require('../rateLimiters');
const { DATA_ROOT, resolveSourcePath } = require('../storageConfig');
const { buildSourceRecord }      = require('../ingest');
const {
    upsertManifest, loadManifests,
}                                                  = require('../indexStore');
const { loadIntakeState, upsertIntakeRuntime } = require('../intakeState');
const {
    probeOllamaRuntime,
    launchOllamaRuntime,
} = require('../runtimeStewardship');
const {
    DETECT_SUPPORTED_EXTS,
    DETECT_IGNORE_FILES,
} = require('../startupCheck');

const router = express.Router();
const THRESHOLD_INBOX_DIR = path.join(DATA_ROOT, 'threshold', 'inbox');
const THRESHOLD_IMPORT_EXTS = new Set(['.md', '.txt', '.json', '.pdf']);
const GREEN_FIRE_HANDOFF_TYPES = new Set([
    'research-brief',
    'field-note',
    'bootstrap',
    'manual-summary',
    'cache-readme',
    'source-summary',
]);
const GREEN_FIRE_HANDOFF_STATUS = new Set(['unverified', 'reviewed', 'trusted', 'local']);

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

function extractMarkdownDisplayTitle(content, fallbackTitle) {
    const fallback = String(fallbackTitle || '').trim() || 'Untitled';
    const text = typeof content === 'string' ? content : '';
    const h1Match = text.match(/^\s*#\s+(.+?)\s*$/m);
    if (h1Match && h1Match[1]) {
        const title = h1Match[1].replace(/\s+/g, ' ').trim();
        if (title) return title;
    }
    const frontmatterMatch = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (frontmatterMatch && frontmatterMatch[1]) {
        const titleMatch = frontmatterMatch[1].match(/^\s*title\s*:\s*["']?(.+?)["']?\s*$/mi);
        if (titleMatch && titleMatch[1]) {
            const title = titleMatch[1].replace(/\s+/g, ' ').trim();
            if (title) return title;
        }
    }
    return fallback;
}

function extractFrontmatterBlock(content) {
    const text = typeof content === 'string' ? content : '';
    const match = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    return match && match[1] ? match[1] : '';
}

function cleanFrontmatterValue(value) {
    const trimmed = String(value || '').trim();
    return trimmed.replace(/^["']|["']$/g, '').trim();
}

function parseFrontmatterList(value) {
    const raw = cleanFrontmatterValue(value);
    if (!raw) return [];
    const normalized = raw.startsWith('[') && raw.endsWith(']')
        ? raw.slice(1, -1)
        : raw;
    return normalized
        .split(',')
        .map(item => cleanFrontmatterValue(item))
        .filter(Boolean);
}

function parseSimpleFrontmatter(content) {
    const block = extractFrontmatterBlock(content);
    if (!block) return {};
    return block.split(/\r?\n/).reduce((acc, line) => {
        const match = line.match(/^\s*([a-zA-Z0-9_-]+)\s*:\s*(.*?)\s*$/);
        if (!match) return acc;
        acc[match[1].toLowerCase()] = match[2];
        return acc;
    }, {});
}

function parseGreenFireHandoff(content) {
    const frontmatter = parseSimpleFrontmatter(content);
    const hasFrontmatter = Object.keys(frontmatter).length > 0;
    const type = cleanFrontmatterValue(frontmatter.type || '').toLowerCase();
    const status = cleanFrontmatterValue(frontmatter.status || '').toLowerCase();
    const archetypes = parseFrontmatterList(frontmatter.archetypes || '');
    const tags = parseFrontmatterList(frontmatter.tags || '');
    const source = cleanFrontmatterValue(frontmatter.source || '');
    const license = cleanFrontmatterValue(frontmatter.license || '');

    const detected = Boolean(
        hasFrontmatter &&
        GREEN_FIRE_HANDOFF_TYPES.has(type) &&
        GREEN_FIRE_HANDOFF_STATUS.has(status)
    );

    return {
        detected,
        type: type || null,
        status: status || null,
        archetypes,
        tags,
        source: source || null,
        license: license || null,
    };
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
    const timestamp = Date.now();
    let i = 1;
    while (fs.existsSync(path.join(THRESHOLD_INBOX_DIR, candidate))) {
        if (i === 1) {
            candidate = stem + '-' + timestamp + ext;
        } else {
            candidate = stem + '-' + timestamp + '-' + i + ext;
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
            let handoff = null;
            if (ext === '.md') {
                try {
                    const content = fs.readFileSync(absPath, 'utf8');
                    handoff = parseGreenFireHandoff(content);
                } catch {
                    handoff = {
                        detected: false,
                        type: null,
                        status: null,
                        archetypes: [],
                        tags: [],
                        source: null,
                        license: null,
                    };
                }
            }
            return {
                name: entry.name,
                path: 'threshold/inbox/' + entry.name,
                type: normalizeImportType(ext),
                extension: ext.replace(/^\./, ''),
                size: stats.size,
                imported_at: importedAt,
                sourceLabel: 'Threshold',
                status: ext === '.pdf' ? 'pdf_stored' : 'ready',
                handoff,
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

/**
 * Build the current runtime stewardship view for Threshold.
 * Returns a single Ollama runtime card plus the active Ember Prime assignment.
 *
 * @returns {Promise<{runtimes: object[], active: object}>}
 */
async function buildRuntimeStewardshipView() {
    const probe = await probeOllamaRuntime();
    const intakeState = loadIntakeState();
    const intake = (intakeState.runtimes && intakeState.runtimes['ollama-local']) || null;
    const trusted = intake && intake.state === 'trusted';
    const rejected = intake && intake.state === 'rejected';
    return {
        runtimes: [
            {
                id: 'ollama-local',
                name: 'Ollama',
                type: 'model_host',
                interface: 'http',
                endpoint: 'http://localhost:11434',
                status: probe.ok ? 'detected' : 'not_detected',
                running: probe.ok,
                trusted,
                rejected: Boolean(rejected),
                intake,
                role: trusted ? 'ember_prime' : null,
                lastSeen: probe.ok ? new Date().toISOString() : null,
            },
        ],
        active: trusted ? { heart: 'ollama-local' } : {},
    };
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
        const handoff = ext === '.md'
            ? parseGreenFireHandoff(content)
            : null;
        const contentType = ext === '.md'
            ? 'text/markdown'
            : ext === '.json'
                ? 'application/json'
                : 'text/plain';
        const fallbackTitle = path.basename(absPath, ext);
        res.json({
            success: true,
            name: path.basename(absPath),
            path: relPath.replace(/\\/g, '/'),
            title: ext === '.md'
                ? extractMarkdownDisplayTitle(content, fallbackTitle)
                : fallbackTitle,
            contentType,
            content,
            sourceLabel: 'Threshold',
            sourceType: normalizeImportType(ext),
            handoff,
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

// ── Runtime stewardship (Threshold) ────────────────────────────────────────────

router.get('/api/runtimes', readLimiter, async (req, res) => {
    try {
        const view = await buildRuntimeStewardshipView();
        res.json(view);
    } catch (err) {
        res.status(500).json({ error: 'Could not load runtimes: ' + err.message });
    }
});

router.post('/api/runtimes/scan', writeLimiter, async (req, res) => {
    try {
        const view = await buildRuntimeStewardshipView();
        res.json({ success: true, runtimes: view.runtimes, active: view.active });
    } catch (err) {
        res.status(500).json({ error: 'Runtime scan failed: ' + err.message });
    }
});

router.post('/api/runtimes/:id/inspect', writeLimiter, (req, res) => {
    if (req.params.id !== 'ollama-local') return res.status(404).json({ error: 'Runtime not found' });
    const entry = upsertIntakeRuntime('ollama-local', { state: 'inspected' });
    res.json({ success: true, intake: entry });
});

router.post('/api/runtimes/:id/admit', writeLimiter, (req, res) => {
    if (req.params.id !== 'ollama-local') return res.status(404).json({ error: 'Runtime not found' });
    const entry = upsertIntakeRuntime('ollama-local', { state: 'trusted' });
    res.json({ success: true, intake: entry });
});

router.post('/api/runtimes/:id/reject', writeLimiter, (req, res) => {
    if (req.params.id !== 'ollama-local') return res.status(404).json({ error: 'Runtime not found' });
    const entry = upsertIntakeRuntime('ollama-local', { state: 'rejected' });
    res.json({ success: true, intake: entry });
});

router.post('/api/runtimes/:id/launch', writeLimiter, async (req, res) => {
    if (req.params.id !== 'ollama-local') return res.status(404).json({ error: 'Runtime not found' });
    const launch = await launchOllamaRuntime();
    if (launch.success) {
        return res.json({ success: true, status: launch.status });
    }
    return res.status(500).json({
        success: false,
        status: launch.status,
        error: launch.error || 'Ollama did not respond in time.',
    });
});

router.get('/api/runtimes/active', readLimiter, (req, res) => {
    const intakeState = loadIntakeState();
    const trusted = intakeState.runtimes && intakeState.runtimes['ollama-local'] && intakeState.runtimes['ollama-local'].state === 'trusted';
    res.json({ active: trusted ? { heart: 'ollama-local' } : {} });
});
router.post('/api/runtimes/active', writeLimiter, (req, res) => {
    const heartId = req.body && req.body.heart;
    if (heartId === null) {
        upsertIntakeRuntime('ollama-local', { state: 'inspected' });
        return res.json({ success: true, active: {} });
    }
    if (heartId !== 'ollama-local') return res.status(404).json({ error: 'Runtime not found' });
    upsertIntakeRuntime('ollama-local', { state: 'trusted' });
    return res.json({ success: true, active: { heart: 'ollama-local' } });
});

module.exports = router;
module.exports.autoRegisterThresholdFiles = autoRegisterThresholdFiles;
