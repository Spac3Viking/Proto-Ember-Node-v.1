'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');

describe('Phase 17A — Runtime Tuning Bench', () => {
    let dataRoot;

    beforeEach(() => {
        jest.resetModules();
        dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-p17a-'));
        process.env.EMBER_NODE_DATA_ROOT = dataRoot;
        delete process.env.EMBER_DATA_ROOT;
    });

    afterEach(() => {
        delete process.env.EMBER_NODE_DATA_ROOT;
        delete process.env.EMBER_DATA_ROOT;
        try { fs.rmSync(dataRoot, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    test('storage config seeds runtime tuning runs history file', () => {
        const sc = require('../app/storageConfig');
        sc.ensureDataRoot();
        sc.ensureCanonicalDataFiles();

        expect(fs.existsSync(sc.RUNTIME_TUNING_RUNS_PATH)).toBe(true);
        const payload = JSON.parse(fs.readFileSync(sc.RUNTIME_TUNING_RUNS_PATH, 'utf8'));
        expect(payload.version).toBe('0.1.0');
        expect(Array.isArray(payload.runs)).toBe(true);
        expect(payload.runs).toHaveLength(0);
    });

    test('runtime tuning history endpoint stores metadata and caps at last 20 runs', async () => {
        const { app } = require('../app/server');
        const sc = require('../app/storageConfig');

        for (let i = 0; i < 22; i++) {
            const res = await request(app)
                .post('/api/system/tuning/runtime-runs')
                .send({
                    run: {
                        id: 'run-' + i,
                        created: new Date(2026, 0, 1, 0, i, 0).toISOString(),
                        prompt: 'Prompt ' + i,
                        settings: {
                            responseDepth: 'ember',
                            runtimeProfile: 'balanced-ember',
                            loadoutFocus: i % 2 === 0,
                            archetype: 'ember-prime',
                        },
                        metrics: {
                            responseTimeMs: 100 + i,
                            responseLength: 80 + i,
                            rawChunksUsed: i % 5,
                            summariesUsed: i % 3,
                            loadedCacheCount: 2,
                        },
                        responsePreview: 'Response preview ' + i,
                    },
                });
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        }

        const fetchRes = await request(app).get('/api/system/tuning/runtime-runs');
        expect(fetchRes.status).toBe(200);
        expect(fetchRes.body.success).toBe(true);
        expect(fetchRes.body.maxRuns).toBe(20);
        expect(Array.isArray(fetchRes.body.runs)).toBe(true);
        expect(fetchRes.body.runs).toHaveLength(20);
        expect(fetchRes.body.runs[0].id).toBe('run-21');
        expect(fetchRes.body.runs[19].id).toBe('run-2');

        expect(fs.existsSync(sc.RUNTIME_TUNING_RUNS_PATH)).toBe(true);
        const stored = JSON.parse(fs.readFileSync(sc.RUNTIME_TUNING_RUNS_PATH, 'utf8'));
        expect(Array.isArray(stored.runs)).toBe(true);
        expect(stored.runs).toHaveLength(20);
    });
});
