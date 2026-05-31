'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');

jest.mock('axios');

describe('Phase 17F — Saga Smith ignition layer', () => {
    let dataRoot;

    beforeEach(() => {
        jest.resetModules();
        dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-phase17f-test-'));
        process.env.EMBER_NODE_DATA_ROOT = dataRoot;
        delete process.env.EMBER_DATA_ROOT;
    });

    afterEach(() => {
        delete process.env.EMBER_NODE_DATA_ROOT;
        delete process.env.EMBER_DATA_ROOT;
        try { fs.rmSync(dataRoot, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    test('cycle save appends observation/reflection and updates compression', async () => {
        const { app } = require('../app/server');

        const create = await request(app)
            .post('/api/signal-threads')
            .send({ title: 'Continuity Vessel', posture: 'exploratory', summary: '' });
        expect(create.status).toBe(200);
        const threadId = create.body.thread.id;

        const cycle = await request(app)
            .post('/api/signal-threads/' + encodeURIComponent(threadId) + '/saga-cycle')
            .send({
                mode: 'real',
                situation: 'A difficult conversation is approaching.',
                application: 'I practiced naming the constraint without blame.',
                observation: 'The tone softened after I stated the boundary clearly.',
                reflection: 'Clarity reduced defensiveness. I need to repeat this calmly.',
                compression: 'Name constraints early; keep tone steady; watch for softening.',
            });

        expect(cycle.status).toBe(200);
        expect(cycle.body.success).toBe(true);
        expect(cycle.body.thread).toBeTruthy();
        expect(cycle.body.observation).toBeTruthy();
        expect(cycle.body.reflection).toBeTruthy();

        const fetched = await request(app).get('/api/signal-threads/' + encodeURIComponent(threadId));
        expect(fetched.status).toBe(200);
        expect(fetched.body.thread.observations.length).toBe(1);
        expect(fetched.body.thread.reflections.length).toBe(1);
        expect(fetched.body.thread.compression).toBe('Name constraints early; keep tone steady; watch for softening.');

        const obsText = fetched.body.thread.observations[0].content;
        const reflText = fetched.body.thread.reflections[0].content;
        expect(obsText).toContain('Saga Smith — Cycle');
        expect(obsText).toContain('Mode: real');
        expect(obsText).toContain('Situation');
        expect(obsText).toContain('Application');
        expect(obsText).toContain('Observation');
        expect(reflText).toContain('Saga Smith — Reflection');
        expect(reflText).toContain('Mode: real');
        expect(reflText).toContain('Reflection');

        const exportRes = await request(app).get('/api/signal-threads/' + encodeURIComponent(threadId) + '/export');
        expect(exportRes.status).toBe(200);
        expect(exportRes.text).toContain('## Application / Observation / Reflection');
        expect(exportRes.text).toContain('Application');
        expect(exportRes.text).toContain('I practiced naming the constraint without blame.');
        expect(exportRes.text).toContain('Observation');
        expect(exportRes.text).toContain('The tone softened after I stated the boundary clearly.');
        expect(exportRes.text).toContain('Reflection');
        expect(exportRes.text).toContain('Clarity reduced defensiveness. I need to repeat this calmly.');
        expect(exportRes.text).toContain('## Recent Observations');
        expect(exportRes.text).toContain('Saga Smith — Cycle');
        expect(exportRes.text).toContain('## Recent Reflections');
        expect(exportRes.text).toContain('Saga Smith — Reflection');
    });

    test('exploratory/real mode is accepted', async () => {
        const { app } = require('../app/server');

        const create = await request(app)
            .post('/api/signal-threads')
            .send({ title: 'Mode Check', posture: 'exploratory', summary: '' });
        const threadId = create.body.thread.id;

        const exploratory = await request(app)
            .post('/api/signal-threads/' + encodeURIComponent(threadId) + '/saga-cycle')
            .send({
                mode: 'exploratory',
                observation: 'A simulated run revealed a blind spot.',
                reflection: 'The imagined pressure still exposed hesitation.',
                compression: '',
            });
        expect(exploratory.status).toBe(200);

        const real = await request(app)
            .post('/api/signal-threads/' + encodeURIComponent(threadId) + '/saga-cycle')
            .send({
                mode: 'real',
                observation: 'A real attempt produced measurable change.',
                reflection: 'Embodiment clarified what was abstract.',
                compression: '',
            });
        expect(real.status).toBe(200);

        const fetched = await request(app).get('/api/signal-threads/' + encodeURIComponent(threadId));
        expect(fetched.body.thread.observations.length).toBe(2);
        expect(fetched.body.thread.reflections.length).toBe(2);
        expect(fetched.body.thread.observations.map(o => o.content).join('\n')).toContain('Mode: exploratory');
        expect(fetched.body.thread.observations.map(o => o.content).join('\n')).toContain('Mode: real');
    });
});
