'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');

jest.mock('axios');

describe('Phase 22D — intentional Remember to Hearth', () => {
    let dataRoot;

    beforeEach(() => {
        jest.resetModules();
        dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-phase22d-test-'));
        process.env.EMBER_NODE_DATA_ROOT = dataRoot;
        delete process.env.EMBER_DATA_ROOT;
    });

    afterEach(() => {
        delete process.env.EMBER_NODE_DATA_ROOT;
        delete process.env.EMBER_DATA_ROOT;
        fs.rmSync(dataRoot, { recursive: true, force: true });
    });

    async function createThread() {
        const { app } = require('../app/server');
        const created = await request(app).post('/api/signal-threads')
            .send({ title: 'Hearth origin', posture: 'practical' });
        return { app, id: created.body.thread.id };
    }

    test('stage selection alone creates nothing and blank checkpoint content is rejected', async () => {
        const { app, id } = await createThread();
        await request(app).put('/api/signal-threads/' + id).send({ currentStage: 'remember' }).expect(200);
        await request(app).post('/api/signal-threads/' + id + '/remember').send({ content: '   ' }).expect(400);
        await request(app).get('/api/hearth/checkpoints').expect(200)
            .expect(({ body }) => expect(body.checkpoints).toEqual([]));
    });

    test('explicit creation and updates retain checkpoint identity, provenance, and timestamps', async () => {
        const { app, id } = await createThread();
        const entry = await request(app).post('/api/signal-threads/' + id + '/entries')
            .send({ stage: 'reflect', content: 'Reviewed result.' });
        const created = await request(app).post('/api/signal-threads/' + id + '/remember')
            .send({ content: 'Preserve this reviewed result.', selectedEntryIds: [entry.body.entry.id] });
        expect(created.status).toBe(200);
        const checkpoint = created.body.checkpoint;
        expect(checkpoint.origin).toEqual(expect.objectContaining({
            threadId: id,
            selectedEntryIds: [entry.body.entry.id],
        }));

        const updated = await request(app).post('/api/signal-threads/' + id + '/remember')
            .send({ content: 'Deliberately revised material.', selectedEntryIds: [entry.body.entry.id] });
        expect(updated.status).toBe(200);
        expect(updated.body.checkpoint.id).toBe(checkpoint.id);
        expect(updated.body.checkpoint.createdAt).toBe(checkpoint.createdAt);
        expect(updated.body.checkpoint.content).toBe('Deliberately revised material.');

        await request(app).put('/api/hearth/checkpoints/' + checkpoint.id).send({ content: ' ' }).expect(400);
        const loaded = await request(app).get('/api/hearth/checkpoints/' + checkpoint.id).expect(200);
        expect(loaded.body.checkpoint.content).toBe('Deliberately revised material.');
    });

    test('failed writes retain the persisted checkpoint and a retry succeeds without duplication', async () => {
        const { app, id } = await createThread();
        const created = await request(app).post('/api/signal-threads/' + id + '/remember')
            .send({ content: 'Persisted checkpoint.' });
        const checkpoint = created.body.checkpoint;
        const originalRename = fs.renameSync;
        const renameSpy = jest.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
            if (String(to).endsWith(checkpoint.id + '.json')) throw new Error('simulated interruption');
            return originalRename(from, to);
        });

        await request(app).put('/api/hearth/checkpoints/' + checkpoint.id)
            .send({ content: 'Failed replacement.' }).expect(400);
        renameSpy.mockRestore();
        expect((await request(app).get('/api/hearth/checkpoints/' + checkpoint.id)).body.checkpoint.content)
            .toBe('Persisted checkpoint.');

        const retried = await request(app).put('/api/hearth/checkpoints/' + checkpoint.id)
            .send({ content: 'Retried replacement.' }).expect(200);
        expect(retried.body.checkpoint.id).toBe(checkpoint.id);
        expect((await request(app).get('/api/hearth/checkpoints')).body.checkpoints).toHaveLength(1);
    });

    test('checkpoints survive an application restart and retain their originating thread', async () => {
        const { app, id } = await createThread();
        const created = await request(app).post('/api/signal-threads/' + id + '/remember')
            .send({ content: 'Restart-safe material.' }).expect(200);

        jest.resetModules();
        const restarted = require('../app/server').app;
        const checkpoint = await request(restarted).get('/api/hearth/checkpoints/' + created.body.checkpoint.id).expect(200);
        expect(checkpoint.body.checkpoint).toEqual(expect.objectContaining({
            id: created.body.checkpoint.id,
            content: 'Restart-safe material.',
            origin: expect.objectContaining({ threadId: id }),
        }));
        expect((await request(restarted).get('/api/signal-threads/' + id)).status).toBe(200);
    });
});
