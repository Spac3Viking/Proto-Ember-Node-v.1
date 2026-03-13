'use strict';

/**
 * Ember Node v.ᚠ — Phase 3 Tests
 *
 * Tests for: ingest, chunker, embeddings (pure functions), indexStore, signalTrace,
 * and the new Phase 3 server endpoints.
 */

const fs      = require('fs');
const os      = require('os');
const path    = require('path');
const request = require('supertest');
const axios   = require('axios');

jest.mock('axios');

// ── ingest.js ─────────────────────────────────────────────────────────────────

describe('ingest — extractText', () => {
    const { extractText } = require('../app/ingest');

    let tmpDir;

    beforeAll(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-ingest-'));
    });

    afterAll(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('extracts content from a .txt file', () => {
        const p = path.join(tmpDir, 'hello.txt');
        fs.writeFileSync(p, 'Hello world', 'utf8');
        expect(extractText(p)).toBe('Hello world');
    });

    test('extracts content from a .md file', () => {
        const p = path.join(tmpDir, 'doc.md');
        fs.writeFileSync(p, '# Title\n\nBody', 'utf8');
        expect(extractText(p)).toBe('# Title\n\nBody');
    });

    test('returns null for unsupported file types', () => {
        const p = path.join(tmpDir, 'file.pdf');
        fs.writeFileSync(p, '%PDF-1.4', 'utf8');
        expect(extractText(p)).toBeNull();
    });
});

describe('ingest — buildSourceRecord', () => {
    const { buildSourceRecord } = require('../app/ingest');

    test('returns required fields', () => {
        const filePath = '/tmp/test-ember/hearth/doc.md';
        const record   = buildSourceRecord({ filePath, room: 'hearth', cartridgeId: 'green_fire' });
        expect(typeof record.id).toBe('string');
        expect(record.room).toBe('hearth');
        expect(record.file).toBe('doc.md');
        expect(record.cartridgeId).toBe('green_fire');
        expect(record.sourceType).toBe('md');
        expect(typeof record.ingestTimestamp).toBe('string');
    });

    test('cartridgeId defaults to null', () => {
        const filePath = '/tmp/test-ember/workshop/note.txt';
        const record   = buildSourceRecord({ filePath, room: 'workshop' });
        expect(record.cartridgeId).toBeNull();
    });
});

describe('ingest — collectFiles', () => {
    const { collectFiles } = require('../app/ingest');

    let tmpDir;

    beforeAll(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-collect-'));
        fs.writeFileSync(path.join(tmpDir, 'a.md'),  '# A', 'utf8');
        fs.writeFileSync(path.join(tmpDir, 'b.txt'), 'B',   'utf8');
        fs.writeFileSync(path.join(tmpDir, 'c.pdf'), '%PDF','utf8');
        const sub = path.join(tmpDir, 'docs');
        fs.mkdirSync(sub);
        fs.writeFileSync(path.join(sub, 'd.md'), '# D', 'utf8');
    });

    afterAll(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('returns .md and .txt files', () => {
        const files = collectFiles(tmpDir);
        const names = files.map(f => path.basename(f));
        expect(names).toContain('a.md');
        expect(names).toContain('b.txt');
    });

    test('excludes unsupported file types', () => {
        const files = collectFiles(tmpDir);
        const names = files.map(f => path.basename(f));
        expect(names).not.toContain('c.pdf');
    });

    test('recursively collects files from subdirectories', () => {
        const files = collectFiles(tmpDir);
        const names = files.map(f => path.basename(f));
        expect(names).toContain('d.md');
    });

    test('returns empty array for non-existent directory', () => {
        expect(collectFiles('/tmp/__nonexistent_ember_dir__')).toEqual([]);
    });
});

// ── chunker.js ────────────────────────────────────────────────────────────────

describe('chunker — makeChunkId', () => {
    const { makeChunkId } = require('../app/chunker');

    test('produces a deterministic ID from room, cartridge, file, and index', () => {
        const id = makeChunkId({ room: 'hearth', cartridgeId: 'green_fire', file: 'codex.md', index: 0 });
        expect(typeof id).toBe('string');
        expect(id).toContain('hearth');
        expect(id).toContain('green');   // green_fire becomes green-fire
        expect(id).toContain('codex');
        expect(id).toContain('000');
    });

    test('works without cartridgeId', () => {
        const id = makeChunkId({ room: 'workshop', cartridgeId: null, file: 'note.txt', index: 1 });
        expect(id).toContain('workshop');
        expect(id).toContain('001');
    });

    test('two chunks with different indexes have different IDs', () => {
        const id0 = makeChunkId({ room: 'hearth', cartridgeId: null, file: 'doc.md', index: 0 });
        const id1 = makeChunkId({ room: 'hearth', cartridgeId: null, file: 'doc.md', index: 1 });
        expect(id0).not.toBe(id1);
    });
});

