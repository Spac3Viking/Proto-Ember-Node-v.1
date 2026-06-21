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
            .send({
                title: 'The Drying Well',
                purpose: 'Track and steward the long-term well recovery effort.',
                posture: 'exploratory',
                summary: 'A continuity vessel.',
                tags: ['water', 'well'],
            });

        expect(create.status).toBe(200);
        expect(create.body.success).toBe(true);
        expect(create.body.thread).toBeTruthy();

        const thread = create.body.thread;
        expect(typeof thread.id).toBe('string');
        expect(thread.id.startsWith('thread-')).toBe(true);
        expect(thread.title).toBe('The Drying Well');
        expect(thread.purpose).toBe('Track and steward the long-term well recovery effort.');
        expect(thread.posture).toBe('exploratory');
        expect(thread.status).toBe('active');
        expect(typeof thread.createdAt).toBe('string');
        expect(typeof thread.updatedAt).toBe('string');
        expect(thread.summary).toBe('A continuity vessel.');
        expect(thread.currentSituation).toBe('');
        expect(thread.openPressure).toBe('');
        expect(thread.sourceNotes).toBe('');
        expect(Array.isArray(thread.reflections)).toBe(true);
        expect(Array.isArray(thread.observations)).toBe(true);
        expect(thread.compression).toBe('');
        expect(Array.isArray(thread.tags)).toBe(true);
        expect(thread.tags).toEqual(['water', 'well']);

        const onDiskPath = path.join(dataRoot, 'system', 'signal-threads', thread.id + '.json');
        expect(fs.existsSync(onDiskPath)).toBe(true);
        const onDisk = JSON.parse(fs.readFileSync(onDiskPath, 'utf8'));
        expect(onDisk.title).toBe('The Drying Well');
        expect(onDisk.purpose).toBe('Track and steward the long-term well recovery effort.');
        expect(onDisk.posture).toBe('exploratory');
        expect(onDisk.status).toBe('active');
        expect(onDisk.currentSituation).toBe('');
        expect(onDisk.openPressure).toBe('');
        expect(onDisk.sourceNotes).toBe('');

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

        const patch = await request(app)
            .put('/api/signal-threads/' + encodeURIComponent(threadId))
            .send({
                currentSituation: 'Exploring the well collapse.',
                openPressure: 'Can we find a new source?',
                sourceNotes: 'Chat Session 12',
            });
        expect(patch.status).toBe(200);
        expect(patch.body.success).toBe(true);
        expect(patch.body.thread.currentSituation).toBe('Exploring the well collapse.');
        expect(patch.body.thread.openPressure).toBe('Can we find a new source?');
        expect(patch.body.thread.sourceNotes).toBe('Chat Session 12');

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
        expect(md).toContain('## Overview');
        expect(md).toContain('Title: Signal Thread Test');
        expect(md).toContain('Posture: reflective');
        expect(md).toContain('Status: active');
        expect(md).toContain('Tags:');
        expect(md).toContain('Created:');
        expect(md).toContain('Last Updated:');
        expect(md).toContain('## Current Compression');
        expect(md).toContain('## Current Situation');
        expect(md).toContain('Exploring the well collapse.');
        expect(md).toContain('## Open Pressure');
        expect(md).toContain('Can we find a new source?');
        expect(md).toContain('## Application / Observation / Reflection');
        expect(md).toContain('## Source Notes');
        expect(md).toContain('Chat Session 12');
        expect(md).toContain('## Recent Reflections');
        expect(md).toContain('This matters because it preserves meaning.');
        expect(md).toContain('## Recent Observations');
        expect(md).toContain('The well water level dropped overnight.');
        expect(md).toContain('We must ration and investigate the source.');
        expect(md).toContain('## Saga Cycles');

        expect(md.indexOf('## Overview')).toBeGreaterThanOrEqual(0);
        expect(md.indexOf('## Current Compression')).toBeGreaterThan(md.indexOf('## Overview'));
        expect(md.indexOf('## Current Situation')).toBeGreaterThan(md.indexOf('## Current Compression'));
        expect(md.indexOf('## Open Pressure')).toBeGreaterThan(md.indexOf('## Current Situation'));
        expect(md.indexOf('## Application / Observation / Reflection')).toBeGreaterThan(md.indexOf('## Open Pressure'));
        expect(md.indexOf('## Recent Observations')).toBeGreaterThan(md.indexOf('## Application / Observation / Reflection'));
        expect(md.indexOf('## Recent Reflections')).toBeGreaterThan(md.indexOf('## Recent Observations'));
        expect(md.indexOf('## Source Notes')).toBeGreaterThan(md.indexOf('## Recent Reflections'));

        const briefRes = await request(app).get('/api/signal-threads/' + encodeURIComponent(threadId) + '/brief');
        expect(briefRes.status).toBe(200);
        expect(String(briefRes.headers['content-type'] || '')).toContain('text/plain');
        const brief = briefRes.text;
        expect(brief).toContain('SIGNAL THREAD');
        expect(brief).toContain('Overview:');
        expect(brief).toContain('Title: Signal Thread Test');
        expect(brief).toContain('Posture: reflective');
        expect(brief).toContain('Status: active');
        expect(brief).toContain('Last Updated:');
        expect(brief).toContain('Current Compression:');
        expect(brief).toContain('Current Situation:');
        expect(brief).toContain('Exploring the well collapse.');
        expect(brief).toContain('Open Pressure:');
        expect(brief).toContain('Can we find a new source?');
        expect(brief).toContain('Application / Observation / Reflection:');
        expect(brief).toContain('Recent Observations:');
        expect(brief).toContain('Recent Reflections:');
        expect(brief).toContain('Source Notes:');
        expect(brief).toContain('Chat Session 12');
        expect(brief).toContain('Saga Cycles:');

        expect(brief.indexOf('Overview:')).toBeGreaterThanOrEqual(0);
        expect(brief.indexOf('Current Compression:')).toBeGreaterThan(brief.indexOf('Overview:'));
        expect(brief.indexOf('Current Situation:')).toBeGreaterThan(brief.indexOf('Current Compression:'));
        expect(brief.indexOf('Open Pressure:')).toBeGreaterThan(brief.indexOf('Current Situation:'));
        expect(brief.indexOf('Application / Observation / Reflection:')).toBeGreaterThan(brief.indexOf('Open Pressure:'));
        expect(brief.indexOf('Recent Observations:')).toBeGreaterThan(brief.indexOf('Application / Observation / Reflection:'));
        expect(brief.indexOf('Recent Reflections:')).toBeGreaterThan(brief.indexOf('Recent Observations:'));
        expect(brief.indexOf('Source Notes:')).toBeGreaterThan(brief.indexOf('Recent Reflections:'));
    });
});
