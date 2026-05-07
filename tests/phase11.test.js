'use strict';

/**
 * Ember Node v.ᚠ — Phase 11 Tests
 *
 * Context Architecture v1:
 *   - Trusted Archive sources and bootstrap
 *   - Room-bounded retrieval with archive inclusion
 *   - Remembered Threads
 *   - Context Maps (working + remembered)
 *   - Thread states (active / archived / remembered)
 *   - Thread deletion
 *   - Cross-room context assembly
 */

const request = require('supertest');
const fs      = require('fs');
const path    = require('path');
const os      = require('os');
const axios   = require('axios');

jest.mock('axios');

// ── Temporary data root ───────────────────────────────────────────────────────

const DATA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-p11-'));

beforeAll(() => {
    process.env.EMBER_DATA_ROOT = DATA_ROOT;
});

afterAll(() => {
    delete process.env.EMBER_DATA_ROOT;
    try { fs.rmSync(DATA_ROOT, { recursive: true, force: true }); } catch { /* ignore */ }
});

// Require app and services AFTER env is set but within the same module context
// so that jest.mock('axios') remains active.
const { app } = require('../app/server');

// ── storageConfig — new directories ──────────────────────────────────────────

describe('Phase 11 — storageConfig new directories', () => {
    const sc = require('../app/storageConfig');

    test('exports ARCHIVE_DIR, ARCHIVE_DIRS, MAPS_DIRS, HEARTH_REMEMBERED_THREADS_DIR', () => {
        expect(sc.ARCHIVE_DIR).toBeDefined();
        expect(sc.ARCHIVE_DIRS).toBeDefined();
        expect(sc.ARCHIVE_DIRS.codices).toBeDefined();
        expect(sc.ARCHIVE_DIRS.grimoires).toBeDefined();
        expect(sc.ARCHIVE_DIRS.sagas).toBeDefined();
        expect(sc.MAPS_DIRS).toBeDefined();
        expect(sc.MAPS_DIRS.hearth).toBeDefined();
        expect(sc.MAPS_DIRS.workshop).toBeDefined();
        expect(sc.MAPS_DIRS.threshold).toBeDefined();
        expect(sc.HEARTH_REMEMBERED_THREADS_DIR).toBeDefined();
    });

    test('ensureDataRoot creates archive subdirectories', () => {
        sc.ensureDataRoot();
        expect(fs.existsSync(sc.ARCHIVE_DIR)).toBe(true);
        expect(fs.existsSync(sc.ARCHIVE_DIRS.codices)).toBe(true);
        expect(fs.existsSync(sc.ARCHIVE_DIRS.sagas)).toBe(true);
        expect(fs.existsSync(sc.MAPS_DIRS.hearth)).toBe(true);
        expect(fs.existsSync(sc.MAPS_DIRS.workshop)).toBe(true);
        expect(fs.existsSync(sc.MAPS_DIRS.threshold)).toBe(true);
        expect(fs.existsSync(sc.HEARTH_REMEMBERED_THREADS_DIR)).toBe(true);
    });
});

// ── ingest — sourceClass ──────────────────────────────────────────────────────

describe('Phase 11 — ingest sourceClass', () => {
    const { buildSourceRecord, SOURCE_CLASSES } = require('../app/ingest');

    test('exports SOURCE_CLASSES with all four class identifiers', () => {
        expect(SOURCE_CLASSES.TRUSTED_ARCHIVE).toBe('trusted-archive');
        expect(SOURCE_CLASSES.WORKSHOP_DRAFT).toBe('workshop-draft');
        expect(SOURCE_CLASSES.HEARTH_REMEMBERED).toBe('hearth-remembered');
        expect(SOURCE_CLASSES.THRESHOLD_INTAKE).toBe('threshold-intake');
    });

    test('buildSourceRecord sets sourceClass based on room', () => {
        const hearthFile    = path.join(DATA_ROOT, 'hearth', 'test-ingest.md');
        const workshopFile  = path.join(DATA_ROOT, 'workshop', 'test-ingest.md');
        const thresholdFile = path.join(DATA_ROOT, 'threshold', 'test-ingest.md');

        [hearthFile, workshopFile, thresholdFile].forEach(f => {
            fs.mkdirSync(path.dirname(f), { recursive: true });
            if (!fs.existsSync(f)) fs.writeFileSync(f, '# Test', 'utf8');
        });

        expect(buildSourceRecord({ filePath: hearthFile,    room: 'hearth'    }).sourceClass).toBe('hearth-remembered');
        expect(buildSourceRecord({ filePath: workshopFile,  room: 'workshop'  }).sourceClass).toBe('workshop-draft');
        expect(buildSourceRecord({ filePath: thresholdFile, room: 'threshold' }).sourceClass).toBe('threshold-intake');
    });
});

