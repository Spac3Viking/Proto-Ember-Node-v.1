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

    test('Fieldbook exposes the four destinations and its streamlined writing controls', async () => {
        const { app } = require('../app/server');

        const res = await request(app).get('/index.html');
        expect(res.status).toBe(200);
        expect(res.text).toContain('data-room="threads"');
        expect(res.text).toContain('data-room="resources"');
        expect(res.text).toContain('data-room="hearth"');
        expect(res.text).toContain('data-room="system"');
        expect(res.text).toContain('id="room-threads"');
        expect(res.text).toContain('id="system-workspace"');
        expect(res.text).not.toContain('secondary-room-nav');
        expect(res.text).not.toContain('data-room="session"');
        expect(res.text).not.toContain('data-room="threshold"');
        expect(res.text).toContain('id="signal-thread-field-log-input"');
        expect(res.text).toContain('id="signal-thread-add-field-log-btn"');
        expect(res.text).toContain('id="signal-thread-export-btn"');
        expect(res.text).toContain('data-thread-stage="relate"');
        expect(res.text).not.toContain('id="signal-thread-saga-cycle-details"');
        expect(res.text).not.toContain('id="signal-thread-copy-brief-btn"');
        expect(res.text).not.toContain('id="signal-thread-source-notes-input"');
    });
});
