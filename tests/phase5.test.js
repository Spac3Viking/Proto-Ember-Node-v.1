'use strict';

/**
 * Ember Node v.ᚠ — Phase 5 Tests
 *
 * Tests for: storageConfig (data root resolution, ensureDataRoot layout),
 * and the GET /api/storage-info server endpoint.
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
        expect(ROOM_DIRS.workshop).toBe(path.join(DATA_ROOT, 'workshop'));
        expect(ROOM_DIRS.threshold).toBe(path.join(DATA_ROOT, 'threshold'));
    });

    test('INDEXES_DIR is a sub-path of DATA_ROOT', () => {
        const { DATA_ROOT, INDEXES_DIR } = storageConfig;
        expect(INDEXES_DIR).toBe(path.join(DATA_ROOT, 'indexes'));
    });

    test('PROJECTS_DIR is a sub-path of DATA_ROOT', () => {
        const { DATA_ROOT, PROJECTS_DIR } = storageConfig;
        expect(PROJECTS_DIR).toBe(path.join(DATA_ROOT, 'projects'));
    });

    test('THREADS_DIR is a sub-path of DATA_ROOT', () => {
        const { DATA_ROOT, THREADS_DIR } = storageConfig;
        expect(THREADS_DIR).toBe(path.join(DATA_ROOT, 'threads'));
    });

    test('USER_CARTRIDGES_DIR is a sub-path of DATA_ROOT', () => {
        const { DATA_ROOT, USER_CARTRIDGES_DIR } = storageConfig;
        expect(USER_CARTRIDGES_DIR).toBe(path.join(DATA_ROOT, 'cartridges'));
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
            storageConfig.ROOM_DIRS.workshop,
            storageConfig.ROOM_DIRS.threshold,
            storageConfig.INDEXES_DIR,
            storageConfig.PROJECTS_DIR,
            storageConfig.THREADS_DIR,
            storageConfig.USER_CARTRIDGES_DIR,
            storageConfig.SYSTEM_DIR,
            storageConfig.EXPORTS_DIR,
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
        expect(dirs).toHaveProperty('workshop');
        expect(dirs).toHaveProperty('threshold');
        expect(dirs).toHaveProperty('indexes');
        expect(dirs).toHaveProperty('projects');
        expect(dirs).toHaveProperty('threads');
        expect(dirs).toHaveProperty('cartridges');
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
});
