'use strict';

/**
 * Ember Node v.ᚠ — Phase 5 Tests
 *
 * Tests for: storageConfig (data root resolution, ensureDataRoot layout,
 * legacy migration), cache ownership, and the GET /api/storage-info and
 * GET /api/status server endpoints.
 */

const fs      = require('fs');
const os      = require('os');
const path    = require('path');
const request = require('supertest');
const axios   = require('axios');

jest.mock('axios');

// ── storageConfig ─────────────────────────────────────────────────────────────

describe('storageConfig — default data root', () => {
    // Isolate module between tests so env changes take effect
    let storageConfig;

    beforeEach(() => {
        jest.resetModules();
        delete process.env.EMBER_DATA_ROOT;
        storageConfig = require('../app/storageConfig');
    });

    test('DATA_ROOT defaults to ~/.ember-node', () => {
        const expected = path.join(os.homedir(), '.ember-node');
        expect(storageConfig.DATA_ROOT).toBe(expected);
    });

    test('ROOM_DIRS are sub-paths of DATA_ROOT', () => {
        const { DATA_ROOT, ROOM_DIRS } = storageConfig;
        expect(ROOM_DIRS.hearth).toBe(path.join(DATA_ROOT, 'hearth'));
        expect(ROOM_DIRS.council).toBe(path.join(DATA_ROOT, 'council'));
        expect(ROOM_DIRS.threshold).toBe(path.join(DATA_ROOT, 'threshold'));
    });

    test('INDEXES_DIR is a sub-path of DATA_ROOT', () => {
        const { DATA_ROOT, INDEXES_DIR } = storageConfig;
        expect(INDEXES_DIR).toBe(path.join(DATA_ROOT, 'indexes'));
    });

    test('THREADS_DIR is a sub-path of DATA_ROOT', () => {
        const { DATA_ROOT, THREADS_DIR } = storageConfig;
        expect(THREADS_DIR).toBe(path.join(DATA_ROOT, 'threads'));
    });

    test('USER_CACHES_DIR is a sub-path of DATA_ROOT', () => {
        const { DATA_ROOT, USER_CACHES_DIR } = storageConfig;
        expect(USER_CACHES_DIR).toBe(path.join(DATA_ROOT, 'caches'));
    });
});

