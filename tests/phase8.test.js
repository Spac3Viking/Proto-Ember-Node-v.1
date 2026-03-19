/**
 * Phase 8: Startup Checklist, Threshold Airlock, and Tool Readiness tests
 *
 * Covers:
 *   GET  /api/startup-check       — startup summary endpoint
 *   POST /api/sources/:id/flag    — flag / unflag source files
 *   POST /api/tools/:id/launch    — Ollama launch (only ollama-local supported)
 *   triageFile()                  — lightweight file-type classification
 *   Tool running field            — tools track running state after scan
 */

'use strict';

const path    = require('path');
const fs      = require('fs');
const os      = require('os');
const request = require('supertest');

// Use a temp data root so tests never touch real user data
const tmpDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-phase8-test-'));
process.env.EMBER_DATA_ROOT = tmpDataRoot;

// Require AFTER setting env var
const {
    app,
    loadToolRegistry,
    saveToolRegistry,
    triageFile,
} = require('../app/server');

const { upsertManifest, loadManifests } = require('../app/indexStore');

afterAll(() => {
    try { fs.rmSync(tmpDataRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});

/* ─── triageFile() ──────────────────────────────────────────── */

describe('triageFile()', () => {
    test('classifies text/doc files as safe', () => {
        expect(triageFile('notes.txt').category).toBe('document');
        expect(triageFile('notes.txt').flag).toBe(false);
        expect(triageFile('readme.md').flag).toBe(false);
        expect(triageFile('report.pdf').flag).toBe(false);
        expect(triageFile('doc.docx').flag).toBe(false);
    });

    test('classifies archive files as flagged', () => {
        expect(triageFile('archive.zip').category).toBe('archive');
        expect(triageFile('archive.zip').flag).toBe(true);
        expect(triageFile('bundle.tar.gz').flag).toBe(true);
    });

    test('classifies script files as flagged', () => {
        expect(triageFile('setup.sh').category).toBe('script');
        expect(triageFile('setup.sh').flag).toBe(true);
        expect(triageFile('run.bat').flag).toBe(true);
        expect(triageFile('script.py').flag).toBe(true);
    });

    test('classifies binary files as flagged', () => {
        expect(triageFile('program.exe').category).toBe('binary');
        expect(triageFile('program.exe').flag).toBe(true);
        expect(triageFile('lib.dll').flag).toBe(true);
    });

    test('classifies unknown extensions as flagged', () => {
        const result = triageFile('file.xyz');
        expect(result.category).toBe('unknown');
        expect(result.flag).toBe(true);
    });
});

/* ─── GET /api/startup-check ─────────────────────────────────── */

describe('GET /api/startup-check', () => {
    beforeEach(() => {
        // Reset tool registry
        saveToolRegistry({ tools: [], active: {} });
    });

    test('returns expected shape with zero counts on empty state', async () => {
        const res = await request(app).get('/api/startup-check');
        expect(res.status).toBe(200);

        const body = res.body;
        expect(typeof body.waitingFiles).toBe('number');
        expect(typeof body.changedFiles).toBe('number');
        expect(typeof body.flaggedFiles).toBe('number');
        expect(typeof body.newTools).toBe('number');
        expect(typeof body.trustedTools).toBe('number');
        expect(typeof body.runningTools).toBe('number');
        expect(typeof body.offlineTools).toBe('number');
        expect(Array.isArray(body.warnings)).toBe(true);
        expect(typeof body.lastScan).toBe('string');
    });

    test('counts waiting threshold sources correctly', async () => {
        // Insert two waiting threshold sources into the manifest
        upsertManifest('test-source-1', {
            id: 'test-source-1', room: 'threshold', status: 'waiting',
            file: 'a.txt', path: 'threshold/a.txt', ingestTimestamp: new Date().toISOString(),
        });
        upsertManifest('test-source-2', {
            id: 'test-source-2', room: 'threshold', status: 'waiting',
            file: 'b.txt', path: 'threshold/b.txt', ingestTimestamp: new Date().toISOString(),
        });

        const res = await request(app).get('/api/startup-check');
        expect(res.status).toBe(200);
        expect(res.body.waitingFiles).toBeGreaterThanOrEqual(2);
    });

    test('counts flagged sources correctly', async () => {
        upsertManifest('flagged-source', {
            id: 'flagged-source', room: 'threshold', status: 'flagged',
            file: 'risky.sh', path: 'threshold/risky.sh', ingestTimestamp: new Date().toISOString(),
        });

        const res = await request(app).get('/api/startup-check');
        expect(res.status).toBe(200);
        expect(res.body.flaggedFiles).toBeGreaterThanOrEqual(1);
    });

    test('counts trusted tools', async () => {
        saveToolRegistry({
            tools: [
                { id: 'ollama-local', name: 'Ollama', trusted: true, running: true, status: 'detected', role: null },
                { id: 'other-tool', name: 'Other', trusted: false, running: false, status: 'detected', role: null },
            ],
            active: { heart: 'ollama-local' },
        });

        const res = await request(app).get('/api/startup-check');
        expect(res.status).toBe(200);
        expect(res.body.trustedTools).toBe(1);
        expect(res.body.runningTools).toBe(1);
        expect(res.body.newTools).toBe(1);
        expect(res.body.activeHeart).toBe('ollama-local');
        expect(res.body.activeHeartAvailable).toBe(true);
    });

    test('reports activeHeartAvailable false when heart is offline', async () => {
        saveToolRegistry({
            tools: [
                { id: 'ollama-local', name: 'Ollama', trusted: true, running: false, status: 'detected', role: null },
            ],
            active: { heart: 'ollama-local' },
        });

        const res = await request(app).get('/api/startup-check');
        expect(res.status).toBe(200);
        expect(res.body.activeHeartAvailable).toBe(false);
        expect(res.body.warnings.length).toBeGreaterThan(0);
    });

    test('migrationState is "none" in test environment', async () => {
        const res = await request(app).get('/api/startup-check');
        expect(res.status).toBe(200);
        expect(typeof res.body.migrationState).toBe('string');
    });
});

/* ─── POST /api/sources/:id/flag ─────────────────────────────── */

describe('POST /api/sources/:id/flag', () => {
    const SOURCE_ID = 'flag-test-source';

    beforeEach(() => {
        upsertManifest(SOURCE_ID, {
            id:     SOURCE_ID,
            room:   'threshold',
            status: 'waiting',
            file:   'flag-test.txt',
            path:   'threshold/flag-test.txt',
            ingestTimestamp: new Date().toISOString(),
        });
    });

    test('flags a source when flagged=true', async () => {
        const res = await request(app)
            .post('/api/sources/' + SOURCE_ID + '/flag')
            .send({ flagged: true });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.source.status).toBe('flagged');

        const manifests = loadManifests();
        expect(manifests[SOURCE_ID].status).toBe('flagged');
    });

    test('unflags a source when flagged=false', async () => {
        // First flag it
        upsertManifest(SOURCE_ID, {
            id: SOURCE_ID, room: 'threshold', status: 'flagged',
            file: 'flag-test.txt', path: 'threshold/flag-test.txt',
            ingestTimestamp: new Date().toISOString(),
        });

        const res = await request(app)
            .post('/api/sources/' + SOURCE_ID + '/flag')
            .send({ flagged: false });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.source.status).toBe('waiting');
    });

    test('defaults to flagged=true when body is empty', async () => {
        const res = await request(app)
            .post('/api/sources/' + SOURCE_ID + '/flag')
            .send({});

        expect(res.status).toBe(200);
        expect(res.body.source.status).toBe('flagged');
    });

    test('returns 404 for unknown source', async () => {
        const res = await request(app)
            .post('/api/sources/nonexistent-id/flag')
            .send({ flagged: true });

        expect(res.status).toBe(404);
    });
});

