/**
 * Phase 8.5: Airlock Persistence + Decision Flow tests
 *
 * Covers:
 *   loadIntakeState / saveIntakeState   — persistent intake state model
 *   upsertIntakeFile / upsertIntakeTool — per-item state helpers
 *   GET  /api/intake-state             — retrieve full state
 *   POST /api/sources/:id/inspect      — mark file as inspected
 *   POST /api/sources/:id/reject       — persistent file rejection
 *   POST /api/tools/:id/inspect        — mark tool as inspected
 *   POST /api/tools/:id/reject         — persistent tool rejection
 *   GET  /api/detected-files           — rejected files filtered out
 *   POST /api/detected-files/acknowledge — persists lastKnownMtime
 *   GET  /api/threshold/list           — intake field included per file
 *   GET  /api/tools                    — intake field included per tool
 */

'use strict';

const path    = require('path');
const fs      = require('fs');
const os      = require('os');
const request = require('supertest');

// Use a temp data root so tests never touch real user data
const tmpDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-phase8-5-test-'));
process.env.EMBER_DATA_ROOT = tmpDataRoot;

// Require AFTER setting env var
const {
    app,
    loadIntakeState,
    saveIntakeState,
    upsertIntakeFile,
    upsertIntakeTool,
    loadToolRegistry,
    saveToolRegistry,
} = require('../app/server');

const { upsertManifest, loadManifests } = require('../app/indexStore');

