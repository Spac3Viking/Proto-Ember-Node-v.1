'use strict';

/**
 * Phase 20A / build v118 — Runtime configuration and canonical status
 * reporting regression tests.
 *
 * Covers:
 *   - app/runtimeConfig.js as the single canonical source for host/port/
 *     Ollama base URL/health timeout (with env var overrides).
 *   - GET /api/status returning a stable, documented shape that
 *     distinguishes Ember Node server availability from AI runtime
 *     reachability and model availability — regardless of whether Ollama
 *     is reachable.
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const request = require('supertest');

jest.mock('axios');

describe('app/runtimeConfig — canonical runtime configuration', () => {
    const ENV_KEYS = [
        'EMBER_NODE_HOST', 'EMBER_NODE_PORT', 'OLLAMA_BASE_URL',
        'EMBER_OLLAMA_TIMEOUT_MS', 'EMBER_ARCHIVE_BASE_URL',
    ];
    let savedEnv;

    beforeEach(() => {
        jest.resetModules();
        savedEnv = {};
        ENV_KEYS.forEach(key => { savedEnv[key] = process.env[key]; delete process.env[key]; });
    });

    afterEach(() => {
        ENV_KEYS.forEach(key => {
            if (savedEnv[key] === undefined) delete process.env[key];
            else process.env[key] = savedEnv[key];
        });
    });

    test('defaults to loopback host, port 3477, and localhost Ollama', () => {
        const cfg = require('../app/runtimeConfig');
        expect(cfg.HOST).toBe('127.0.0.1');
        expect(cfg.PORT).toBe(3477);
        expect(cfg.OLLAMA_BASE_URL).toBe('http://localhost:11434');
        expect(cfg.OLLAMA_CHAT_URL).toBe('http://localhost:11434/api/chat');
        expect(cfg.OLLAMA_TAGS_URL).toBe('http://localhost:11434/api/tags');
        expect(cfg.OLLAMA_HEALTH_TIMEOUT_MS).toBeGreaterThan(0);
    });

    test('honors explicit host/port/Ollama overrides', () => {
        process.env.EMBER_NODE_HOST = '0.0.0.0';
        process.env.EMBER_NODE_PORT = '9999';
        process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:22222';
        process.env.EMBER_OLLAMA_TIMEOUT_MS = '500';

        const cfg = require('../app/runtimeConfig');
        expect(cfg.HOST).toBe('0.0.0.0');
        expect(cfg.PORT).toBe(9999);
        expect(cfg.OLLAMA_BASE_URL).toBe('http://127.0.0.1:22222');
        expect(cfg.OLLAMA_HEALTH_TIMEOUT_MS).toBe(500);
    });

    test('falls back to defaults for invalid overrides', () => {
        process.env.EMBER_NODE_PORT = 'not-a-port';
        process.env.EMBER_OLLAMA_TIMEOUT_MS = '-5';

        const cfg = require('../app/runtimeConfig');
        expect(cfg.PORT).toBe(3477);
        expect(cfg.OLLAMA_HEALTH_TIMEOUT_MS).toBeGreaterThan(0);
    });

    test('runtimeStewardship and embeddings agree with the canonical Ollama base URL', () => {
        process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:33333';
        const cfg = require('../app/runtimeConfig');
        const stewardship = require('../app/runtimeStewardship');
        const embeddings = require('../app/embeddings');
        expect(stewardship.OLLAMA_BASE_URL).toBe(cfg.OLLAMA_BASE_URL);
        expect(embeddings.OLLAMA_BASE_URL).toBe(cfg.OLLAMA_BASE_URL);
    });
});

describe('GET /api/status — canonical status contract', () => {
    let dataRoot;

    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-phase20a-status-'));
        process.env.EMBER_NODE_DATA_ROOT = dataRoot;
        delete process.env.EMBER_DATA_ROOT;
    });

    afterEach(() => {
        delete process.env.EMBER_NODE_DATA_ROOT;
        delete process.env.EMBER_DATA_ROOT;
        try { fs.rmSync(dataRoot, { recursive: true, force: true }); } catch { /* best-effort test cleanup; failure here does not affect assertions */ }
    });

    test('reports the Node as available with a stable shape when Ollama is unreachable', async () => {
        const axiosMock = require('axios');
        axiosMock.get.mockRejectedValue(new Error('ECONNREFUSED'));
        const { app } = require('../app/server');

        const res = await request(app).get('/api/status');
        expect(res.status).toBe(200);
        expect(res.body.serverAvailable).toBe(true);
        expect(res.body.aiRuntimeReachable).toBe(false);
        expect(res.body.aiModelAvailable).toBe(false);
        expect(res.body.ai).toEqual({
            runtimeReachable: false,
            configuredModel: res.body.model,
            modelAvailable: false,
        });
        expect(typeof res.body.model).toBe('string');
        expect(typeof res.body.ollamaBaseUrl).toBe('string');
        expect(typeof res.body.port).toBe('number');
    });

    test('reports AI reachability and model availability when Ollama is reachable', async () => {
        const axiosMock = require('axios');
        axiosMock.get.mockResolvedValue({ data: { models: [{ name: 'gemma3:4b' }] } });
        const { app } = require('../app/server');

        const res = await request(app).get('/api/status');
        expect(res.status).toBe(200);
        expect(res.body.serverAvailable).toBe(true);
        expect(res.body.aiRuntimeReachable).toBe(true);
        expect(res.body.aiModelAvailable).toBe(true);
        expect(res.body.ai.runtimeReachable).toBe(true);
        expect(res.body.ai.modelAvailable).toBe(true);
    });

    test('Ollama probe requests use an explicit timeout', async () => {
        const axiosMock = require('axios');
        axiosMock.get.mockResolvedValue({ data: { models: [] } });
        const { app } = require('../app/server');

        await request(app).get('/api/status');
        expect(axiosMock.get).toHaveBeenCalledWith(
            expect.stringContaining('/api/tags'),
            expect.objectContaining({ timeout: expect.any(Number) }),
        );
    });
});