// ── archiveService ────────────────────────────────────────────────────────────

describe('Phase 11 — archiveService', () => {
    const archiveService = require('../app/archiveService');
    const sc             = require('../app/storageConfig');

    test('SOURCE_CLASS_ARCHIVE is trusted-archive', () => {
        expect(archiveService.SOURCE_CLASS_ARCHIVE).toBe('trusted-archive');
    });

    test('detectArchiveFiles returns empty array when archive is empty', () => {
        const files = archiveService.detectArchiveFiles();
        expect(Array.isArray(files)).toBe(true);
    });

    test('registerArchiveSource creates a manifest entry with sourceClass=trusted-archive', () => {
        const filePath = path.join(sc.ARCHIVE_DIRS.codices, 'first-codex.md');
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, '# First Codex\n\nThis is a test codex.', 'utf8');

        const source = archiveService.registerArchiveSource(filePath, 'codex');
        expect(source.sourceClass).toBe('trusted-archive');
        expect(source.room).toBe('hearth');
        expect(source.status).toBe('remembered');
        expect(source.shelf).toBe('codex');
    });

    test('detectArchiveFiles detects the registered file', () => {
        const files = archiveService.detectArchiveFiles();
        expect(files.length).toBeGreaterThan(0);
        expect(files[0]).toHaveProperty('filePath');
        expect(files[0]).toHaveProperty('shelf');
    });

    test('listArchiveSources returns registered sources', () => {
        const sources = archiveService.listArchiveSources();
        expect(sources.length).toBeGreaterThan(0);
        expect(sources[0].sourceClass).toBe('trusted-archive');
    });
});

// ── threadMemory ──────────────────────────────────────────────────────────────

describe('Phase 11 — threadMemory', () => {
    const threadMemory = require('../app/threadMemory');

    const mockThread = {
        id:       'thread-test-p11',
        title:    'Test Thread',
        room:     'hearth',
        status:   'active',
        messages: [
            { role: 'user',      content: 'Tell me about the Green Fire Archive and its mysteries.' },
            { role: 'assistant', content: 'The Green Fire Archive is a collection of ancient knowledge...' },
            { role: 'user',      content: 'What are its major themes and codices?' },
        ],
    };

    afterAll(() => {
        threadMemory.deleteThreadSummary(mockThread.id);
    });

    test('generateThreadSummary returns a summary object', () => {
        const summary = threadMemory.generateThreadSummary(mockThread);
        expect(summary.id).toBe(mockThread.id);
        expect(summary.title).toBe(mockThread.title);
        expect(summary.messageCount).toBe(3);
        expect(typeof summary.excerpt).toBe('string');
        expect(Array.isArray(summary.themes)).toBe(true);
    });

    test('rememberThread saves and returns a summary', () => {
        const summary = threadMemory.rememberThread(mockThread);
        expect(summary.id).toBe(mockThread.id);
        expect(summary.rememberedAt).toBeDefined();
    });

    test('loadThreadSummary returns saved summary', () => {
        const loaded = threadMemory.loadThreadSummary(mockThread.id);
        expect(loaded).not.toBeNull();
        expect(loaded.id).toBe(mockThread.id);
    });

    test('listThreadSummaries returns the saved summary', () => {
        const list = threadMemory.listThreadSummaries();
        expect(list.length).toBeGreaterThan(0);
    });

    test('deleteThreadSummary removes the summary', () => {
        threadMemory.deleteThreadSummary(mockThread.id);
        const loaded = threadMemory.loadThreadSummary(mockThread.id);
        expect(loaded).toBeNull();
    });
});

// ── contextMaps ───────────────────────────────────────────────────────────────