afterAll(() => {
    try { fs.rmSync(tmpDataRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});

/* ─── loadIntakeState / saveIntakeState ─────────────────────── */

describe('loadIntakeState / saveIntakeState', () => {
    test('returns empty state when file does not exist', () => {
        const state = loadIntakeState();
        expect(state).toEqual({ files: {}, tools: {} });
    });

    test('persists and reloads state', () => {
        const before = loadIntakeState();
        before.files['threshold/test.txt'] = {
            path:  'threshold/test.txt',
            state: 'rejected',
            lastReviewed: new Date().toISOString(),
        };
        saveIntakeState(before);

        const after = loadIntakeState();
        expect(after.files['threshold/test.txt']).toBeDefined();
        expect(after.files['threshold/test.txt'].state).toBe('rejected');
    });

    test('handles corrupt file gracefully', () => {
        const intakePath = path.join(tmpDataRoot, 'system', 'intake.json');
        fs.writeFileSync(intakePath, '{not valid json', 'utf8');
        const state = loadIntakeState();
        expect(state).toEqual({ files: {}, tools: {} });
    });
});

/* ─── upsertIntakeFile ───────────────────────────────────────── */

describe('upsertIntakeFile', () => {
    beforeEach(() => {
        saveIntakeState({ files: {}, tools: {} });
    });

    test('creates a new file entry', () => {
        const entry = upsertIntakeFile('threshold/notes.txt', { state: 'inspected' });
        expect(entry.path).toBe('threshold/notes.txt');
        expect(entry.state).toBe('inspected');
        expect(typeof entry.lastReviewed).toBe('string');
    });

    test('merges updates into existing entry', () => {
        upsertIntakeFile('threshold/doc.md', { state: 'waiting' });
        const updated = upsertIntakeFile('threshold/doc.md', { state: 'rejected', notes: 'test' });
        expect(updated.state).toBe('rejected');
        expect(updated.notes).toBe('test');
        expect(updated.path).toBe('threshold/doc.md');
    });

    test('persists to disk', () => {
        upsertIntakeFile('threshold/persist.txt', { state: 'flagged' });
        const state = loadIntakeState();
        expect(state.files['threshold/persist.txt'].state).toBe('flagged');
    });

    test('normalises Windows-style paths', () => {
        const entry = upsertIntakeFile('threshold\\win.txt', { state: 'waiting' });
        expect(entry.path).toBe('threshold/win.txt');
        const state = loadIntakeState();
        expect(state.files['threshold/win.txt']).toBeDefined();
    });
});

/* ─── upsertIntakeTool ───────────────────────────────────────── */

describe('upsertIntakeTool', () => {
    beforeEach(() => {
        saveIntakeState({ files: {}, tools: {} });
    });

    test('creates a new tool entry', () => {
        const entry = upsertIntakeTool('ollama-local', { state: 'inspected' });
        expect(entry.id).toBe('ollama-local');
        expect(entry.state).toBe('inspected');
        expect(typeof entry.lastReviewed).toBe('string');
    });

    test('merges updates into existing tool entry', () => {
        upsertIntakeTool('ollama-local', { state: 'detected' });
        const updated = upsertIntakeTool('ollama-local', { state: 'rejected' });
        expect(updated.state).toBe('rejected');
    });

    test('persists to disk', () => {
        upsertIntakeTool('test-tool', { state: 'trusted' });
        const state = loadIntakeState();
        expect(state.tools['test-tool'].state).toBe('trusted');
    });
});

/* ─── GET /api/intake-state ──────────────────────────────────── */

describe('GET /api/intake-state', () => {
    beforeEach(() => {
        saveIntakeState({ files: {}, tools: {} });
    });

    test('returns 200 with files and tools keys', async () => {
        const res = await request(app).get('/api/intake-state');
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('files');
        expect(res.body).toHaveProperty('tools');
    });

    test('reflects stored state', async () => {
        upsertIntakeFile('threshold/api-test.txt', { state: 'rejected' });
        upsertIntakeTool('my-tool', { state: 'inspected' });

        const res = await request(app).get('/api/intake-state');
        expect(res.status).toBe(200);
        expect(res.body.files['threshold/api-test.txt'].state).toBe('rejected');
        expect(res.body.tools['my-tool'].state).toBe('inspected');
    });
});

/* ─── POST /api/sources/:id/inspect ─────────────────────────── */

describe('POST /api/sources/:id/inspect', () => {
    const SOURCE_ID = 'insp-test-source';

    beforeEach(() => {
        saveIntakeState({ files: {}, tools: {} });
        upsertManifest(SOURCE_ID, {
            id:     SOURCE_ID,
            room:   'threshold',
            status: 'waiting',
            file:   'insp-test.txt',
            path:   'threshold/insp-test.txt',
            ingestTimestamp: new Date().toISOString(),
        });
    });

    test('marks source as inspected in intake state', async () => {
        const res = await request(app).post('/api/sources/' + SOURCE_ID + '/inspect');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.intake.state).toBe('inspected');

        const state = loadIntakeState();
        expect(state.files['threshold/insp-test.txt'].state).toBe('inspected');
    });

    test('returns 404 for unknown source', async () => {
        const res = await request(app).post('/api/sources/no-such-id/inspect');
        expect(res.status).toBe(404);
    });

    test('sets lastReviewed timestamp', async () => {
        const res = await request(app).post('/api/sources/' + SOURCE_ID + '/inspect');
        expect(typeof res.body.intake.lastReviewed).toBe('string');
    });
});

/* ─── POST /api/sources/:id/reject ──────────────────────────── */

describe('POST /api/sources/:id/reject', () => {
    const SOURCE_ID = 'reject-test-source';

    beforeEach(() => {
        saveIntakeState({ files: {}, tools: {} });
        upsertManifest(SOURCE_ID, {
            id:     SOURCE_ID,
            room:   'threshold',
            status: 'waiting',
            file:   'reject-test.txt',
            path:   'threshold/reject-test.txt',
            ingestTimestamp: new Date().toISOString(),
        });
    });

    test('persistently rejects a source', async () => {
        const res = await request(app).post('/api/sources/' + SOURCE_ID + '/reject');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.intake.state).toBe('rejected');

        const state = loadIntakeState();
        expect(state.files['threshold/reject-test.txt'].state).toBe('rejected');
    });

    test('updates manifest status to rejected', async () => {
        await request(app).post('/api/sources/' + SOURCE_ID + '/reject');
        const manifests = loadManifests();
        expect(manifests[SOURCE_ID].status).toBe('rejected');
    });

    test('stores optional notes', async () => {
        const res = await request(app)
            .post('/api/sources/' + SOURCE_ID + '/reject')
            .send({ notes: 'not relevant' });
        expect(res.body.intake.notes).toBe('not relevant');
    });

    test('returns 404 for unknown source', async () => {
        const res = await request(app).post('/api/sources/no-such-id/reject');
        expect(res.status).toBe(404);
    });

    test('rejected state persists across reloads', async () => {
        await request(app).post('/api/sources/' + SOURCE_ID + '/reject');
        // Re-load and verify
        const state = loadIntakeState();
        expect(state.files['threshold/reject-test.txt'].state).toBe('rejected');
    });
});

