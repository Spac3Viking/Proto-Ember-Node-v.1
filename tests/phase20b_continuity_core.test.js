'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');

describe('Phase 20B — Continuity Core', () => {
    let dataRoot;

    beforeEach(() => {
        jest.resetModules();
        dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-phase20b-test-'));
        process.env.EMBER_NODE_DATA_ROOT = dataRoot;
    });

    afterEach(() => {
        delete process.env.EMBER_NODE_DATA_ROOT;
        fs.rmSync(dataRoot, { recursive: true, force: true });
    });

    test('standalone sessions remain usable and Thread linking is bidirectional and idempotent', async () => {
        const { app } = require('../app/server');
        const standalone = await request(app).post('/api/sessions').send({ title: 'Field notes' });
        expect(standalone.status).toBe(200);
        expect(standalone.body.session.continuity.threadId).toBe('');

        const created = await request(app).post('/api/signal-threads').send({
            title: 'Fence work', posture: 'practical',
        });
        const threadId = created.body.thread.id;
        const linkUrl = '/api/signal-threads/' + encodeURIComponent(threadId) + '/sessions';
        await request(app).post(linkUrl).send({ sessionId: standalone.body.session.id }).expect(200);
        await request(app).post(linkUrl).send({ sessionId: standalone.body.session.id }).expect(200);

        const session = await request(app).get('/api/sessions/' + standalone.body.session.id);
        const thread = await request(app).get('/api/signal-threads/' + threadId);
        expect(session.body.session.continuity.threadId).toBe(threadId);
        expect(thread.body.thread.sessionIds).toEqual([standalone.body.session.id]);
    });

    test('a session cannot silently switch canonical Threads and rejects invalid IDs', async () => {
        const { app } = require('../app/server');
        const session = await request(app).post('/api/sessions').send({ title: 'Work' });
        const first = await request(app).post('/api/signal-threads').send({ title: 'First', posture: 'practical' });
        const second = await request(app).post('/api/signal-threads').send({ title: 'Second', posture: 'practical' });
        await request(app).post('/api/signal-threads/' + first.body.thread.id + '/sessions')
            .send({ sessionId: session.body.session.id }).expect(200);
        await request(app).post('/api/signal-threads/' + second.body.thread.id + '/sessions')
            .send({ sessionId: session.body.session.id }).expect(409);
        await request(app).get('/api/sessions/..%2Fsecret').expect(400);
        await request(app).get('/api/signal-threads/..%2Fsecret').expect(400);
    });

    test('live Thread context takes precedence over compatible copied Session snapshots', async () => {
        const { buildContinuityContext } = require('../app/continuityContext');
        const context = buildContinuityContext({
            title: 'Current work',
            currentStage: 'reflect',
            entries: [],
            continuity: { threadTitle: 'Stale title', carryForward: 'Stale text' },
        }, {
            title: 'Live Thread',
            purpose: 'Current purpose',
            openPressures: ['Live pressure'],
            carryForwardEntries: [{ timestamp: '2026-01-01T00:00:00Z', content: 'Live carry-forward' }],
            observations: [],
            reflections: [],
        }, 'What now?');
        expect(context).toContain('Live Thread');
        expect(context).toContain('Live carry-forward');
        expect(context).not.toContain('Stale title');
        expect(context).not.toContain('Stale text');
    });

    test('canonical membership cannot be changed through generic routes and deletion preserves links', async () => {
        const { app } = require('../app/server');
        const session = await request(app).post('/api/sessions').send({ title: 'Work' });
        const thread = await request(app).post('/api/signal-threads').send({ title: 'Fence', posture: 'practical' });
        const sessionId = session.body.session.id;
        const threadId = thread.body.thread.id;
        await request(app).put('/api/sessions/' + sessionId)
            .send({ continuity: { threadId } }).expect(409);
        await request(app).put('/api/signal-threads/' + threadId)
            .send({ sessionIds: [sessionId] }).expect(409);
        await request(app).post('/api/signal-threads/' + threadId + '/sessions')
            .send({ sessionId }).expect(200);
        await request(app).delete('/api/signal-threads/' + threadId).expect(409);
        await request(app).delete('/api/sessions/' + sessionId).expect(200);
        const remaining = await request(app).get('/api/signal-threads/' + threadId);
        expect(remaining.body.thread.sessionIds).toEqual([]);
    });

    test('archive-thread rejects an already-linked Session before creating a Thread', async () => {
        const { app } = require('../app/server');
        const session = await request(app).post('/api/sessions').send({ title: 'Work' });
        const thread = await request(app).post('/api/signal-threads').send({ title: 'Fence', posture: 'practical' });
        await request(app).post('/api/signal-threads/' + thread.body.thread.id + '/sessions')
            .send({ sessionId: session.body.session.id }).expect(200);
        await request(app).post('/api/sessions/' + session.body.session.id + '/archive-thread')
            .send({ newThreadTitle: 'Must not exist' }).expect(409);
        const threads = await request(app).get('/api/signal-threads');
        expect(threads.body.threads).toHaveLength(1);
    });

    test('continuity and shared AI request contexts have deterministic limits and opt-in lenses', () => {
        const { LIMITS, buildContinuityContext } = require('../app/continuityContext');
        const { buildAiRequest, NATURAL_RESPONSE_DISCIPLINE } = require('../app/aiRequestContext');
        const context = buildContinuityContext(
            { id: 'current', title: 'x'.repeat(500), entries: Array(8).fill({ notes: 'n'.repeat(2000) }) },
            { title: 'Thread', openPressures: Array(10).fill('p'.repeat(1000)), carryForwardEntries: [], observations: [], reflections: [] },
            'q'.repeat(8000),
            Array(10).fill(null).map((_, index) => ({ id: 'old-' + index, title: 't'.repeat(500), updatedAt: '2026-01-01' })),
        );
        expect(context.length).toBeLessThanOrEqual(LIMITS.block + 1);
        const request = buildAiRequest({ continuityContext: 'current', retrievalContext: 'retrieval', userContent: 'question' });
        expect(request.messages[0].content).toContain(NATURAL_RESPONSE_DISCIPLINE);
        expect(request.messages[1].content).toBe('current\n\nretrieval\n\nquestion');
        expect(request.messages[1].content).not.toMatch(/archetype|council/i);
    });
});