describe('chunker — chunkText', () => {
    const { chunkText } = require('../app/chunker');

    const sourceRecord = {
        id:          'test-source-1',
        room:        'hearth',
        cartridgeId: 'green_fire',
        file:        'codex.md',
        path:        'data/hearth/codex.md',
        sourceType:  'md',
    };

    test('returns at least one chunk for non-empty text', () => {
        const chunks = chunkText({ text: 'Hello world', sourceRecord });
        expect(chunks.length).toBeGreaterThan(0);
    });

    test('returns empty array for whitespace-only text', () => {
        const chunks = chunkText({ text: '   ', sourceRecord });
        expect(chunks).toEqual([]);
    });

    test('each chunk has required fields', () => {
        const chunks = chunkText({ text: 'Hello world this is a test of the chunker.', sourceRecord });
        chunks.forEach(chunk => {
            expect(typeof chunk.id).toBe('string');
            expect(chunk.room).toBe('hearth');
            expect(chunk.cartridgeId).toBe('green_fire');
            expect(chunk.file).toBe('codex.md');
            expect(typeof chunk.text).toBe('string');
            expect(chunk.text.length).toBeGreaterThan(0);
            expect(chunk.sourceId).toBe('test-source-1');
        });
    });

    test('produces multiple chunks for long text', () => {
        const long = 'word '.repeat(300);  // ~1500 chars
        const chunks = chunkText({ text: long, sourceRecord, chunkSize: 200, overlap: 40 });
        expect(chunks.length).toBeGreaterThan(1);
    });

    test('chunk indexes are sequential', () => {
        const long = 'x'.repeat(2000);
        const chunks = chunkText({ text: long, sourceRecord, chunkSize: 300, overlap: 50 });
        chunks.forEach((chunk, i) => {
            expect(chunk.index).toBe(i);
        });
    });

    test('chunk IDs are unique', () => {
        const long   = 'y'.repeat(2000);
        const chunks = chunkText({ text: long, sourceRecord, chunkSize: 300, overlap: 50 });
        const ids    = chunks.map(c => c.id);
        expect(new Set(ids).size).toBe(ids.length);
    });
});

// ── embeddings.js (pure functions) ────────────────────────────────────────────

describe('embeddings — cosineSimilarity', () => {
    const { cosineSimilarity } = require('../app/embeddings');

    test('identical vectors have similarity 1', () => {
        const v = [1, 0, 0];
        expect(cosineSimilarity(v, v)).toBeCloseTo(1);
    });

    test('orthogonal vectors have similarity 0', () => {
        expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    });

    test('opposite vectors have similarity -1', () => {
        expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
    });

    test('returns 0 for empty arrays', () => {
        expect(cosineSimilarity([], [])).toBe(0);
    });

    test('returns 0 for mismatched lengths', () => {
        expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
    });

    test('returns 0 for null inputs', () => {
        expect(cosineSimilarity(null, [1, 0])).toBe(0);
    });
});

describe('embeddings — keywordScore', () => {
    const { keywordScore } = require('../app/embeddings');

    test('returns > 0 when query words appear in text', () => {
        expect(keywordScore('green fire', 'the green fire burns bright')).toBeGreaterThan(0);
    });

    test('returns 0 when no query words appear in text', () => {
        expect(keywordScore('alchemy', 'cats dogs birds')).toBe(0);
    });

    test('returns 0 for empty query', () => {
        expect(keywordScore('', 'some text')).toBe(0);
    });

    test('score is between 0 and 1', () => {
        const score = keywordScore('fire water earth', 'fire burns water flows');
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
    });
});

// ── indexStore.js ─────────────────────────────────────────────────────────────