describe('Phase 11 — contextMaps', () => {
    const contextMaps = require('../app/contextMaps');
    const sc          = require('../app/storageConfig');

    test('buildHearthMap returns a valid map object', () => {
        const map = contextMaps.buildHearthMap();
        expect(map.id).toBe('hearth-working');
        expect(map.room).toBe('hearth');
        expect(map.mapType).toBe('working');
        expect(map.content).toBeDefined();
        expect(map.content.rememberedThreads).toBeDefined();
        expect(map.content.archiveByShelf).toBeDefined();
    });

    test('buildWorkshopMap returns a valid map object', () => {
        const map = contextMaps.buildWorkshopMap();
        expect(map.id).toBe('workshop-working');
        expect(map.room).toBe('workshop');
        expect(map.mapType).toBe('working');
    });

    test('buildThresholdMap returns a valid map object', () => {
        const map = contextMaps.buildThresholdMap();
        expect(map.id).toBe('threshold-working');
        expect(map.room).toBe('threshold');
        expect(map.mapType).toBe('working');
    });

    test('refreshWorkingMap saves and returns the map', () => {
        const map = contextMaps.refreshWorkingMap('hearth');
        expect(map.id).toBe('hearth-working');
        expect(fs.existsSync(path.join(sc.MAPS_DIRS.hearth, 'hearth-working.json'))).toBe(true);
    });

    test('getWorkingMap returns saved map', () => {
        contextMaps.refreshWorkingMap('workshop');
        const map = contextMaps.getWorkingMap('workshop');
        expect(map).not.toBeNull();
        expect(map.room).toBe('workshop');
    });

    test('listContextMaps returns maps for a room', () => {
        contextMaps.refreshWorkingMap('threshold');
        const maps = contextMaps.listContextMaps('threshold');
        expect(maps.length).toBeGreaterThan(0);
    });

    test('promoteToRememberedMap creates a remembered map', () => {
        contextMaps.refreshWorkingMap('hearth');
        const remembered = contextMaps.promoteToRememberedMap('hearth');
        expect(remembered.mapType).toBe('remembered');
        expect(remembered.id).toContain('hearth-remembered-');
    });

    test('assembleRoomContext returns native + imported maps', () => {
        contextMaps.refreshWorkingMap('hearth');
        contextMaps.refreshWorkingMap('workshop');
        contextMaps.refreshWorkingMap('threshold');

        const ctx = contextMaps.assembleRoomContext('hearth');
        expect(ctx.native).not.toBeNull();
        expect(Array.isArray(ctx.imported)).toBe(true);
        expect(ctx.imported.length).toBeGreaterThanOrEqual(1);
    });
});

// ── Thread routes — Phase 11 ──────────────────────────────────────────────────

describe('Phase 11 — Thread state routes', () => {
    let threadId;

    beforeAll(async () => {
        const res = await request(app)
            .post('/api/threads')
            .send({ title: 'Phase 11 Test Thread', room: 'hearth' });
        threadId = res.body.thread.id;
    });

    test('new thread has status=active', async () => {
        const res = await request(app).get('/api/threads/' + threadId);
        expect(res.status).toBe(200);
        expect(res.body.thread.status).toBe('active');
    });

    test('GET /api/threads includes status in thread summaries', async () => {
        const res = await request(app).get('/api/threads?room=hearth');
        expect(res.status).toBe(200);
        const t = res.body.threads.find(x => x.id === threadId);
        expect(t).toBeDefined();
        expect(t.status).toBe('active');
    });

    test('POST /api/threads/:id/archive sets status=archived', async () => {
        const res = await request(app).post('/api/threads/' + threadId + '/archive');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.thread.status).toBe('archived');
    });

    test('POST /api/threads/:id/remember sets status=remembered', async () => {
        const newRes = await request(app)
            .post('/api/threads')
            .send({ title: 'Thread to Remember', room: 'hearth' });
        const tid = newRes.body.thread.id;

        await request(app)
            .post('/api/threads/' + tid + '/messages')
            .send({ role: 'user', content: 'The Green Fire Archive holds ancient knowledge about stars and seasons.' });

        const res = await request(app).post('/api/threads/' + tid + '/remember');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.thread.status).toBe('remembered');
        expect(res.body.summary).toBeDefined();
        expect(res.body.summary.id).toBe(tid);
    });

    test('DELETE /api/threads/:id deletes the thread', async () => {
        const newRes = await request(app)
            .post('/api/threads')
            .send({ title: 'Thread to Delete', room: 'hearth' });
        const tid = newRes.body.thread.id;

        const delRes = await request(app).delete('/api/threads/' + tid);
        expect(delRes.status).toBe(200);
        expect(delRes.body.success).toBe(true);

        const getRes = await request(app).get('/api/threads/' + tid);
        expect(getRes.status).toBe(404);
    });

    test('GET /api/threads supports status query filter', async () => {
        const res = await request(app).get('/api/threads?room=hearth&status=archived');
        expect(res.status).toBe(200);
        res.body.threads.forEach(t => {
            expect(t.status).toBe('archived');
        });
    });
});

