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

    afterEach(() => {
        try {
            const sc = require('../app/storageConfig');
            let baseline = { interactions: [] };
            if (fs.existsSync(sc.CACHE_INTERACTIONS_PATH)) {
                baseline = JSON.parse(fs.readFileSync(sc.CACHE_INTERACTIONS_PATH, 'utf8'));
            }
            baseline.interactions = [];
            baseline.updated_at = null;
            fs.mkdirSync(path.dirname(sc.CACHE_INTERACTIONS_PATH), { recursive: true });
            fs.writeFileSync(sc.CACHE_INTERACTIONS_PATH, JSON.stringify(baseline, null, 2), 'utf8');
            if (sc.EQUIPPED_CACHES_PATH) {
                fs.writeFileSync(sc.EQUIPPED_CACHES_PATH, JSON.stringify({
                    version: '0.1.0',
                    updated_at: null,
                    equipped: [],
                }, null, 2), 'utf8');
            }
        } catch { /* ignore cleanup issues in tests */ }
    });

    test('storageConfig exposes and seeds rolling-bootstrap.json', () => {
        const sc = require('../app/storageConfig');
        sc.ensureDataRoot();
        sc.ensureCanonicalDataFiles();

        expect(sc.ROLLING_BOOTSTRAP_PATH).toBe(path.join(sc.DATA_ROOT, 'system', 'memory', 'rolling-bootstrap.json'));
        expect(sc.CACHE_INTERACTIONS_PATH).toBe(path.join(sc.DATA_ROOT, 'system', 'memory', 'cache-interactions.json'));
        expect(sc.EQUIPPED_CACHES_PATH).toBe(path.join(sc.DATA_ROOT, 'system', 'memory', 'equipped-caches.json'));
        expect(fs.existsSync(sc.ROLLING_BOOTSTRAP_PATH)).toBe(true);
        expect(fs.existsSync(sc.CACHE_INTERACTIONS_PATH)).toBe(true);
        expect(fs.existsSync(sc.EQUIPPED_CACHES_PATH)).toBe(true);

        const seeded = JSON.parse(fs.readFileSync(sc.ROLLING_BOOTSTRAP_PATH, 'utf8'));
        const equipped = JSON.parse(fs.readFileSync(sc.EQUIPPED_CACHES_PATH, 'utf8'));
        expect(seeded.version).toBe('0.1.0');
        expect(seeded.place_memory).toEqual({ enabled: false, notes: [] });
        expect(seeded.cache_memory).toEqual({ summary: '', recent: [] });
        expect(equipped.version).toBe('0.1.0');
        expect(Array.isArray(equipped.equipped)).toBe(true);
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

    test('rolling bootstrap includes cache interaction memory summaries', () => {
        const cacheMemory = require('../app/cacheInteractionMemory');
        const bootstrap = require('../app/bootstrap');
        const equippedCaches = require('../app/equippedCaches');
        const installed = equippedCaches.listInstalledCaches();
        if (installed[0]) {
            equippedCaches.equipCache(installed[0]);
        }

        cacheMemory.recordCacheInteraction({
            kind: 'cache_draft_created',
            draftId: 'phase-16h-d-memory-draft',
            sourcePaths: ['threshold/inbox/memory-source.md'],
        });
        cacheMemory.recordCacheInteraction({
            kind: 'threshold_handoff_viewed',
            sourcePaths: ['threshold/inbox/memory-source.md'],
            handoffType: 'research-brief',
            handoffStatus: 'reviewed',
        });

        const rb = bootstrap.refreshRollingBootstrap({});
        expect(rb.cache_memory).toBeDefined();
        expect(typeof rb.cache_memory.summary).toBe('string');
        expect(rb.cache_memory.summary).toMatch(/cache draft|handoff/i);
        expect(Array.isArray(rb.cache_memory.recent)).toBe(true);
        expect(rb.cache_memory.recent.length).toBeGreaterThan(0);
        expect(Array.isArray(rb.equipped_caches)).toBe(true);
        expect(rb.equipped_caches.length).toBeGreaterThan(0);
    });
});
