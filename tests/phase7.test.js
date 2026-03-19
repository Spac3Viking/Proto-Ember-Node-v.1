/**
 * Phase 7: Tool Registry API tests
 *
 * Tests the tool discovery, trust, role assignment, and Heart selection API.
 */

'use strict';

const path    = require('path');
const fs      = require('fs');
const os      = require('os');
const request = require('supertest');

// Use a temp directory so tests don't pollute the real data root
const tmpDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-tools-test-'));
process.env.EMBER_DATA_ROOT = tmpDataRoot;

// Must require AFTER setting the env var
const { app, loadToolRegistry, saveToolRegistry } = require('../app/server');

afterAll(() => {
    // Clean up temp directory
    try { fs.rmSync(tmpDataRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});

/* ─── GET /api/tools ─────────────────────────────────────────── */

describe('GET /api/tools', () => {
    test('returns empty registry on first call', async () => {
        const res = await request(app).get('/api/tools');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.tools)).toBe(true);
        expect(res.body.active).toBeDefined();
    });

    test('returns tools from registry when populated', async () => {
        saveToolRegistry({
            tools: [
                { id: 'ollama-local', name: 'Ollama', type: 'model_host', interface: 'http',
                  endpoint: 'http://localhost:11434', status: 'detected', trusted: false, role: null, lastSeen: null },
            ],
            active: {},
        });

        const res = await request(app).get('/api/tools');
        expect(res.status).toBe(200);
        expect(res.body.tools).toHaveLength(1);
        expect(res.body.tools[0].id).toBe('ollama-local');
    });
});

/* ─── POST /api/tools/:id/trust ──────────────────────────────── */

describe('POST /api/tools/:id/trust', () => {
    beforeEach(() => {
        saveToolRegistry({
            tools: [
                { id: 'ollama-local', name: 'Ollama', type: 'model_host', interface: 'http',
                  endpoint: 'http://localhost:11434', status: 'detected', trusted: false, role: null, lastSeen: null },
            ],
            active: {},
        });
    });

    test('trusts a detected tool', async () => {
        const res = await request(app)
            .post('/api/tools/ollama-local/trust')
            .send({ trusted: true });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.tool.trusted).toBe(true);

        const registry = loadToolRegistry();
        expect(registry.tools[0].trusted).toBe(true);
    });

    test('revokes trust for a trusted tool', async () => {
        // First trust it
        saveToolRegistry({
            tools: [{ id: 'ollama-local', name: 'Ollama', trusted: true, role: 'mirror', status: 'detected' }],
            active: { heart: 'ollama-local' },
        });

        const res = await request(app)
            .post('/api/tools/ollama-local/trust')
            .send({ trusted: false });

        expect(res.status).toBe(200);
        expect(res.body.tool.trusted).toBe(false);
        expect(res.body.tool.role).toBeNull();

        // Heart assignment should also be cleared
        const registry = loadToolRegistry();
        expect(registry.active.heart).toBeUndefined();
    });

    test('returns 404 for unknown tool', async () => {
        const res = await request(app)
            .post('/api/tools/unknown-tool/trust')
            .send({ trusted: true });
        expect(res.status).toBe(404);
    });
});

/* ─── POST /api/tools/:id/role ───────────────────────────────── */

describe('POST /api/tools/:id/role', () => {
    beforeEach(() => {
        saveToolRegistry({
            tools: [
                { id: 'ollama-local', name: 'Ollama', trusted: true, role: null, status: 'detected' },
            ],
            active: {},
        });
    });

    test('assigns mirror role to trusted tool', async () => {
        const res = await request(app)
            .post('/api/tools/ollama-local/role')
            .send({ role: 'mirror' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.tool.role).toBe('mirror');
    });

    test('assigns forge role to trusted tool', async () => {
        const res = await request(app)
            .post('/api/tools/ollama-local/role')
            .send({ role: 'forge' });
        expect(res.status).toBe(200);
        expect(res.body.tool.role).toBe('forge');
    });

    test('clears role when set to null', async () => {
        const res = await request(app)
            .post('/api/tools/ollama-local/role')
            .send({ role: null });
        expect(res.status).toBe(200);
        expect(res.body.tool.role).toBeNull();
    });

    test('rejects invalid role', async () => {
        const res = await request(app)
            .post('/api/tools/ollama-local/role')
            .send({ role: 'invalid' });
        expect(res.status).toBe(400);
    });

    test('rejects role assignment for untrusted tool', async () => {
        saveToolRegistry({
            tools: [{ id: 'ollama-local', name: 'Ollama', trusted: false, role: null, status: 'detected' }],
            active: {},
        });
        const res = await request(app)
            .post('/api/tools/ollama-local/role')
            .send({ role: 'mirror' });
        expect(res.status).toBe(400);
    });
});

/* ─── GET /api/tools/active ──────────────────────────────────── */

describe('GET /api/tools/active', () => {
    test('returns empty active config when nothing is set', async () => {
        saveToolRegistry({ tools: [], active: {} });
        const res = await request(app).get('/api/tools/active');
        expect(res.status).toBe(200);
        expect(res.body.active).toBeDefined();
    });

    test('returns active heart when set', async () => {
        saveToolRegistry({
            tools: [{ id: 'ollama-local', name: 'Ollama', trusted: true, role: null, status: 'detected' }],
            active: { heart: 'ollama-local' },
        });
        const res = await request(app).get('/api/tools/active');
        expect(res.status).toBe(200);
        expect(res.body.active.heart).toBe('ollama-local');
    });
});

/* ─── POST /api/tools/active ─────────────────────────────────── */

describe('POST /api/tools/active', () => {
    beforeEach(() => {
        saveToolRegistry({
            tools: [
                { id: 'ollama-local', name: 'Ollama', trusted: true, role: null, status: 'detected' },
            ],
            active: {},
        });
    });

    test('sets active heart', async () => {
        const res = await request(app)
            .post('/api/tools/active')
            .send({ heart: 'ollama-local' });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.active.heart).toBe('ollama-local');
    });

    test('clears heart when set to null', async () => {
        saveToolRegistry({
            tools: [{ id: 'ollama-local', name: 'Ollama', trusted: true, role: null, status: 'detected' }],
            active: { heart: 'ollama-local' },
        });
        const res = await request(app)
            .post('/api/tools/active')
            .send({ heart: null });
        expect(res.status).toBe(200);
        expect(res.body.active.heart).toBeUndefined();
    });

    test('returns 404 for unknown tool', async () => {
        const res = await request(app)
            .post('/api/tools/active')
            .send({ heart: 'unknown-tool' });
        expect(res.status).toBe(404);
    });

    test('rejects untrusted tool as heart', async () => {
        saveToolRegistry({
            tools: [{ id: 'ollama-local', name: 'Ollama', trusted: false, role: null, status: 'detected' }],
            active: {},
        });
        const res = await request(app)
            .post('/api/tools/active')
            .send({ heart: 'ollama-local' });
        expect(res.status).toBe(400);
    });
});

/* ─── POST /api/tools/scan ───────────────────────────────────── */

describe('POST /api/tools/scan', () => {
    test('returns tools array and active config', async () => {
        const res = await request(app).post('/api/tools/scan');
        // Scan will work regardless of whether Ollama is available
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(Array.isArray(res.body.tools)).toBe(true);
        expect(res.body.active).toBeDefined();
    });

    test('never auto-trusts discovered tools', async () => {
        await request(app).post('/api/tools/scan');
        const registry = loadToolRegistry();
        registry.tools.forEach(t => {
            expect(t.trusted).toBe(false);
        });
    });
});
