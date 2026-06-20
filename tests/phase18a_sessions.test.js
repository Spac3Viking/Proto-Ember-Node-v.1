'use strict';

/**
 * Phase 18A — Instrument Panel: Session API tests
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const request = require('supertest');

jest.mock('axios');

describe('Phase 18A — Sessions API', () => {
    let dataRoot;

    beforeEach(() => {
        jest.resetModules();
        dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-phase18a-test-'));
        process.env.EMBER_NODE_DATA_ROOT = dataRoot;
        delete process.env.EMBER_DATA_ROOT;
    });

    afterEach(() => {
        delete process.env.EMBER_NODE_DATA_ROOT;
        delete process.env.EMBER_DATA_ROOT;
        try { fs.rmSync(dataRoot, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    // ── List (empty) ──────────────────────────────────────────────────────────

    test('GET /api/sessions returns empty list when no sessions exist', async () => {
        const { app } = require('../app/server');
        const res = await request(app).get('/api/sessions');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.sessions)).toBe(true);
        expect(res.body.sessions).toHaveLength(0);
    });

    // ── Create ────────────────────────────────────────────────────────────────

    test('POST /api/sessions creates a session with canonical schema', async () => {
        const { app } = require('../app/server');
        const res = await request(app)
            .post('/api/sessions')
            .send({ title: 'Water Pressure Situation' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);

        const s = res.body.session;
        expect(typeof s.id).toBe('string');
        expect(s.id.startsWith('session-')).toBe(true);
        expect(s.title).toBe('Water Pressure Situation');
        expect(s.currentStage).toBe('observe');
        expect(typeof s.createdAt).toBe('string');
        expect(typeof s.updatedAt).toBe('string');
        expect(Array.isArray(s.entries)).toBe(true);
        expect(s.entries).toHaveLength(0);

        // Verify on-disk persistence
        const filePath = path.join(dataRoot, 'sessions', s.id + '.json');
        expect(fs.existsSync(filePath)).toBe(true);
        const onDisk = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        expect(onDisk.title).toBe('Water Pressure Situation');
        expect(onDisk.currentStage).toBe('observe');
    });

    test('POST /api/sessions uses default title when none provided', async () => {
        const { app } = require('../app/server');
        const res = await request(app).post('/api/sessions').send({});
        expect(res.status).toBe(200);
        expect(res.body.session.title).toBe('New Session');
    });

    // ── List (populated) ──────────────────────────────────────────────────────

    test('GET /api/sessions lists created sessions', async () => {
        const { app } = require('../app/server');
        await request(app).post('/api/sessions').send({ title: 'Alpha' });
        await request(app).post('/api/sessions').send({ title: 'Beta' });

        const res = await request(app).get('/api/sessions');
        expect(res.status).toBe(200);
        expect(res.body.sessions.length).toBeGreaterThanOrEqual(2);
        const titles = res.body.sessions.map(s => s.title);
        expect(titles).toContain('Alpha');
        expect(titles).toContain('Beta');
    });

    // ── Load ──────────────────────────────────────────────────────────────────

    test('GET /api/sessions/:id returns the session', async () => {
        const { app } = require('../app/server');
        const create = await request(app).post('/api/sessions').send({ title: 'Test Session' });
        const id = create.body.session.id;

        const res = await request(app).get('/api/sessions/' + encodeURIComponent(id));
        expect(res.status).toBe(200);
        expect(res.body.session.id).toBe(id);
        expect(res.body.session.title).toBe('Test Session');
    });

    test('GET /api/sessions/:id returns 404 for unknown id', async () => {
        const { app } = require('../app/server');
        const res = await request(app).get('/api/sessions/does-not-exist-xyz');
        expect(res.status).toBe(404);
    });

    // ── Update ────────────────────────────────────────────────────────────────

    test('PUT /api/sessions/:id updates title', async () => {
        const { app } = require('../app/server');
        const create = await request(app).post('/api/sessions').send({ title: 'Old Title' });
        const id = create.body.session.id;

        const res = await request(app)
            .put('/api/sessions/' + encodeURIComponent(id))
            .send({ title: 'New Title' });
        expect(res.status).toBe(200);
        expect(res.body.session.title).toBe('New Title');
    });

    test('PUT /api/sessions/:id rejects invalid stage', async () => {
        const { app } = require('../app/server');
        const create = await request(app).post('/api/sessions').send({ title: 'S' });
        const id = create.body.session.id;

        const res = await request(app)
            .put('/api/sessions/' + encodeURIComponent(id))
            .send({ currentStage: 'transmit' });
        expect(res.status).toBe(400);
    });

    // ── Save stage notes ──────────────────────────────────────────────────────

    test('POST /api/sessions/:id/stage saves notes without advancing', async () => {
        const { app } = require('../app/server');
        const create = await request(app).post('/api/sessions').send({ title: 'Stage Test' });
        const id = create.body.session.id;

        const res = await request(app)
            .post('/api/sessions/' + encodeURIComponent(id) + '/stage')
            .send({ stage: 'observe', notes: 'The reservoir is low.', advance: false });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.session.currentStage).toBe('observe');
        const entry = res.body.session.entries.find(e => e.stage === 'observe');
        expect(entry).toBeTruthy();
        expect(entry.notes).toBe('The reservoir is low.');
        expect(entry.completedAt).toBeNull();
    });

    test('POST /api/sessions/:id/stage advances stage when advance=true', async () => {
        const { app } = require('../app/server');
        const create = await request(app).post('/api/sessions').send({ title: 'Advance Test' });
        const id = create.body.session.id;

        const res = await request(app)
            .post('/api/sessions/' + encodeURIComponent(id) + '/stage')
            .send({ stage: 'observe', notes: 'I see clearly.', advance: true });

        expect(res.status).toBe(200);
        expect(res.body.session.currentStage).toBe('reflect');
        const entry = res.body.session.entries.find(e => e.stage === 'observe');
        expect(entry.completedAt).toBeTruthy();
    });

    test('advancing through all stages lands at archive', async () => {
        const { app } = require('../app/server');
        const stages = ['observe', 'reflect', 'act', 'refine'];

        const create = await request(app).post('/api/sessions').send({ title: 'Full Journey' });
        let id = create.body.session.id;

        for (const stage of stages) {
            const res = await request(app)
                .post('/api/sessions/' + encodeURIComponent(id) + '/stage')
                .send({ stage, notes: 'Notes for ' + stage, advance: true });
            expect(res.status).toBe(200);
        }

        // Save archive stage without advancing (last stage)
        const final = await request(app)
            .post('/api/sessions/' + encodeURIComponent(id) + '/stage')
            .send({ stage: 'archive', notes: 'Remember this.', advance: true });
        expect(final.status).toBe(200);
        // stays at archive since it is the last stage
        expect(final.body.session.currentStage).toBe('archive');
    });

    test('POST /api/sessions/:id/stage rejects invalid stage', async () => {
        const { app } = require('../app/server');
        const create = await request(app).post('/api/sessions').send({ title: 'S' });
        const id = create.body.session.id;

        const res = await request(app)
            .post('/api/sessions/' + encodeURIComponent(id) + '/stage')
            .send({ stage: 'transmit', notes: 'bad stage' });
        expect(res.status).toBe(400);
    });

    // ── Export ────────────────────────────────────────────────────────────────

    test('GET /api/sessions/:id/export returns markdown', async () => {
        const { app } = require('../app/server');
        const create = await request(app).post('/api/sessions').send({ title: 'Export Me' });
        const id = create.body.session.id;

        // Save a note so export has content
        await request(app)
            .post('/api/sessions/' + encodeURIComponent(id) + '/stage')
            .send({ stage: 'observe', notes: 'Water is scarce.', advance: false });

        const res = await request(app).get('/api/sessions/' + encodeURIComponent(id) + '/export');
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/markdown/);
        expect(res.text).toContain('Export Me');
        expect(res.text).toContain('## Observe');
        expect(res.text).toContain('Water is scarce.');
        expect(res.text).toContain('## Reflect');
        expect(res.text).toContain('## Archive');
    });

    test('GET /api/sessions/:id/export returns 404 for unknown id', async () => {
        const { app } = require('../app/server');
        const res = await request(app).get('/api/sessions/nope-xyz/export');
        expect(res.status).toBe(404);
    });

    // ── Delete ────────────────────────────────────────────────────────────────

    test('DELETE /api/sessions/:id removes the session', async () => {
        const { app } = require('../app/server');
        const create = await request(app).post('/api/sessions').send({ title: 'To Delete' });
        const id = create.body.session.id;

        const del = await request(app).delete('/api/sessions/' + encodeURIComponent(id));
        expect(del.status).toBe(200);
        expect(del.body.success).toBe(true);

        const filePath = path.join(dataRoot, 'sessions', id + '.json');
        expect(fs.existsSync(filePath)).toBe(false);

        const get = await request(app).get('/api/sessions/' + encodeURIComponent(id));
        expect(get.status).toBe(404);
    });

    test('DELETE /api/sessions/:id returns 404 for unknown id', async () => {
        const { app } = require('../app/server');
        const res = await request(app).delete('/api/sessions/ghost-session');
        expect(res.status).toBe(404);
    });

    // ── sessions service unit tests ───────────────────────────────────────────

    test('normalizeSession fills defaults for empty input', () => {
        jest.resetModules();
        process.env.EMBER_NODE_DATA_ROOT = dataRoot;
        const { normalizeSession } = require('../app/sessions');
        const s = normalizeSession({});
        expect(s.title).toBe('Untitled Session');
        expect(s.currentStage).toBe('observe');
        expect(Array.isArray(s.entries)).toBe(true);
    });

    test('exportSessionMarkdown includes all stage headings', () => {
        jest.resetModules();
        process.env.EMBER_NODE_DATA_ROOT = dataRoot;
        const { createSession, saveStageNotes, exportSessionMarkdown } = require('../app/sessions');
        const s = createSession({ title: 'Export Unit Test' });
        saveStageNotes(s.id, 'observe', 'Testing.', false);
        const md = exportSessionMarkdown(s.id);
        expect(md).toContain('## Observe');
        expect(md).toContain('## Reflect');
        expect(md).toContain('## Act');
        expect(md).toContain('## Refine');
        expect(md).toContain('## Archive');
        expect(md).toContain('Testing.');
        expect(md).toContain('session_id:');
    });
});