/* ─── POST /api/tools/:id/inspect ───────────────────────────── */

describe('POST /api/tools/:id/inspect', () => {
    beforeEach(() => {
        saveIntakeState({ files: {}, tools: {} });
        saveToolRegistry({
            tools: [
                {
                    id: 'ollama-local', name: 'Ollama', trusted: false,
                    running: false, status: 'detected', role: null,
                    endpoint: 'http://localhost:11434', interface: 'http',
                },
            ],
            active: {},
        });
    });

    test('marks tool as inspected in intake state', async () => {
        const res = await request(app).post('/api/tools/ollama-local/inspect');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.intake.state).toBe('inspected');

        const state = loadIntakeState();
        expect(state.tools['ollama-local'].state).toBe('inspected');
    });

    test('returns 404 for unknown tool', async () => {
        const res = await request(app).post('/api/tools/no-such-tool/inspect');
        expect(res.status).toBe(404);
    });
});

/* ─── POST /api/tools/:id/reject ─────────────────────────────── */

describe('POST /api/tools/:id/reject', () => {
    beforeEach(() => {
        saveIntakeState({ files: {}, tools: {} });
        saveToolRegistry({
            tools: [
                {
                    id: 'ollama-local', name: 'Ollama', trusted: false,
                    running: false, status: 'detected', role: null,
                    endpoint: 'http://localhost:11434', interface: 'http',
                },
            ],
            active: {},
        });
    });

    test('persistently rejects a tool', async () => {
        const res = await request(app).post('/api/tools/ollama-local/reject');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.intake.state).toBe('rejected');

        const state = loadIntakeState();
        expect(state.tools['ollama-local'].state).toBe('rejected');
    });

    test('stores optional notes', async () => {
        const res = await request(app)
            .post('/api/tools/ollama-local/reject')
            .send({ notes: 'do not use' });
        expect(res.body.intake.notes).toBe('do not use');
    });

    test('returns 404 for unknown tool', async () => {
        const res = await request(app).post('/api/tools/no-such-tool/reject');
        expect(res.status).toBe(404);
    });

    test('rejected state persists across reloads', async () => {
        await request(app).post('/api/tools/ollama-local/reject');
        const state = loadIntakeState();
        expect(state.tools['ollama-local'].state).toBe('rejected');
    });
});

/* ─── GET /api/detected-files filters rejected items ─────────── */

describe('GET /api/detected-files — rejection filtering', () => {
    const thresholdDir = path.join(tmpDataRoot, 'threshold');

    beforeEach(() => {
        saveIntakeState({ files: {}, tools: {} });
        // Ensure threshold dir exists
        fs.mkdirSync(thresholdDir, { recursive: true });
    });

    afterEach(() => {
        // Clean up test files
        try {
            ['rejected-file.txt', 'normal-file.txt'].forEach(f => {
                const p = path.join(thresholdDir, f);
                if (fs.existsSync(p)) fs.unlinkSync(p);
            });
        } catch { /* ignore */ }
    });

    test('unmanaged rejected file does not appear in results', async () => {
        // Create a file on disk
        fs.writeFileSync(path.join(thresholdDir, 'rejected-file.txt'), 'hello', 'utf8');

        // Reject it
        const pastTime = new Date(Date.now() + 60000).toISOString(); // future timestamp
        saveIntakeState({
            files: {
                'threshold/rejected-file.txt': {
                    path:        'threshold/rejected-file.txt',
                    state:       'rejected',
                    lastReviewed: pastTime,
                    lastKnownMtime: new Date(Date.now() + 60000).toISOString(),
                },
            },
            tools: {},
        });

        const res = await request(app).get('/api/detected-files');
        expect(res.status).toBe(200);
        const filenames = (res.body.unmanaged || []).map(f => f.filename);
        expect(filenames).not.toContain('rejected-file.txt');
    });

    test('unmanaged non-rejected file appears in results', async () => {
        fs.writeFileSync(path.join(thresholdDir, 'normal-file.txt'), 'hello', 'utf8');

        const res = await request(app).get('/api/detected-files');
        expect(res.status).toBe(200);
        const filenames = (res.body.unmanaged || []).map(f => f.filename);
        expect(filenames).toContain('normal-file.txt');
    });
});

