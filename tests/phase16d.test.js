'use strict';

const request = require('supertest');
const fs = require('fs');
const os = require('os');
const path = require('path');

describe('Phase 16D — Rolling Bootstrap + Context Memory', () => {
    const DATA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-p16d-'));

    beforeAll(() => {
        process.env.EMBER_NODE_DATA_ROOT = DATA_ROOT;
        delete process.env.EMBER_DATA_ROOT;
        jest.resetModules();
    });

    afterAll(() => {
        delete process.env.EMBER_NODE_DATA_ROOT;
        delete process.env.EMBER_DATA_ROOT;
        try { fs.rmSync(DATA_ROOT, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    test('storageConfig exposes and seeds rolling-bootstrap.json', () => {
        const sc = require('../app/storageConfig');
        sc.ensureDataRoot();
        sc.ensureCanonicalDataFiles();

        expect(sc.ROLLING_BOOTSTRAP_PATH).toBe(path.join(sc.DATA_ROOT, 'system', 'memory', 'rolling-bootstrap.json'));
        expect(fs.existsSync(sc.ROLLING_BOOTSTRAP_PATH)).toBe(true);

        const seeded = JSON.parse(fs.readFileSync(sc.ROLLING_BOOTSTRAP_PATH, 'utf8'));
        expect(seeded.version).toBe('0.1.0');
        expect(seeded.place_memory).toEqual({ enabled: false, notes: [] });
    });

    test('refreshRollingBootstrap writes continuity summary and status', () => {
        const bootstrap = require('../app/bootstrap');
        const rb = bootstrap.refreshRollingBootstrap({
            recentDecisions: ['Keep archive caches untouched'],
            openQuestions: ['Which themes should stay in top continuity window?'],
        });
        expect(rb).toBeDefined();
        expect(typeof rb.summary).toBe('string');
        expect(Array.isArray(rb.active_themes)).toBe(true);
        expect(Array.isArray(rb.source_threads)).toBe(true);
        expect(rb.place_memory).toEqual({ enabled: false, notes: [] });

        const loaded = bootstrap.loadRollingBootstrap();
        expect(loaded).toBeDefined();
        expect(loaded.updated_at).toBeDefined();

        const status = bootstrap.getRollingBootstrapStatus();
        expect(status.status).toBe('ready');
        expect(typeof status.activeThemesCount).toBe('number');
        expect(typeof status.openQuestionsCount).toBe('number');
    });

    test('bootstrap routes expose rolling bootstrap refresh + json access', async () => {
        jest.resetModules();
        process.env.EMBER_NODE_DATA_ROOT = DATA_ROOT;
        const { app } = require('../app/server');

        const refreshRes = await request(app).post('/api/bootstrap/refresh').send({});
        expect(refreshRes.status).toBe(200);
        expect(refreshRes.body.success).toBe(true);
        expect(refreshRes.body.rollingBootstrap).toBeDefined();

        const rollingRes = await request(app).get('/api/bootstrap/rolling');
        expect(rollingRes.status).toBe(200);
        expect(rollingRes.body.rollingBootstrap).toBeDefined();
    });
});