// ── Context Map routes ────────────────────────────────────────────────────────

describe('Phase 11 — Context Map routes', () => {
    test('POST /api/context-maps/hearth/refresh returns map', async () => {
        const res = await request(app).post('/api/context-maps/hearth/refresh');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.map.room).toBe('hearth');
        expect(res.body.map.mapType).toBe('working');
    });

    test('GET /api/context-maps/hearth/working returns map after refresh', async () => {
        const res = await request(app).get('/api/context-maps/hearth/working');
        expect(res.status).toBe(200);
        expect(res.body.map.id).toBe('hearth-working');
    });

    test('GET /api/context-maps/workshop returns list of maps', async () => {
        await request(app).post('/api/context-maps/workshop/refresh');
        const res = await request(app).get('/api/context-maps/workshop');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.maps)).toBe(true);
    });

    test('POST /api/context-maps/hearth/remember promotes to remembered', async () => {
        const res = await request(app).post('/api/context-maps/hearth/remember');
        expect(res.status).toBe(200);
        expect(res.body.map.mapType).toBe('remembered');
    });

    test('GET /api/context-maps/hearth/assemble returns native + imported', async () => {
        await request(app).post('/api/context-maps/threshold/refresh');
        const res = await request(app).get('/api/context-maps/hearth/assemble');
        expect(res.status).toBe(200);
        expect(res.body.context.native).toBeDefined();
        expect(Array.isArray(res.body.context.imported)).toBe(true);
    });

    test('invalid room returns 400', async () => {
        const res = await request(app).get('/api/context-maps/dungeon/working');
        expect(res.status).toBe(400);
    });
});

// ── Archive routes ────────────────────────────────────────────────────────────

describe('Phase 11 — Archive routes', () => {
    const sc = require('../app/storageConfig');

    test('GET /api/archive returns sources and shelves', async () => {
        const res = await request(app).get('/api/archive');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.sources)).toBe(true);
        expect(Array.isArray(res.body.shelves)).toBe(true);
    });

    test('POST /api/archive/ingest stores a file in the archive', async () => {
        const res = await request(app)
            .post('/api/archive/ingest')
            .send({
                filename:    'test-saga.md',
                content:     '# The Signal Saga\n\nOnce the fires were green and the archive was whole.',
                shelf:       'sagas',
                title:       'The Signal Saga',
                description: 'A test saga for Phase 11',
            });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.source.sourceClass).toBe('trusted-archive');
        expect(res.body.source.shelf).toBe('sagas');
    });

    test('POST /api/archive/bootstrap returns success', async () => {
        const res = await request(app).post('/api/archive/bootstrap');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(typeof res.body.registered).toBe('number');
        expect(typeof res.body.indexed).toBe('number');
    });

    test('POST /api/archive/ingest rejects invalid shelf', async () => {
        const res = await request(app)
            .post('/api/archive/ingest')
            .send({ filename: 'test.md', content: 'hello', shelf: 'dungeon' });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/Invalid shelf/);
    });

    test('GET /api/archive?shelf=sagas filters by shelf', async () => {
        const res = await request(app).get('/api/archive?shelf=sagas');
        expect(res.status).toBe(200);
        res.body.sources.forEach(s => expect(s.shelf).toBe('sagas'));
    });

    test('GET /api/archive/reader/catalog lists markdown entries from archive/core and archive/caches', async () => {
        const coreMd = path.join(sc.ARCHIVE_CORE_DIR, 'codices', 'reader-core.md');
        const cacheMd = path.join(sc.ARCHIVE_CACHES_DIR, 'reader-cache', 'entry.md');
        fs.mkdirSync(path.dirname(coreMd), { recursive: true });
        fs.mkdirSync(path.dirname(cacheMd), { recursive: true });
        fs.writeFileSync(coreMd, '# Core Reader\n\ncore body', 'utf8');
        fs.writeFileSync(cacheMd, '# Cache Reader\n\ncache body', 'utf8');

        const res = await request(app).get('/api/archive/reader/catalog');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(Array.isArray(res.body.roots)).toBe(true);

        const coreRoot = res.body.roots.find(r => r.id === 'archive-core');
        const cachesRoot = res.body.roots.find(r => r.id === 'archive-caches');
        expect(coreRoot).toBeDefined();
        expect(cachesRoot).toBeDefined();
        expect(coreRoot.files.some(f => f.sourcePath.endsWith('/reader-core.md'))).toBe(true);
        expect(cachesRoot.caches.some(c => c.cacheId === 'reader-cache')).toBe(true);
    });

    test('GET /api/archive/reader/document/:entryId returns frontmatter-stripped markdown', async () => {
        const coreMd = path.join(sc.ARCHIVE_CORE_DIR, 'sagas', 'frontmatter-reader.md');
        fs.mkdirSync(path.dirname(coreMd), { recursive: true });
        fs.writeFileSync(
            coreMd,
            '---\ntitle: Frontmatter Test\nauthor: Ember\n---\n# Reader Body\n\nSignal lives.\n',
            'utf8',
        );

        const catalogRes = await request(app).get('/api/archive/reader/catalog');
        const coreRoot = catalogRes.body.roots.find(r => r.id === 'archive-core');
        const entry = (coreRoot.files || []).find(f => f.sourcePath.endsWith('/frontmatter-reader.md'));
        expect(entry).toBeDefined();

        const docRes = await request(app).get('/api/archive/reader/document/' + encodeURIComponent(entry.entryId));
        expect(docRes.status).toBe(200);
        expect(docRes.body.success).toBe(true);
        expect(docRes.body.content).toContain('# Reader Body');
        expect(docRes.body.content).not.toContain('title: Frontmatter Test');
    });
});

