'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');

jest.mock('axios');

describe('Phase 17E — Signal Threads foundations', () => {
    let dataRoot;

    beforeEach(() => {
        jest.resetModules();
        dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-phase17e-test-'));
        process.env.EMBER_NODE_DATA_ROOT = dataRoot;
        delete process.env.EMBER_DATA_ROOT;
    });

    afterEach(() => {
        delete process.env.EMBER_NODE_DATA_ROOT;
        delete process.env.EMBER_DATA_ROOT;
        try { fs.rmSync(dataRoot, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    test('thread creation persists canonical schema', async () => {
        const { app } = require('../app/server');

        const create = await request(app)
            .post('/api/signal-threads')
            .send({ title: 'The Drying Well', posture: 'exploratory', summary: 'A continuity vessel.', tags: ['water', 'well'] });

        expect(create.status).toBe(200);
        expect(create.body.success).toBe(true);
        expect(create.body.thread).toBeTruthy();

        const thread = create.body.thread;
        expect(typeof thread.id).toBe('string');
        expect(thread.id.startsWith('thread-')).toBe(true);
        expect(thread.title).toBe('The Drying Well');
        expect(thread.posture).toBe('exploratory');
        expect(thread.status).toBe('active');
        expect(typeof thread.createdAt).toBe('string');
        expect(typeof thread.updatedAt).toBe('string');
        expect(thread.summary).toBe('A continuity vessel.');
        expect(Array.isArray(thread.reflections)).toBe(true);
        expect(Array.isArray(thread.observations)).toBe(true);
        expect(thread.compression).toBe('');
        expect(Array.isArray(thread.tags)).toBe(true);
        expect(thread.tags).toEqual(['water', 'well']);

        const onDiskPath = path.join(dataRoot, 'system', 'signal-threads', thread.id + '.json');
        expect(fs.existsSync(onDiskPath)).toBe(true);
        const onDisk = JSON.parse(fs.readFileSync(onDiskPath, 'utf8'));
        expect(onDisk.title).toBe('The Drying Well');
        expect(onDisk.posture).toBe('exploratory');
        expect(onDisk.status).toBe('active');

        const list = await request(app).get('/api/signal-threads');
        expect(list.status).toBe(200);
        expect(Array.isArray(list.body.threads)).toBe(true);
        expect(list.body.threads.find(t => t.id === thread.id)).toBeTruthy();
    });

    test('reflection, observation, compression persist and export markdown', async () => {
        const { app } = require('../app/server');

        const create = await request(app)
            .post('/api/signal-threads')
            .send({ title: 'Signal Thread Test', posture: 'reflective', summary: '' });
        const threadId = create.body.thread.id;

        const refl = await request(app)
            .post('/api/signal-threads/' + encodeURIComponent(threadId) + '/reflections')
            .send({ content: 'This matters because it preserves meaning.' });
        expect(refl.status).toBe(200);
        expect(refl.body.success).toBe(true);
        expect(refl.body.reflection).toHaveProperty('id');

        const obs = await request(app)
            .post('/api/signal-threads/' + encodeURIComponent(threadId) + '/observations')
            .send({ content: 'The well water level dropped overnight.' });
        expect(obs.status).toBe(200);
        expect(obs.body.success).toBe(true);
        expect(obs.body.observation).toHaveProperty('id');

        const comp = await request(app)
            .put('/api/signal-threads/' + encodeURIComponent(threadId) + '/compression')
            .send({ compression: 'We must ration and investigate the source.' });
        expect(comp.status).toBe(200);
        expect(comp.body.success).toBe(true);
        expect(comp.body.thread.compression).toBe('We must ration and investigate the source.');

        const fetched = await request(app).get('/api/signal-threads/' + encodeURIComponent(threadId));
        expect(fetched.status).toBe(200);
        expect(fetched.body.thread.reflections.length).toBe(1);
        expect(fetched.body.thread.observations.length).toBe(1);

        const exportRes = await request(app).get('/api/signal-threads/' + encodeURIComponent(threadId) + '/export');
        expect(exportRes.status).toBe(200);
        expect(String(exportRes.headers['content-type'] || '')).toContain('text/markdown');
        const md = exportRes.text;
        expect(md).toContain('# Signal Thread');
        expect(md).toContain('Title: Signal Thread Test');
        expect(md).toContain('Posture: reflective');
        expect(md).toContain('Status: active');
        expect(md).toContain('## Summary');
        expect(md).toContain('## Reflections');
        expect(md).toContain('This matters because it preserves meaning.');
        expect(md).toContain('## Observations');
        expect(md).toContain('The well water level dropped overnight.');
        expect(md).toContain('## Compression');
        expect(md).toContain('We must ration and investigate the source.');
    });
});
