'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');

jest.mock('axios');

describe('Phase 18C — Living Continuity', () => {
    let dataRoot;

    beforeEach(() => {
        jest.resetModules();
        dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-phase18c-test-'));
        process.env.EMBER_NODE_DATA_ROOT = dataRoot;
        delete process.env.EMBER_DATA_ROOT;
    });

    afterEach(() => {
        delete process.env.EMBER_NODE_DATA_ROOT;
        delete process.env.EMBER_DATA_ROOT;
        try { fs.rmSync(dataRoot, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    test('archive-thread captures open pressure and carry forward entries', async () => {
        const { app } = require('../app/server');
        const sessionCreate = await request(app).post('/api/sessions').send({ title: 'Fence inspection' });
        const sessionId = sessionCreate.body.session.id;

        const link = await request(app)
            .post('/api/sessions/' + encodeURIComponent(sessionId) + '/archive-thread')
            .send({
                newThreadTitle: 'Property Maintenance',
                openPressure: 'Replace north fence before winter',
                carryForward: 'Measure twice before cutting.',
            });

        expect(link.status).toBe(200);
        expect(link.body.success).toBe(true);
        expect(Array.isArray(link.body.thread.openPressures)).toBe(true);
        expect(link.body.thread.openPressures).toContain('Replace north fence before winter');
        expect(Array.isArray(link.body.thread.carryForwardEntries)).toBe(true);
        expect(link.body.thread.carryForwardEntries.some(e => e.content === 'Measure twice before cutting.')).toBe(true);
    });

    test('new session can continue an existing thread with continuity preload context', async () => {
        const { app } = require('../app/server');
        const threadCreate = await request(app)
            .post('/api/signal-threads')
            .send({
                title: 'Health Recovery',
                purpose: 'Preserve practical healing lessons over time.',
                posture: 'practical',
                openPressures: ['Assess forearm strength after exercises'],
            });
        const threadId = threadCreate.body.thread.id;
        await request(app)
            .post('/api/signal-threads/' + encodeURIComponent(threadId) + '/carry-forward')
            .send({ content: 'Small daily gains compound.' });
        await request(app)
            .post('/api/signal-threads/' + encodeURIComponent(threadId) + '/reflections')
            .send({ content: 'Grip strength improved after the last routine.' });

        const res = await request(app)
            .post('/api/sessions')
            .send({ title: 'Follow-up', continueThreadId: threadId });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.session.continuity.threadId).toBe(threadId);
        expect(res.body.session.continuity.threadTitle).toBe('Health Recovery');
        expect(res.body.session.continuity.threadPurpose).toContain('healing lessons');
        expect(res.body.session.continuity.openPressure).toContain('Assess forearm strength');
        expect(res.body.session.continuity.carryForward).toContain('Small daily gains');
        expect(res.body.session.continuity.mostRecentReflection).toContain('Grip strength improved');
    });

    test('thread list includes continuity counters', async () => {
        const { app } = require('../app/server');
        const create = await request(app)
            .post('/api/signal-threads')
            .send({
                title: 'Green Fire Development',
                purpose: 'Refine tools and continuity practices.',
                posture: 'practical',
                openPressures: ['Evaluate Session workflow'],
            });
        const threadId = create.body.thread.id;
        await request(app)
            .post('/api/signal-threads/' + encodeURIComponent(threadId) + '/carry-forward')
            .send({ content: 'Simpler systems are easier to maintain.' });

        const list = await request(app).get('/api/signal-threads');
        expect(list.status).toBe(200);
        const row = list.body.threads.find(t => t.id === threadId);
        expect(row).toBeTruthy();
        expect(row.purpose).toBe('Refine tools and continuity practices.');
        expect(row.openPressureCount).toBe(1);
        expect(row.carryForwardCount).toBe(1);
    });
});
