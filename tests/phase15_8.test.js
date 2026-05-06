'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

describe('Phase 15.8 — Ember Prime + Ember Court restructure', () => {
    let dataRoot;

    beforeEach(() => {
        jest.resetModules();
        dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-p15-8-'));
        process.env.EMBER_NODE_DATA_ROOT = dataRoot;
        delete process.env.EMBER_DATA_ROOT;
    });

    afterEach(() => {
        delete process.env.EMBER_NODE_DATA_ROOT;
        delete process.env.EMBER_DATA_ROOT;
        try { fs.rmSync(dataRoot, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    test('seeds an editable runtime Ember Court config and loads defaults', () => {
        const sc = require('../app/storageConfig');
        sc.ensureDataRoot();

        const {
            RUNTIME_COURT_CONFIG_PATH,
            ensureCourtConfig,
            loadCourtConfig,
            getCourtMember,
        } = require('../app/courtConfig');

        ensureCourtConfig();
        expect(fs.existsSync(RUNTIME_COURT_CONFIG_PATH)).toBe(true);

        const court = loadCourtConfig();
        expect(court).toBeTruthy();
        expect(court.courtName).toBe('Ember Court');
        expect(court.defaultMember).toBe('scribe');
        expect(Array.isArray(court.members)).toBe(true);
        expect(court.members.map(m => m.id)).toEqual(
            expect.arrayContaining(['builder', 'warrior', 'scholar', 'scribe', 'mystic']),
        );

        const scholar = getCourtMember('scholar');
        expect(scholar).toBeTruthy();
        expect(scholar.id).toBe('scholar');
        expect(scholar.retrieval.topK).toBeGreaterThan(0);
    });
});