describe('storageConfig — EMBER_DATA_ROOT override', () => {
    let tmpDir;
    let storageConfig;

    beforeEach(() => {
        jest.resetModules();
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-storage-'));
        process.env.EMBER_DATA_ROOT = tmpDir;
        storageConfig = require('../app/storageConfig');
    });

    afterEach(() => {
        delete process.env.EMBER_DATA_ROOT;
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('DATA_ROOT equals the env var value', () => {
        expect(storageConfig.DATA_ROOT).toBe(path.resolve(tmpDir));
    });

    test('subdirectories are under the overridden root', () => {
        const { DATA_ROOT, INDEXES_DIR, ROOM_DIRS } = storageConfig;
        expect(INDEXES_DIR.startsWith(DATA_ROOT)).toBe(true);
        expect(ROOM_DIRS.hearth.startsWith(DATA_ROOT)).toBe(true);
    });
});

describe('storageConfig — ensureDataRoot', () => {
    let tmpDir;
    let storageConfig;

    beforeEach(() => {
        jest.resetModules();
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-ensure-'));
        // Use a nested path that doesn't exist yet
        process.env.EMBER_DATA_ROOT = path.join(tmpDir, 'node-data');
        storageConfig = require('../app/storageConfig');
    });

    afterEach(() => {
        delete process.env.EMBER_DATA_ROOT;
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('creates all required directories', () => {
        storageConfig.ensureDataRoot();

        const expected = [
            storageConfig.DATA_ROOT,
            storageConfig.ROOM_DIRS.hearth,
            storageConfig.ROOM_DIRS.council,
            storageConfig.ROOM_DIRS.threshold,
            storageConfig.INDEXES_DIR,
            storageConfig.THREADS_DIR,
            storageConfig.USER_CACHES_DIR,
            storageConfig.SYSTEM_DIR,
            storageConfig.EXPORTS_DIR,
            storageConfig.THRESHOLD_CACHE_DRAFTS_DIR,
        ];

        for (const dir of expected) {
            expect(fs.existsSync(dir)).toBe(true);
        }
    });

    test('calling ensureDataRoot twice does not throw', () => {
        expect(() => {
            storageConfig.ensureDataRoot();
            storageConfig.ensureDataRoot();
        }).not.toThrow();
    });
});

// ── storageConfig — LEGACY_DATA_DIR ──────────────────────────────────────────

describe('storageConfig — LEGACY_DATA_DIR', () => {
    test('LEGACY_DATA_DIR is exported', () => {
        jest.resetModules();
        delete process.env.EMBER_DATA_ROOT;
        const storageConfig = require('../app/storageConfig');
        expect(typeof storageConfig.LEGACY_DATA_DIR).toBe('string');
    });

    test('LEGACY_DATA_DIR points to the data/ subdirectory in the project root', () => {
        jest.resetModules();
        delete process.env.EMBER_DATA_ROOT;
        const storageConfig = require('../app/storageConfig');
        const sep = require('path').sep;
        expect(storageConfig.LEGACY_DATA_DIR.endsWith(sep + 'data')).toBe(true);
    });
});

// ── storageConfig — migrateLegacyData ────────────────────────────────────────

describe('storageConfig — migrateLegacyData', () => {
    let tmpRoot;
    let legacyDir;
    let storageConfig;

    beforeEach(() => {
        jest.resetModules();
        tmpRoot   = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-migrate-root-'));
        legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-migrate-legacy-'));
        process.env.EMBER_DATA_ROOT = tmpRoot;
        storageConfig = require('../app/storageConfig');
    });

    afterEach(() => {
        delete process.env.EMBER_DATA_ROOT;
        fs.rmSync(tmpRoot,   { recursive: true, force: true });
        fs.rmSync(legacyDir, { recursive: true, force: true });
    });

    test('migrateLegacyData is exported as a function', () => {
        expect(typeof storageConfig.migrateLegacyData).toBe('function');
    });

    test('returns retired no-op metadata', () => {
        fs.mkdirSync(path.join(legacyDir, 'council'), { recursive: true });
        fs.writeFileSync(path.join(legacyDir, 'council', 'note.md'), '# Legacy note\n');
        const result = storageConfig.migrateLegacyData(legacyDir);
        expect(result).toEqual({
            detected: false,
            performed: false,
            mode: 'retired',
            errors: [],
        });
    });

    test('retired migration is idempotent', () => {
        expect(() => {
            storageConfig.migrateLegacyData(legacyDir);
            storageConfig.migrateLegacyData(legacyDir);
        }).not.toThrow();
    });
});

// ── cacheLoader — ownership ───────────────────────────────────────────────

describe('cacheLoader — bundled cache ownership', () => {
    test('BUNDLED_CACHES_DIR is exported', () => {
        jest.resetModules();
        const loader = require('../app/cacheLoader');
        expect(typeof loader.BUNDLED_CACHES_DIR).toBe('string');
    });

    test('listCaches() returns entries with ownership: "bundled"', () => {
        jest.resetModules();
        const { listCaches } = require('../app/cacheLoader');
        const caches = listCaches();
        expect(caches.length).toBeGreaterThan(0);
        for (const c of caches) {
            expect(c.ownership).toBe('bundled');
        }
    });
});

// ── GET /api/storage-info ─────────────────────────────────────────────────────

describe('GET /api/storage-info', () => {
    let app;

    beforeAll(() => {
        jest.resetModules();
        // Ensure a predictable data root for the server under test
        const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-srv-'));
        process.env.EMBER_DATA_ROOT = tmpRoot;
        app = require('../app/server').app;
    });

    afterAll(() => {
        delete process.env.EMBER_DATA_ROOT;
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('returns 200 with dataRoot and directories keys', async () => {
        const res = await request(app).get('/api/storage-info');
        expect(res.status).toBe(200);
        expect(typeof res.body.dataRoot).toBe('string');
        expect(res.body.configuredBy).toBe('EMBER_DATA_ROOT');
        expect(typeof res.body.directories).toBe('object');
    });

    test('directories contains expected room keys', async () => {
        const res = await request(app).get('/api/storage-info');
        const dirs = res.body.directories;
        expect(dirs).toHaveProperty('hearth');
        expect(dirs).toHaveProperty('council');
        expect(dirs).toHaveProperty('threshold');
        expect(dirs).toHaveProperty('indexes');
        expect(dirs).toHaveProperty('threads');
        expect(dirs).toHaveProperty('caches');
        expect(dirs).toHaveProperty('system');
        expect(dirs).toHaveProperty('exports');
    });

    test('dataRoot is reflected in directory paths', async () => {
        const res = await request(app).get('/api/storage-info');
        const { dataRoot, directories } = res.body;
        for (const dir of Object.values(directories)) {
            expect(dir.startsWith(dataRoot)).toBe(true);
        }
    });

    test('response includes migration object with required fields', async () => {
        const res = await request(app).get('/api/storage-info');
        expect(res.body).toHaveProperty('migration');
        const { migration } = res.body;
        expect(typeof migration.detected).toBe('boolean');
        expect(typeof migration.performed).toBe('boolean');
        expect(typeof migration.mode).toBe('string');
        expect(Array.isArray(migration.errors)).toBe(true);
    });

    test('response includes caches ownership summary', async () => {
        const res = await request(app).get('/api/storage-info');
        expect(res.body).toHaveProperty('caches');
        expect(typeof res.body.caches.bundled).toBe('number');
        expect(typeof res.body.caches.user).toBe('number');
        expect(res.body.caches.bundled).toBeGreaterThan(0);
    });
});

// ── GET /api/status — storage and cache fields ───────────────────────────

describe('GET /api/status — Phase 5 fields', () => {
    let app;

    beforeAll(() => {
        jest.resetModules();
        const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-status-'));
        process.env.EMBER_DATA_ROOT = tmpRoot;
        app = require('../app/server').app;
    });

    afterAll(() => {
        delete process.env.EMBER_DATA_ROOT;
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('returns storageRoot field', async () => {
        const res = await request(app).get('/api/status');
        expect(res.status).toBe(200);
        expect(typeof res.body.storageRoot).toBe('string');
    });

    test('returns storageRootSource field', async () => {
        const res = await request(app).get('/api/status');
        expect(res.body.storageRootSource).toBe('EMBER_DATA_ROOT');
    });

    test('returns caches breakdown with bundled and user counts', async () => {
        const res = await request(app).get('/api/status');
        expect(res.body).toHaveProperty('caches');
        expect(typeof res.body.caches.bundled).toBe('number');
        expect(typeof res.body.caches.user).toBe('number');
        expect(res.body.caches.bundled).toBeGreaterThan(0);
    });

    test('cacheCount is still present for backward compatibility', async () => {
        const res = await request(app).get('/api/status');
        expect(typeof res.body.cacheCount).toBe('number');
        expect(res.body.cacheCount).toBe(res.body.caches.bundled);
    });
});