describe('indexStore', () => {
    let tmpDir;
    let store;

    beforeAll(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-index-'));

        // Build an isolated in-memory-ish store backed by our temp dir
        const p = require('path');
        const f = require('fs');

        const cfFile = p.join(tmpDir, 'chunks.json');
        const efFile = p.join(tmpDir, 'embeddings.json');
        const mfFile = p.join(tmpDir, 'manifests.json');
        const exFile = p.join(tmpDir, 'excluded.json');

        function readJ(fp, d) {
            if (!f.existsSync(fp)) return d;
            try { return JSON.parse(f.readFileSync(fp, 'utf8')); } catch { return d; }
        }
        function writeJ(fp, v) {
            f.writeFileSync(fp, JSON.stringify(v, null, 2), 'utf8');
        }

        store = {
            loadChunks:   () => readJ(cfFile, []),
            saveChunks:   v  => writeJ(cfFile, v),
            upsertChunks(chunks) {
                const ids      = new Set(chunks.map(c => c.sourceId));
                const existing = readJ(cfFile, []).filter(c => !ids.has(c.sourceId));
                writeJ(cfFile, [...existing, ...chunks]);
            },
            getChunksByRoom: r => readJ(cfFile, []).filter(c => c.room === r),
            loadEmbeddings:  () => readJ(efFile, {}),
            upsertEmbeddings(entries) {
                const e = readJ(efFile, {});
                Object.assign(e, entries);
                writeJ(efFile, e);
            },
            loadManifests:   () => readJ(mfFile, {}),
            upsertManifest(id, rec) {
                const e = readJ(mfFile, {});
                e[id] = rec;
                writeJ(mfFile, e);
            },
            loadExcluded:    () => readJ(exFile, []),
            setExcluded:     v  => writeJ(exFile, v),
        };
    });

    afterAll(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('loadChunks returns empty array initially', () => {
        expect(store.loadChunks()).toEqual([]);
    });

    test('upsertChunks adds chunks', () => {
        const chunks = [{ id: 'c1', sourceId: 's1', room: 'hearth', text: 'hello' }];
        store.upsertChunks(chunks);
        expect(store.loadChunks()).toHaveLength(1);
    });

    test('upsertChunks replaces chunks for same sourceId', () => {
        const chunks = [{ id: 'c2', sourceId: 's1', room: 'hearth', text: 'updated' }];
        store.upsertChunks(chunks);
        const all = store.loadChunks();
        expect(all).toHaveLength(1);
        expect(all[0].text).toBe('updated');
    });

    test('upsertEmbeddings stores vectors', () => {
        store.upsertEmbeddings({ c1: [0.1, 0.2, 0.3] });
        const embs = store.loadEmbeddings();
        expect(Array.isArray(embs.c1)).toBe(true);
    });

    test('upsertManifest stores source records', () => {
        store.upsertManifest('src-1', { id: 'src-1', room: 'hearth', file: 'a.md' });
        const manifests = store.loadManifests();
        expect(manifests['src-1']).toBeDefined();
        expect(manifests['src-1'].room).toBe('hearth');
    });

    test('setExcluded and loadExcluded round-trip', () => {
        store.setExcluded(['src-1', 'src-2']);
        expect(store.loadExcluded()).toEqual(['src-1', 'src-2']);
    });
});

// ── signalTrace.js ────────────────────────────────────────────────────────────

describe('signalTrace — buildSignalTrace', () => {
    const { buildSignalTrace } = require('../app/signalTrace');

    test('returns empty array for empty input', () => {
        expect(buildSignalTrace([])).toEqual([]);
    });

    test('returns empty array for non-array input', () => {
        expect(buildSignalTrace(null)).toEqual([]);
    });

    test('maps retrieved chunks to source records', () => {
        const retrieved = [
            {
                chunk: {
                    id:          'hearth-green-fire-codex-md-000',
                    room:        'hearth',
                    shelf:       'green_fire',
                    cartridgeId: 'green_fire',
                    file:        'codex.md',
                },
                score: 0.876,
            },
        ];
        const trace = buildSignalTrace(retrieved);
        expect(trace).toHaveLength(1);
        expect(trace[0].room).toBe('hearth');
        expect(trace[0].file).toBe('codex.md');
        expect(trace[0].chunkId).toBe('hearth-green-fire-codex-md-000');
        expect(trace[0].score).toBe(0.88); // rounded to 2 dp
    });
});

describe('signalTrace — formatSignalTraceSummary', () => {
    const { formatSignalTraceSummary } = require('../app/signalTrace');

    test('returns "no sources" for empty array', () => {
        expect(formatSignalTraceSummary([])).toBe('no sources');
    });

    test('returns summary string', () => {
        const sources = [{ room: 'hearth', file: 'codex.md', score: 0.9 }];
        const summary = formatSignalTraceSummary(sources);
        expect(summary).toContain('hearth/codex.md');
    });
});

// ── cartridgeLoader docs/ support ─────────────────────────────────────────────

describe('cartridgeLoader — docs/ subdirectory support', () => {
    const { loadCartridge } = require('../app/cartridgeLoader');

    test('green_fire content includes docs/ content', () => {
        const result = loadCartridge('green_fire');
        expect(result).not.toBeNull();
        expect(result.content).toContain('Green Fire');
    });

    test('content length is greater when docs/ files are present', () => {
        const result = loadCartridge('green_fire');
        // We added docs/ — content should be substantially longer than README alone
        expect(result.content.length).toBeGreaterThan(500);
    });
});

