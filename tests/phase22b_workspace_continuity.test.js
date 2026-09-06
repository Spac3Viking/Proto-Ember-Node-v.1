'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');

jest.mock('axios');

describe('Phase 22B — workspace continuity', () => {
    let dataRoot;

    beforeEach(() => {
        jest.resetModules();
        dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-phase22b-test-'));
        process.env.EMBER_NODE_DATA_ROOT = dataRoot;
        delete process.env.EMBER_DATA_ROOT;
    });

    afterEach(() => {
        delete process.env.EMBER_NODE_DATA_ROOT;
        delete process.env.EMBER_DATA_ROOT;
        fs.rmSync(dataRoot, { recursive: true, force: true });
    });

    test('remembers editable checkpoints and navigable thread relations with provenance', async () => {
        const { app } = require('../app/server');
        const created = await request(app).post('/api/signal-threads').send({ title: 'Repair desk', posture: 'practical' });
        const id = created.body.thread.id;
        const entry = await request(app).post('/api/signal-threads/' + id + '/entries').send({
            stage: 'act', content: 'Replaced the worn cable.', kind: 'ai-exchange',
            provenance: { type: 'archive', id: 'repair-manual', label: 'Repair Manual' },
        });
        expect(entry.status).toBe(200);
        expect(entry.body.entry.provenance.id).toBe('repair-manual');

        const remembered = await request(app).post('/api/signal-threads/' + id + '/remember').send({ content: 'Keep a spare cable.' });
        expect(remembered.status).toBe(200);
        expect(remembered.body.checkpoint.origin.threadId).toBe(id);
        const checkpoint = await request(app).put('/api/hearth/checkpoints/' + remembered.body.checkpoint.id)
            .send({ content: 'Keep two spare cables.' });
        expect(checkpoint.body.checkpoint.content).toBe('Keep two spare cables.');

        const related = await request(app).post('/api/workspace/relations').send({
            from: { type: 'thread', id }, to: { type: 'checkpoint', id: remembered.body.checkpoint.id },
        });
        expect(related.status).toBe(200);
        const relations = await request(app).get('/api/workspace/relations?type=thread&id=' + id);
        expect(relations.body.relations).toHaveLength(1);
    });

    test('migrates sessions only once and can roll back untouched migrated threads', async () => {
        const { app } = require('../app/server');
        const session = await request(app).post('/api/sessions').send({ title: 'Plan garden' });
        await request(app).post('/api/sessions/' + session.body.session.id + '/stage')
            .send({ stage: 'reflect', notes: 'Measure sun exposure.', advance: false });
        const first = await request(app).post('/api/workspace/migrate-sessions').send();
        expect(first.body.created).toHaveLength(1);
        const second = await request(app).post('/api/workspace/migrate-sessions').send();
        expect(second.body.created).toHaveLength(0);
        const rollback = await request(app).post('/api/workspace/rollback-session-migration').send();
        expect(rollback.body.rolledBack).toHaveLength(1);
        expect((await request(app).get('/api/signal-threads')).body.threads).toHaveLength(0);
    });
});
