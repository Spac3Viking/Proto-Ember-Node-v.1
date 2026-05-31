'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');

jest.mock('axios');

describe('Phase 17G — Living Thread workspace polish', () => {
    let dataRoot;

    beforeEach(() => {
        jest.resetModules();
        dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-phase17g-test-'));
        process.env.EMBER_NODE_DATA_ROOT = dataRoot;
        delete process.env.EMBER_DATA_ROOT;
    });

    afterEach(() => {
        delete process.env.EMBER_NODE_DATA_ROOT;
        delete process.env.EMBER_DATA_ROOT;
        try { fs.rmSync(dataRoot, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    test('workspace HTML includes Copy Brief and Source Notes', async () => {
        const { app } = require('../app/server');

        const res = await request(app).get('/index.html');
        expect(res.status).toBe(200);
        expect(res.text).toContain('id="signal-threads-overlay"');
        expect(res.text).toContain('id="signal-thread-copy-brief-btn"');
        expect(res.text).toContain('id="signal-thread-source-notes-input"');
    });
});