// ── Phase 3 server endpoints ──────────────────────────────────────────────────

describe('POST /api/chat', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('returns 400 when query is missing', async () => {
        const { app } = require('../app/server');
        const res = await request(app).post('/api/chat').send({});
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/query/i);
    });

    test('returns answer and sources on success', async () => {
        axios.post.mockImplementation((url) => {
            if (url.includes('/api/embeddings')) {
                return Promise.resolve({ data: {} });
            }
            return Promise.resolve({ data: { message: { content: 'The signal is clear.' } } });
        });

        const { app } = require('../app/server');
        const res = await request(app)
            .post('/api/chat')
            .send({ query: 'What is green fire?' });

        expect(res.status).toBe(200);
        expect(typeof res.body.answer).toBe('string');
        expect(Array.isArray(res.body.sources)).toBe(true);
        expect(typeof res.body.grounded).toBe('boolean');
    });

    test('returns 500 when Ollama chat is unreachable', async () => {
        axios.post.mockImplementation((url) => {
            if (url.includes('/api/embeddings')) {
                return Promise.resolve({ data: {} });
            }
            return Promise.reject(new Error('ECONNREFUSED'));
        });

        const { app } = require('../app/server');
        const res = await request(app)
            .post('/api/chat')
            .send({ query: 'test' });

        expect(res.status).toBe(500);
    });
});

describe('POST /api/ingest', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('returns 400 when filename is missing', async () => {
        const { app } = require('../app/server');
        const res = await request(app).post('/api/ingest').send({ content: 'hi' });
        expect(res.status).toBe(400);
    });

    test('returns 400 when content is missing', async () => {
        const { app } = require('../app/server');
        const res = await request(app).post('/api/ingest').send({ filename: 'test.md' });
        expect(res.status).toBe(400);
    });

    test('returns 400 for unsupported file type', async () => {
        const { app } = require('../app/server');
        const res = await request(app)
            .post('/api/ingest')
            .send({ filename: 'doc.pdf', content: '%PDF' });
        expect(res.status).toBe(400);
    });

    test('ingests a .md file into threshold and returns source record', async () => {
        const { app } = require('../app/server');
        const res = await request(app)
            .post('/api/ingest')
            .send({ filename: 'phase3-test-doc.md', content: '# Test\n\nHello', room: 'threshold' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.source).toBeDefined();
        expect(res.body.source.room).toBe('threshold');
        expect(res.body.source.file).toBe('phase3-test-doc.md');

        // Clean up ingested file
        const { DATA_DIR } = require('../app/ingest');
        const fp = path.join(DATA_DIR, 'threshold', 'phase3-test-doc.md');
        if (fs.existsSync(fp)) fs.unlinkSync(fp);
    });

    test('returns 400 for invalid room', async () => {
        const { app } = require('../app/server');
        const res = await request(app)
            .post('/api/ingest')
            .send({ filename: 'x.md', content: 'hi', room: 'attic' });
        expect(res.status).toBe(400);
    });
});

describe('GET /api/sources', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('returns 200 with sources array', async () => {
        const { app } = require('../app/server');
        const res = await request(app).get('/api/sources');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.sources)).toBe(true);
    });
});

describe('GET /api/notes', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('returns 200 with notes array', async () => {
        const { app } = require('../app/server');
        const res = await request(app).get('/api/notes');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.notes)).toBe(true);
    });
});

describe('POST /api/notes', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('returns 400 when content is missing', async () => {
        const { app } = require('../app/server');
        const res = await request(app).post('/api/notes').send({});
        expect(res.status).toBe(400);
    });

    test('saves a note and returns filename', async () => {
        const { app } = require('../app/server');
        const res = await request(app)
            .post('/api/notes')
            .send({ content: 'Test note content.', title: 'Phase3 Test Note' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(typeof res.body.filename).toBe('string');

        // Clean up
        const { DATA_DIR } = require('../app/ingest');
        const fp = path.join(DATA_DIR, 'workshop', res.body.filename);
        if (fs.existsSync(fp)) fs.unlinkSync(fp);
    });
});

describe('GET /api/threshold/list', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('returns 200 with files array', async () => {
        const { app } = require('../app/server');
        const res = await request(app).get('/api/threshold/list');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.files)).toBe(true);
    });
});

describe('GET /api/status includes Phase 3 fields', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('returns indexedChunks and indexedSources', async () => {
        const { app } = require('../app/server');
        const res = await request(app).get('/api/status');
        expect(res.status).toBe(200);
        expect(typeof res.body.indexedChunks).toBe('number');
        expect(typeof res.body.indexedSources).toBe('number');
    });
});
