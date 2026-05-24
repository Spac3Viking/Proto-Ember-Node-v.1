'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');

jest.mock('axios');

describe('Phase 17D — Sentinel Trials + Capability Checks', () => {
    let dataRoot;

    beforeEach(() => {
        jest.resetModules();
        dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-phase17d-test-'));
        process.env.EMBER_NODE_DATA_ROOT = dataRoot;
        delete process.env.EMBER_DATA_ROOT;
    });

    afterEach(() => {
        delete process.env.EMBER_NODE_DATA_ROOT;
        delete process.env.EMBER_DATA_ROOT;
        try { fs.rmSync(dataRoot, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    test('GET /api/system/sentinel-trials returns trial definitions + state', async () => {
        const { app } = require('../app/server');
        const res = await request(app).get('/api/system/sentinel-trials');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(Array.isArray(res.body.trials)).toBe(true);
        expect(res.body.trials.length).toBeGreaterThanOrEqual(5);
        expect(res.body.state).toHaveProperty('first_ember');
        expect(res.body.state).toHaveProperty('forge_reflection');
        expect(res.body.state).toHaveProperty('scribe_structuring');
        expect(res.body.state).toHaveProperty('distillation_trial');
        expect(res.body.state).toHaveProperty('transmission_trial');
    });

    test('POST /api/system/sentinel-trials/step persists completion state', async () => {
        const { app } = require('../app/server');
        const trialsPath = path.join(dataRoot, 'system', 'trials', 'sentinel-trials.json');

        const stepRes = await request(app)
            .post('/api/system/sentinel-trials/step')
            .send({ trialId: 'first_ember', stepId: 'spark_question' });

        expect(stepRes.status).toBe(200);
        expect(stepRes.body.success).toBe(true);
        expect(stepRes.body.state.first_ember.steps.spark_question.completed).toBe(true);
        expect(fs.existsSync(trialsPath)).toBe(true);
        const onDisk = JSON.parse(fs.readFileSync(trialsPath, 'utf8'));
        expect(onDisk.first_ember.steps.spark_question.completed).toBe(true);
    });

    test('trial auto-completes once all required steps are recorded', async () => {
        const { app } = require('../app/server');

        await request(app).post('/api/system/sentinel-trials/step').send({ trialId: 'first_ember', stepId: 'cache_loaded' });
        await request(app).post('/api/system/sentinel-trials/step').send({ trialId: 'first_ember', stepId: 'spark_question' });
        const final = await request(app).post('/api/system/sentinel-trials/step').send({ trialId: 'first_ember', stepId: 'signal_trace_opened' });

        expect(final.status).toBe(200);
        expect(final.body.success).toBe(true);
        expect(final.body.state.first_ember.completed).toBe(true);
        expect(typeof final.body.state.first_ember.completed_at).toBe('string');
    });

    test('POST /api/system/sentinel-trials/reset clears completion state', async () => {
        const { app } = require('../app/server');

        await request(app).post('/api/system/sentinel-trials/step').send({ trialId: 'first_ember', stepId: 'spark_question' });
        const reset = await request(app).post('/api/system/sentinel-trials/reset').send({});

        expect(reset.status).toBe(200);
        expect(reset.body.success).toBe(true);
        expect(reset.body.state.first_ember.completed).toBe(false);
        expect(reset.body.state.first_ember.steps.spark_question).toBeUndefined();
    });

    test('capability check can infer scribe structuring from filesystem', async () => {
        const { app } = require('../app/server');

        const inboxDir = path.join(dataRoot, 'threshold', 'inbox');
        fs.mkdirSync(inboxDir, { recursive: true });
        fs.writeFileSync(path.join(inboxDir, 'handoff.md'), '# Handoff\n', 'utf8');

        const draftsDir = path.join(dataRoot, 'threshold', 'cache-drafts', 'test-draft');
        fs.mkdirSync(draftsDir, { recursive: true });
        fs.writeFileSync(path.join(draftsDir, 'manifest.json'), JSON.stringify({ id: 'test-draft' }), 'utf8');

        const res = await request(app)
            .post('/api/system/sentinel-trials/check')
            .send({ trialId: 'scribe_structuring' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.ok).toBe(true);
    });
});

