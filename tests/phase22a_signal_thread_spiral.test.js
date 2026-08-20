'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');

jest.mock('axios');

describe('Phase 22A — Signal Thread spiral foundation', () => {
    let dataRoot;

    beforeEach(() => {
        jest.resetModules();
        dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-phase22a-test-'));
        process.env.EMBER_NODE_DATA_ROOT = dataRoot;
        delete process.env.EMBER_DATA_ROOT;
    });

    afterEach(() => {
        delete process.env.EMBER_NODE_DATA_ROOT;
        delete process.env.EMBER_DATA_ROOT;
        fs.rmSync(dataRoot, { recursive: true, force: true });
    });

    test('legacy threads normalize to observe and expose their stage in lists', async () => {
        const legacyDir = path.join(dataRoot, 'system', 'signal-threads');
        fs.mkdirSync(legacyDir, { recursive: true });
        fs.writeFileSync(path.join(legacyDir, 'thread-legacy.json'), JSON.stringify({
            id: 'thread-legacy',
            title: 'Legacy Thread',
            posture: 'exploratory',
            status: 'active',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            observations: [],
            reflections: [],
        }));

        const { app } = require('../app/server');
        const loaded = await request(app).get('/api/signal-threads/thread-legacy');
        expect(loaded.status).toBe(200);
        expect(loaded.body.thread.currentStage).toBe('observe');
        expect(loaded.body.thread.entries).toEqual([]);

        const list = await request(app).get('/api/signal-threads');
        expect(list.status).toBe(200);
        expect(list.body.threads).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'thread-legacy', currentStage: 'observe' }),
        ]));
    });

    test('accepts every stage, rejects invalid stages, and moves in either direction', async () => {
        const { app } = require('../app/server');
        const stages = ['observe', 'reflect', 'act', 'refine', 'remember', 'relate'];

        for (const currentStage of stages) {
            const create = await request(app)
                .post('/api/signal-threads')
                .send({ title: 'Stage ' + currentStage, posture: 'exploratory', currentStage });
            expect(create.status).toBe(200);
            expect(create.body.thread.currentStage).toBe(currentStage);
        }

        const invalid = await request(app)
            .post('/api/signal-threads')
            .send({ title: 'Invalid', posture: 'exploratory', currentStage: 'advance' });
        expect(invalid.status).toBe(400);

        const create = await request(app)
            .post('/api/signal-threads')
            .send({ title: 'Reversible', posture: 'exploratory', currentStage: 'observe' });
        const id = create.body.thread.id;
        const forward = await request(app).put('/api/signal-threads/' + id).send({ currentStage: 'relate' });
        expect(forward.status).toBe(200);
        expect(forward.body.thread.currentStage).toBe('relate');
        const backward = await request(app).put('/api/signal-threads/' + id).send({ currentStage: 'observe' });
        expect(backward.status).toBe(200);
        expect(backward.body.thread.currentStage).toBe('observe');
        const invalidUpdate = await request(app).put('/api/signal-threads/' + id).send({ currentStage: 'advance' });
        expect(invalidUpdate.status).toBe(400);
    });

    test('persists a Field Log entry and its stage atomically, including backward moves', async () => {
        const { app } = require('../app/server');
        const create = await request(app)
            .post('/api/signal-threads')
            .send({ title: 'Field Log', posture: 'reflective', currentStage: 'relate' });
        const id = create.body.thread.id;

        const added = await request(app)
            .post('/api/signal-threads/' + id + '/entries')
            .send({ stage: 'act', content: 'Test the repair at dawn.' });
        expect(added.status).toBe(200);
        expect(added.body.entry).toEqual(expect.objectContaining({
            id: expect.any(String),
            stage: 'act',
            content: 'Test the repair at dawn.',
            timestamp: expect.any(String),
        }));

        const afterAdd = await request(app).get('/api/signal-threads/' + id);
        expect(afterAdd.body.thread.currentStage).toBe('act');
        expect(afterAdd.body.thread.entries).toEqual([
            expect.objectContaining({ stage: 'act', content: 'Test the repair at dawn.' }),
        ]);

        const movedBackward = await request(app)
            .post('/api/signal-threads/' + id + '/entries')
            .send({ stage: 'observe', content: 'Return to first principles.' });
        expect(movedBackward.status).toBe(200);

        const list = await request(app).get('/api/signal-threads');
        expect(list.body.threads).toEqual(expect.arrayContaining([
            expect.objectContaining({ id, currentStage: 'observe' }),
        ]));

        const beforeInvalid = await request(app).get('/api/signal-threads/' + id);
        const invalid = await request(app)
            .post('/api/signal-threads/' + id + '/entries')
            .send({ stage: 'advance', content: 'Not allowed.' });
        expect(invalid.status).toBe(400);
        const empty = await request(app)
            .post('/api/signal-threads/' + id + '/entries')
            .send({ stage: 'reflect', content: '   ' });
        expect(empty.status).toBe(400);
        const afterInvalid = await request(app).get('/api/signal-threads/' + id);
        expect(afterInvalid.body.thread).toEqual(beforeInvalid.body.thread);

        const markdown = await request(app).get('/api/signal-threads/' + id + '/export');
        expect(markdown.status).toBe(200);
        expect(markdown.text).toContain('Current Stage: observe');
        expect(markdown.text).toContain('## Field Log');
        expect(markdown.text).toContain('Test the repair at dawn.');
        expect(markdown.text).toContain('act');
        expect(markdown.text).toContain('Return to first principles.');
        expect(markdown.text).toContain('observe');

        const brief = await request(app).get('/api/signal-threads/' + id + '/brief');
        expect(brief.status).toBe(200);
        expect(brief.text).toContain('Field Log:');
        expect(brief.text).toContain('· act');
        expect(brief.text).toContain('· observe');
    });
});