// ── Remembered Threads routes ─────────────────────────────────────────────────

describe('Phase 11 — Remembered Threads routes', () => {
    let threadId;

    beforeAll(async () => {
        const res = await request(app)
            .post('/api/threads')
            .send({ title: 'Remembrance Test Thread', room: 'hearth' });
        threadId = res.body.thread.id;

        await request(app)
            .post('/api/threads/' + threadId + '/messages')
            .send({ role: 'user', content: 'Green Fire mysteries are numerous and ancient.' });

        await request(app).post('/api/threads/' + threadId + '/remember');
    });

    test('GET /api/remembered-threads returns summaries', async () => {
        const res = await request(app).get('/api/remembered-threads');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.summaries)).toBe(true);
        expect(res.body.summaries.length).toBeGreaterThan(0);
    });

    test('GET /api/remembered-threads/:id returns specific summary', async () => {
        const res = await request(app).get('/api/remembered-threads/' + threadId);
        expect(res.status).toBe(200);
        expect(res.body.summary.id).toBe(threadId);
        expect(res.body.summary.title).toBe('Remembrance Test Thread');
    });

    test('GET /api/remembered-threads/:id returns 404 for unknown id', async () => {
        const res = await request(app).get('/api/remembered-threads/nonexistent-xyz');
        expect(res.status).toBe(404);
    });
});

// ── Chat route — room-bounded context ────────────────────────────────────────

describe('Phase 11 — Chat route room-bounded context', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        axios.post.mockResolvedValue({ data: { message: { content: 'Test response' } } });
    });

    test('POST /api/chat accepts room parameter and returns room in response', async () => {
        const res = await request(app)
            .post('/api/chat')
            .send({ query: 'What is the archive?', room: 'hearth' });
        expect(res.status).toBe(200);
        expect(res.body.room).toBe('hearth');
    });

    test('POST /api/chat uses workshop room when specified', async () => {
        const res = await request(app)
            .post('/api/chat')
            .send({ query: 'Help me draft a document', room: 'workshop' });
        expect(res.status).toBe(200);
        expect(res.body.room).toBe('workshop');
    });

    test('POST /api/chat defaults to hearth room when no room specified', async () => {
        const res = await request(app)
            .post('/api/chat')
            .send({ query: 'Hello' });
        expect(res.status).toBe(200);
        expect(res.body.room).toBe('hearth');
    });

    test('POST /api/chat ignores invalid room and falls back to hearth', async () => {
        const res = await request(app)
            .post('/api/chat')
            .send({ query: 'Hello', room: 'dungeon' });
        expect(res.status).toBe(200);
        expect(res.body.room).toBe('hearth');
    });
});
