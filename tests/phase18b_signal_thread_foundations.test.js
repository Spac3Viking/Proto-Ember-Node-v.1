'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');

jest.mock('axios');

describe('Phase 18B — Signal Thread foundations', () => {
    let dataRoot;

    beforeEach(() => {
        jest.resetModules();
        dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-phase18b-test-'));
        process.env.EMBER_NODE_DATA_ROOT = dataRoot;
        delete process.env.EMBER_DATA_ROOT;
    });

    afterEach(() => {
        delete process.env.EMBER_NODE_DATA_ROOT;
        delete process.env.EMBER_DATA_ROOT;
        try { fs.rmSync(dataRoot, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    test('archived session can create and attach to a new signal thread', async () => {
        const { app } = require('../app/server');
        const sessionCreate = await request(app).post('/api/sessions').send({ title: 'Property Walkthrough' });
        const sessionId = sessionCreate.body.session.id;

        const link = await request(app)
            .post('/api/sessions/' + encodeURIComponent(sessionId) + '/archive-thread')
            .send({ newThreadTitle: 'Property Maintenance' });

        expect(link.status).toBe(200);
        expect(link.body.success).toBe(true);
        expect(link.body.thread.title).toBe('Property Maintenance');
        expect(Array.isArray(link.body.thread.sessionIds)).toBe(true);
        expect(link.body.thread.sessionIds).toContain(sessionId);

        const list = await request(app).get('/api/signal-threads');
        const thread = list.body.threads.find(t => t.id === link.body.thread.id);
        expect(thread).toBeTruthy();
        expect(thread.sessionCount).toBe(1);
    });

    test('session can attach to an existing thread and linked sessions are returned', async () => {
        const { app } = require('../app/server');

        const s1 = await request(app).post('/api/sessions').send({ title: 'Cycle One' });
        const s2 = await request(app).post('/api/sessions').send({ title: 'Cycle Two' });
        const threadCreate = await request(app)
            .post('/api/signal-threads')
            .send({ title: 'Health Recovery', posture: 'practical' });
        const threadId = threadCreate.body.thread.id;

        const attach1 = await request(app)
            .post('/api/sessions/' + encodeURIComponent(s1.body.session.id) + '/archive-thread')
            .send({ threadId });
        const attach2 = await request(app)
            .post('/api/sessions/' + encodeURIComponent(s2.body.session.id) + '/archive-thread')
            .send({ threadId });

        expect(attach1.status).toBe(200);
        expect(attach2.status).toBe(200);

        const linked = await request(app).get('/api/signal-threads/' + encodeURIComponent(threadId) + '/linked-sessions');
        expect(linked.status).toBe(200);
        expect(Array.isArray(linked.body.sessions)).toBe(true);
        const ids = linked.body.sessions.map(s => s.id);
        expect(ids).toContain(s1.body.session.id);
        expect(ids).toContain(s2.body.session.id);
    });

    test('generate summary returns concise continuity compression sections', async () => {
        const { app } = require('../app/server');

        const session = await request(app).post('/api/sessions').send({ title: 'Family Traditions' });
        const sessionId = session.body.session.id;
        await request(app)
            .post('/api/sessions/' + encodeURIComponent(sessionId) + '/stage')
            .send({ stage: 'observe', notes: 'Question: what tradition should continue?', advance: true });

        const link = await request(app)
            .post('/api/sessions/' + encodeURIComponent(sessionId) + '/archive-thread')
            .send({ newThreadTitle: 'Family Traditions' });
        const threadId = link.body.thread.id;

        const summarize = await request(app)
            .post('/api/signal-threads/' + encodeURIComponent(threadId) + '/generate-summary')
            .send({});

        expect(summarize.status).toBe(200);
        expect(summarize.body.success).toBe(true);
        expect(summarize.body.summary).toContain('Patterns:');
        expect(summarize.body.summary).toContain('Lessons:');
        expect(summarize.body.summary).toContain('Open Questions:');
        expect(summarize.body.summary).toContain('Unresolved Pressures:');
        expect(summarize.body.summary).toContain('Recent Progress:');
    });
});