/* ─── POST /api/detected-files/acknowledge persists mtime ─────── */

describe('POST /api/detected-files/acknowledge — intake state update', () => {
    const SOURCE_ID = 'ack-test-source';

    beforeEach(() => {
        saveIntakeState({ files: {}, tools: {} });
        upsertManifest(SOURCE_ID, {
            id:     SOURCE_ID,
            room:   'threshold',
            status: 'waiting',
            file:   'ack-test.txt',
            path:   'threshold/ack-test.txt',
            ingestTimestamp: new Date(Date.now() - 10000).toISOString(),
        });
    });

    test('updates intake state to inspected on acknowledge', async () => {
        const res = await request(app)
            .post('/api/detected-files/acknowledge')
            .send({ sourceId: SOURCE_ID });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);

        const state = loadIntakeState();
        const entry = state.files['threshold/ack-test.txt'];
        expect(entry).toBeDefined();
        expect(entry.state).toBe('inspected');
        expect(typeof entry.lastKnownMtime).toBe('string');
    });
});

/* ─── GET /api/threshold/list includes intake field ─────────── */

describe('GET /api/threshold/list — intake field', () => {
    const SOURCE_ID = 'tl-test-source';

    beforeEach(() => {
        saveIntakeState({ files: {}, tools: {} });
        upsertManifest(SOURCE_ID, {
            id:     SOURCE_ID,
            room:   'threshold',
            status: 'waiting',
            file:   'tl-test.txt',
            path:   'threshold/tl-test.txt',
            ingestTimestamp: new Date().toISOString(),
        });
    });

    test('includes intake:null when no state recorded', async () => {
        const res = await request(app).get('/api/threshold/list');
        expect(res.status).toBe(200);
        const file = (res.body.files || []).find(f => f.sourceId === SOURCE_ID);
        expect(file).toBeDefined();
        expect(file.intake).toBeNull();
    });

    test('includes intake state when recorded', async () => {
        upsertIntakeFile('threshold/tl-test.txt', { state: 'inspected' });

        const res = await request(app).get('/api/threshold/list');
        expect(res.status).toBe(200);
        const file = (res.body.files || []).find(f => f.sourceId === SOURCE_ID);
        expect(file).toBeDefined();
        expect(file.intake).not.toBeNull();
        expect(file.intake.state).toBe('inspected');
    });
});

/* ─── GET /api/tools includes intake field ───────────────────── */

describe('GET /api/tools — intake field', () => {
    beforeEach(() => {
        saveIntakeState({ files: {}, tools: {} });
        saveToolRegistry({
            tools: [
                {
                    id: 'ollama-local', name: 'Ollama', trusted: false,
                    running: false, status: 'detected', role: null,
                    endpoint: 'http://localhost:11434', interface: 'http',
                },
            ],
            active: {},
        });
    });

    test('includes intake:null when no state recorded', async () => {
        const res = await request(app).get('/api/tools');
        expect(res.status).toBe(200);
        const tool = (res.body.tools || []).find(t => t.id === 'ollama-local');
        expect(tool).toBeDefined();
        expect(tool.intake).toBeNull();
    });

    test('includes intake state when recorded', async () => {
        upsertIntakeTool('ollama-local', { state: 'inspected' });

        const res = await request(app).get('/api/tools');
        expect(res.status).toBe(200);
        const tool = (res.body.tools || []).find(t => t.id === 'ollama-local');
        expect(tool).toBeDefined();
        expect(tool.intake).not.toBeNull();
        expect(tool.intake.state).toBe('inspected');
    });
});
