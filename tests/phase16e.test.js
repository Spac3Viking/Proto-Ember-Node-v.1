'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const axios = require('axios');

jest.mock('axios');

describe('Phase 16E — Fractal Context Compression + Archetype Memory Geometry', () => {
    let dataRoot;

    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-p16e-'));
        process.env.EMBER_NODE_DATA_ROOT = dataRoot;
        delete process.env.EMBER_DATA_ROOT;
    });

    afterEach(() => {
        delete process.env.EMBER_NODE_DATA_ROOT;
        delete process.env.EMBER_DATA_ROOT;
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
    });
});
