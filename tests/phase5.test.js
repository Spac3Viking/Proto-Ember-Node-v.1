'use strict';

/**
 * Ember Node v.ᚠ — Phase 5 Tests
 *
 * Tests for: storageConfig (data root resolution, ensureDataRoot layout,
 * legacy migration), cartridge ownership, and the GET /api/storage-info and
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
        expect(storageConfig.LEGACY_DATA_DIR).toMatch(/[/\\]data$/);
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

    test('returns detected=false when legacy dir has no real content', () => {
        // Write only a .gitkeep (placeholder) — should be ignored
        fs.writeFileSync(path.join(legacyDir, '.gitkeep'), '');

        const result = storageConfig.migrateLegacyData(legacyDir);
        expect(result.detected).toBe(false);
        expect(result.performed).toBe(false);
        expect(result.mode).toBe('skipped');
    });

    test('copies legacy files into data root when data root is empty', () => {
        // Set up a fake legacy directory with real files
        const workshopDir = path.join(legacyDir, 'workshop');
        fs.mkdirSync(workshopDir, { recursive: true });
        fs.writeFileSync(path.join(workshopDir, 'note.md'), '# Legacy note\n');

        const result = storageConfig.migrateLegacyData(legacyDir);
        expect(result.detected).toBe(true);
        expect(result.performed).toBe(true);
        expect(result.mode).toBe('copy');
        expect(result.errors).toHaveLength(0);

        // Verify the file was copied
        const destFile = path.join(tmpRoot, 'workshop', 'note.md');
        expect(fs.existsSync(destFile)).toBe(true);
        expect(fs.readFileSync(destFile, 'utf8')).toContain('Legacy note');
    });

    test('skips migration when data root already has content', () => {
        // Set up legacy dir with content
        const workshopDir = path.join(legacyDir, 'workshop');
        fs.mkdirSync(workshopDir, { recursive: true });
        fs.writeFileSync(path.join(workshopDir, 'note.md'), '# Legacy note\n');

        // Put existing content in the data root
        const existingFile = path.join(tmpRoot, 'hearth', 'existing.md');
        fs.mkdirSync(path.dirname(existingFile), { recursive: true });
        fs.writeFileSync(existingFile, '# Already here\n');

        const result = storageConfig.migrateLegacyData(legacyDir);
        expect(result.detected).toBe(true);
        expect(result.performed).toBe(false);
        expect(result.mode).toBe('skipped');
    });

    test('does not overwrite existing files in the data root (non-destructive)', () => {
        // Existing file in data root
        const destFile = path.join(tmpRoot, 'workshop', 'note.md');
        fs.mkdirSync(path.dirname(destFile), { recursive: true });
        fs.writeFileSync(destFile, '# Already here\n');

        // Legacy file with same path but different content
        const workshopDir = path.join(legacyDir, 'workshop');
        fs.mkdirSync(workshopDir, { recursive: true });
        fs.writeFileSync(path.join(workshopDir, 'note.md'), '# Legacy version\n');

        // Add a second file so both dirs have content; data root has content so
        // migration will be skipped (non-destructive by design)
        const result = storageConfig.migrateLegacyData(legacyDir);
        expect(result.performed).toBe(false);

        // Original content preserved
        expect(fs.readFileSync(destFile, 'utf8')).toBe('# Already here\n');
    });

    test('when data root is empty, does not overwrite individual files that already exist', () => {
        // Put ONE file directly in the data root (but in a different subdir)
        // so the root itself is non-empty — migration will be skipped
        const hearthDir = path.join(tmpRoot, 'hearth');
        fs.mkdirSync(hearthDir, { recursive: true });
        fs.writeFileSync(path.join(hearthDir, 'pre-existing.md'), '# Pre-existing\n');

        // Add the same filename under legacy workshop
        const workshopDir = path.join(legacyDir, 'workshop');
        fs.mkdirSync(workshopDir, { recursive: true });
        fs.writeFileSync(path.join(workshopDir, 'note.md'), '# Legacy note\n');

        // Data root already has content — migration skipped
        const result = storageConfig.migrateLegacyData(legacyDir);
        expect(result.performed).toBe(false);
    });

    test('migration is idempotent — calling twice does not throw', () => {
        const workshopDir = path.join(legacyDir, 'workshop');
        fs.mkdirSync(workshopDir, { recursive: true });
        fs.writeFileSync(path.join(workshopDir, 'note.md'), '# Legacy note\n');

        expect(() => {
            storageConfig.migrateLegacyData(legacyDir);
            storageConfig.migrateLegacyData(legacyDir); // second call should be a no-op
        }).not.toThrow();
    });
});

// ── cartridgeLoader — ownership ───────────────────────────────────────────────

describe('cartridgeLoader — bundled cartridge ownership', () => {
    test('BUNDLED_CARTRIDGES_DIR is exported', () => {
        jest.resetModules();
        const loader = require('../app/cartridgeLoader');
        expect(typeof loader.BUNDLED_CARTRIDGES_DIR).toBe('string');
    });

    test('CARTRIDGES_DIR is still exported as a backward-compatible alias', () => {
        jest.resetModules();
        const loader = require('../app/cartridgeLoader');
        expect(loader.CARTRIDGES_DIR).toBe(loader.BUNDLED_CARTRIDGES_DIR);
    });

    test('listCartridges() returns entries with ownership: "bundled"', () => {
        jest.resetModules();
        const { listCartridges } = require('../app/cartridgeLoader');
        const cartridges = listCartridges();
        expect(cartridges.length).toBeGreaterThan(0);
        for (const c of cartridges) {
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

    test('response includes migration object with required fields', async () => {
        const res = await request(app).get('/api/storage-info');
        expect(res.body).toHaveProperty('migration');
        const { migration } = res.body;
        expect(typeof migration.detected).toBe('boolean');
        expect(typeof migration.performed).toBe('boolean');
        expect(typeof migration.mode).toBe('string');
        expect(Array.isArray(migration.errors)).toBe(true);
    });

    test('response includes cartridges ownership summary', async () => {
        const res = await request(app).get('/api/storage-info');
        expect(res.body).toHaveProperty('cartridges');
        expect(typeof res.body.cartridges.bundled).toBe('number');
        expect(typeof res.body.cartridges.user).toBe('number');
        expect(res.body.cartridges.bundled).toBeGreaterThan(0);
    });
});

// ── GET /api/status — storage and cartridge fields ───────────────────────────

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

    test('returns cartridges breakdown with bundled and user counts', async () => {
        const res = await request(app).get('/api/status');
        expect(res.body).toHaveProperty('cartridges');
        expect(typeof res.body.cartridges.bundled).toBe('number');
        expect(typeof res.body.cartridges.user).toBe('number');
        expect(res.body.cartridges.bundled).toBeGreaterThan(0);
    });

    test('cartridgeCount is still present for backward compatibility', async () => {
        const res = await request(app).get('/api/status');
        expect(typeof res.body.cartridgeCount).toBe('number');
        expect(res.body.cartridgeCount).toBe(res.body.cartridges.bundled);
    });
});
