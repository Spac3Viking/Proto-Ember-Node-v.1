'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

describe('Phase 11.9 — canonical data root finalization', () => {
    let dataRoot;

    beforeEach(() => {
        jest.resetModules();
        dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-p11-9-'));
        process.env.EMBER_NODE_DATA_ROOT = dataRoot;
        delete process.env.EMBER_DATA_ROOT;
    });

    afterEach(() => {
        delete process.env.EMBER_NODE_DATA_ROOT;
        delete process.env.EMBER_DATA_ROOT;
        try { fs.rmSync(dataRoot, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    test('migrateLegacyData returns retired no-op result', () => {
        const sc = require('../app/storageConfig');
        const result = sc.migrateLegacyData();
        expect(result.detected).toBe(false);
        expect(result.performed).toBe(false);
        expect(result.mode).toBe('retired');
    });

    test('seedDataRoot populates core archive scaffold on empty first run', () => {
        const sc = require('../app/storageConfig');
        sc.ensureDataRoot();
        const result = sc.seedDataRoot();
        expect(result.performed).toBe(true);
        expect(fs.existsSync(sc.CORE_ARCHIVE_MANIFEST_PATH)).toBe(true);
    });

    test('ensureCanonicalDataFiles creates baseline system files non-destructively', () => {
        const sc = require('../app/storageConfig');
        sc.ensureDataRoot();

        const customManifest = {
            id: 'custom-core',
            title: 'Custom Core',
            version: '9.9',
        };
        fs.writeFileSync(sc.CORE_ARCHIVE_MANIFEST_PATH, JSON.stringify(customManifest, null, 2), 'utf8');

        sc.ensureCanonicalDataFiles();

        expect(fs.existsSync(sc.INTAKE_STATE_PATH)).toBe(true);
        const manifestAfter = JSON.parse(fs.readFileSync(sc.CORE_ARCHIVE_MANIFEST_PATH, 'utf8'));
        expect(manifestAfter.id).toBe('custom-core');
    });
});
