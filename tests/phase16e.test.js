'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const axios = require('axios');

jest.mock('axios');

describe('Phase 16E — Fractal Context Compression + Archetype Memory Geometry', () => {
    let dataRoot;
    let tempRoots;

    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-p16e-'));
        tempRoots = [];
        process.env.EMBER_NODE_DATA_ROOT = dataRoot;
        delete process.env.EMBER_DATA_ROOT;
    });

    afterEach(() => {
        delete process.env.EMBER_NODE_DATA_ROOT;
        delete process.env.EMBER_DATA_ROOT;
        tempRoots.forEach(root => {
            try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
        });
        try { fs.rmSync(dataRoot, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    test('storageConfig seeds cache/document/archetype memory files', () => {
        const sc = require('../app/storageConfig');
        sc.ensureDataRoot();
        sc.ensureCanonicalDataFiles();

        expect(fs.existsSync(sc.CACHE_SUMMARIES_PATH)).toBe(true);
        expect(fs.existsSync(sc.DOCUMENT_SUMMARIES_PATH)).toBe(true);
        expect(fs.existsSync(sc.ARCHETYPE_MEMORY_PATH)).toBe(true);

        const cacheSummaries = JSON.parse(fs.readFileSync(sc.CACHE_SUMMARIES_PATH, 'utf8'));
        const documentSummaries = JSON.parse(fs.readFileSync(sc.DOCUMENT_SUMMARIES_PATH, 'utf8'));
        const archetypeMemory = JSON.parse(fs.readFileSync(sc.ARCHETYPE_MEMORY_PATH, 'utf8'));

        expect(cacheSummaries.version).toBe('0.1.0');
        expect(documentSummaries.version).toBe('0.1.0');
        expect(archetypeMemory.version).toBe('0.1.0');
        expect(archetypeMemory.archetypes).toHaveProperty('scribe');
    });

    test('data root resolution remains stable when EMBER_DATA_ROOT is absent or conflicts', () => {
        const conflictRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-conflict-'));
        tempRoots.push(conflictRoot);
        process.env.EMBER_DATA_ROOT = conflictRoot;
        let sc = require('../app/storageConfig');
        expect(sc.getDataRoot()).toBe(dataRoot);

        delete process.env.EMBER_NODE_DATA_ROOT;
        jest.resetModules();
        sc = require('../app/storageConfig');
        expect(sc.getDataRoot()).toBe(conflictRoot);
    });

    test('memory compression refresh endpoint supports staged and full refresh', async () => {
        axios.post.mockResolvedValue({ data: { message: { content: 'ok' } } });
        const { app } = require('../app/server');

        const staged = await request(app)
            .post('/api/system/memory-compression/refresh')
            .send({ stage: 'document_summaries' });
        expect(staged.status).toBe(200);
        expect(staged.body.success).toBe(true);
        expect(staged.body.refreshed.documentSummaries).toBe(true);

        const full = await request(app)
            .post('/api/system/memory-compression/refresh')
            .send({ stage: 'all' });
        expect(full.status).toBe(200);
        expect(full.body.success).toBe(true);
        expect(full.body.refreshed.cacheSummaries).toBe(true);
        expect(full.body.refreshed.archetypeMemory).toBe(true);

        const status = await request(app).get('/api/status');
        expect(status.status).toBe(200);
        expect(status.body).toHaveProperty('memoryCompression');
        expect(status.body.memoryCompression).toHaveProperty('cacheSummariesCount');
        expect(status.body.memoryCompression).toHaveProperty('documentSummariesCount');
        expect(status.body.memoryCompression).toHaveProperty('archetypeMemoryCount');
    });

    test('chat falls back cleanly when summary files are missing', async () => {
        const sc = require('../app/storageConfig');
        sc.ensureDataRoot();
        sc.ensureCanonicalDataFiles();
        try { fs.unlinkSync(sc.CACHE_SUMMARIES_PATH); } catch { /* ignore */ }
        try { fs.unlinkSync(sc.DOCUMENT_SUMMARIES_PATH); } catch { /* ignore */ }
        try { fs.unlinkSync(sc.ARCHETYPE_MEMORY_PATH); } catch { /* ignore */ }

        const mockedAxios = require('axios');
        mockedAxios.post.mockResolvedValue({ data: { message: { content: 'Fallback works' } } });
        const { app } = require('../app/server');

        const res = await request(app)
            .post('/api/chat')
            .send({ query: 'Summarize continuity posture.' });
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('answer');
        expect(res.body).toHaveProperty('signalTrace');
        expect(res.body.signalTrace).toHaveProperty('memoryFlow');
        expect(res.body.signalTrace.depth).toBe('Ember');
        expect(typeof res.body.signalTrace.compact).toBe('string');
        expect(res.body.signalTrace.compact).toContain('Depth: Ember');
    });

    test('chat accepts depth/context budget profile aliases', async () => {
        const mockedAxios = require('axios');
        mockedAxios.post.mockResolvedValue({ data: { message: { content: 'Depth profile response' } } });
        const { app } = require('../app/server');

        const spark = await request(app)
            .post('/api/chat')
            .send({ query: 'Map symbolic language through practical systems.', depth: 'spark' });
        expect(spark.status).toBe(200);
        expect(spark.body.signalTrace.depth).toBe('Spark');
        expect(spark.body.signalTrace.compact).toContain('Depth: Spark');

        const archive = await request(app)
            .post('/api/chat')
            .send({ query: 'Map symbolic language through practical systems.', contextBudgetProfile: 'archive' });
        expect(archive.status).toBe(200);
        expect(archive.body.signalTrace.depth).toBe('Archive');
        expect(archive.body.signalTrace.compact).toContain('Depth: Archive');

        const hearth = await request(app)
            .post('/api/chat')
            .send({ query: 'Map symbolic language through practical systems.', responseDepth: 'hearth' });
        expect(hearth.status).toBe(200);
        expect(hearth.body.signalTrace.depth).toBe('Hearth');
        expect(hearth.body.signalTrace.compact).toContain('Depth: Hearth');
    });

    test('chat defaults invalid response depth to Ember', async () => {
        const mockedAxios = require('axios');
        mockedAxios.post.mockResolvedValue({ data: { message: { content: 'Depth fallback response' } } });
        const { app } = require('../app/server');

        const invalid = await request(app)
            .post('/api/chat')
            .send({ query: 'Hold a balanced context window.', responseDepth: 'volcano' });
        expect(invalid.status).toBe(200);
        expect(invalid.body.signalTrace.depth).toBe('Ember');
        expect(invalid.body.signalTrace.compact).toContain('Depth: Ember');
    });

    test('spark depth injects explicit response instruction and appends subtle deeper-depth nudge', async () => {
        const mockedAxios = require('axios');
        mockedAxios.post.mockResolvedValue({ data: { message: { content: 'Quick orientation response.' } } });
        const { app } = require('../app/server');

        const spark = await request(app)
            .post('/api/chat')
            .send({ query: 'Give me the shortest orientation.', responseDepth: 'spark' });
        expect(spark.status).toBe(200);
        expect(spark.body.answer).toContain('Load a deeper depth if you want the wider weave.');

        const payload = mockedAxios.post.mock.calls[0][1];
        const userPrompt = payload && payload.messages && payload.messages[1] ? payload.messages[1].content : '';
        expect(userPrompt).toContain('=== Response Depth Instruction ===');
        expect(userPrompt).toContain('Response Depth: Spark');
        expect(userPrompt).toContain('1–3 short paragraphs OR 3–5 concise bullets.');
    });

    test('archive depth injects archive response instruction block', async () => {
        const mockedAxios = require('axios');
        mockedAxios.post.mockResolvedValue({ data: { message: { content: 'Archive sweep response.' } } });
        const { app } = require('../app/server');

        const archive = await request(app)
            .post('/api/chat')
            .send({ query: 'Synthesize all memory layers.', responseDepth: 'archive' });
        expect(archive.status).toBe(200);

        const payload = mockedAxios.post.mock.calls[0][1];
        const userPrompt = payload && payload.messages && payload.messages[1] ? payload.messages[1].content : '';
        expect(userPrompt).toContain('Response Depth: Archive');
        expect(userPrompt).toContain('Broad synthesis allowed.');
        expect(userPrompt).toContain('Longer response acceptable when it improves fidelity.');
    });
});