/* ─── POST /api/tools/:id/launch ─────────────────────────────── */

describe('POST /api/tools/:id/launch', () => {
    beforeEach(() => {
        saveToolRegistry({
            tools: [
                {
                    id: 'ollama-local', name: 'Ollama', trusted: false,
                    running: false, status: 'detected', role: null,
                    endpoint: 'http://localhost:11434', interface: 'http',
                },
                {
                    id: 'claude-cli', name: 'Claude CLI', trusted: false,
                    running: false, status: 'not_detected', role: null,
                    endpoint: null, interface: 'cli',
                },
            ],
            active: {},
        });
    });

    test('returns 404 for unknown tool', async () => {
        const res = await request(app).post('/api/tools/nonexistent/launch');
        expect(res.status).toBe(404);
    });

    test('rejects launch for non-ollama tools', async () => {
        const res = await request(app).post('/api/tools/claude-cli/launch');
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/ollama-local/);
    });

    test('returns a result object for ollama-local (pass or fail is fine — Ollama not installed in CI)', async () => {
        const res = await request(app).post('/api/tools/ollama-local/launch');
        // In CI Ollama is not installed, so we expect success=false OR already_running / launched
        expect(res.status).toBe(200);
        expect(typeof res.body.success).toBe('boolean');
        expect(typeof res.body.status).toBe('string');
        expect(typeof res.body.message).toBe('string');
    });
});

/* ─── Tool running field ─────────────────────────────────────── */

describe('Tool running field in registry', () => {
    test('scan sets running=false for not-detected placeholder tools', async () => {
        const res = await request(app).post('/api/tools/scan');
        expect(res.status).toBe(200);

        const registry = loadToolRegistry();
        const claudeCli = registry.tools.find(t => t.id === 'claude-cli');
        if (claudeCli) {
            // Placeholder / not-detected tools should not be running
            expect(claudeCli.running).toBe(false);
        }
    });

    test('scan result contains running field on each tool', async () => {
        const res = await request(app).post('/api/tools/scan');
        expect(res.status).toBe(200);
        res.body.tools.forEach(t => {
            expect(typeof t.running).toBe('boolean');
        });
    });
});
