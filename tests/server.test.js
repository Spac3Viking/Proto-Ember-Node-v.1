const fs = require('fs');
const path = require('path');
const axios = require('axios');
const AdmZip = require('adm-zip');
const request = require('supertest');
const { app, MODEL, OLLAMA_CHAT_URL, OLLAMA_BASE_URL } = require('../app/server');
const { DATA_ROOT } = require('../app/storageConfig');
const { setSelectedModel } = require('../app/aiConfig');

jest.mock('axios');

describe('Ollama model configuration', () => {
    test('MODEL constant is gemma3:4b', () => {
        expect(MODEL).toBe('gemma3:4b');
    });

    test('OLLAMA_CHAT_URL uses the /api/chat endpoint', () => {
        expect(OLLAMA_CHAT_URL).toBe(`${OLLAMA_BASE_URL}/api/chat`);
    });

    test('OLLAMA_BASE_URL points to localhost:11434', () => {
        expect(OLLAMA_BASE_URL).toBe('http://localhost:11434');
    });
});

describe('POST /chat enforces gemma3:4b model', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSelectedModel('gemma3:4b');
    });

    test('injects the configured model into every Ollama request', async () => {
        axios.post.mockResolvedValue({ data: { message: { content: 'Hello!' } } });

        const res = await request(app)
            .post('/chat')
            .send({ message: 'Hello Ember' });

        expect(res.status).toBe(200);
        const [url, payload] = axios.post.mock.calls[0];
        expect(url).toBe(OLLAMA_CHAT_URL);
        expect(payload.model).toBe('gemma3:4b');
    });

    test('model cannot be overridden by client request body', async () => {
        axios.post.mockResolvedValue({ data: { message: { content: 'Hi' } } });

        await request(app)
            .post('/chat')
            .send({ message: 'test', model: 'some-other-model' });

        const [, payload] = axios.post.mock.calls[0];
        expect(payload.model).toBe('gemma3:4b');
    });

    test('returns 500 when Ollama is unreachable', async () => {
        axios.post.mockRejectedValue(new Error('connect ECONNREFUSED'));

        const res = await request(app)
            .post('/chat')
            .send({ message: 'ping' });

        expect(res.status).toBe(500);
    });

    test('uses selected model config when changed', async () => {
        setSelectedModel('llama3.2:3b');
        axios.post.mockResolvedValue({ data: { message: { content: 'Hi' } } });

        const res = await request(app)
            .post('/chat')
            .send({ message: 'test' });

        expect(res.status).toBe(200);
        const [, payload] = axios.post.mock.calls[0];
        expect(payload.model).toBe('llama3.2:3b');
    });
});

describe('GET /api/status', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSelectedModel('gemma3:4b');
    });

    test('returns 200 with model, cacheCount, and port', async () => {
        const res = await request(app).get('/api/status');
        expect(res.status).toBe(200);
        expect(res.body.model).toBe('gemma3:4b');
        expect(typeof res.body.cacheCount).toBe('number');
        expect(res.body.cacheCount).toBeGreaterThan(0);
        expect(res.body.port).toBe(3477);
    });
});

describe('GET /api/court', () => {
    test('returns ember court configuration payload', async () => {
        const res = await request(app).get('/api/court');
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('court');
        expect(res.body.court.courtName).toBe('Ember Court');
        expect(Array.isArray(res.body.court.members)).toBe(true);
        expect(res.body.court.members.length).toBeGreaterThanOrEqual(5);
    });
});

describe('GET /api/ai/models', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSelectedModel('gemma3:4b');
    });

    test('returns provider, availability, models and selected model when Ollama is reachable', async () => {
        axios.get.mockResolvedValue({
            data: {
                models: [
                    { name: 'gemma3:4b', size: 123456, modified_at: '2026-01-01T00:00:00Z' },
                    { name: 'llama3.2:3b', size: 987654, modified_at: '2026-01-02T00:00:00Z' },
                ],
            },
        });
        const res = await request(app).get('/api/ai/models');
        expect(res.status).toBe(200);
        expect(res.body.provider).toBe('ollama');
        expect(res.body.available).toBe(true);
        expect(res.body.selected_model).toBe('gemma3:4b');
        expect(Array.isArray(res.body.models)).toBe(true);
        expect(res.body.models[0]).toEqual({
            name: 'gemma3:4b',
            size: '123456',
            modified_at: '2026-01-01T00:00:00Z',
        });
    });

    test('returns unavailable payload when Ollama is not running', async () => {
        axios.get.mockRejectedValue(new Error('ECONNREFUSED'));
        const res = await request(app).get('/api/ai/models');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({
            provider: 'ollama',
            available: false,
            models: [],
            selected_model: null,
            error: 'Ollama is not running',
        });
    });
});

describe('POST /api/ai/models/select', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSelectedModel('gemma3:4b');
    });

    test('updates selected model when model exists in Ollama tags', async () => {
        axios.get.mockResolvedValue({
            data: {
                models: [
                    { name: 'gemma3:4b' },
                    { name: 'llama3.2:3b' },
                ],
            },
        });
        const res = await request(app)
            .post('/api/ai/models/select')
            .send({ model: 'llama3.2:3b' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.selected_model).toBe('llama3.2:3b');
    });

    test('rejects selection when model is not installed', async () => {
        axios.get.mockResolvedValue({
            data: { models: [{ name: 'gemma3:4b' }] },
        });
        const res = await request(app)
            .post('/api/ai/models/select')
            .send({ model: 'not-installed:1b' });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/not installed/i);
    });

    test('returns 503 when Ollama is unavailable', async () => {
        axios.get.mockRejectedValue(new Error('ECONNREFUSED'));
        const res = await request(app)
            .post('/api/ai/models/select')
            .send({ model: 'gemma3:4b' });

        expect(res.status).toBe(503);
        expect(res.body.error).toBe('Ollama is not running');
    });
});

describe('GET /api/ollama-status', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('returns 200 when Ollama is reachable', async () => {
        axios.get.mockResolvedValue({ data: { models: [] } });
        const res = await request(app).get('/api/ollama-status');
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('reachable');
    });

    test('returns 503 when Ollama is unreachable', async () => {
        axios.get.mockRejectedValue(new Error('ECONNREFUSED'));
        const res = await request(app).get('/api/ollama-status');
        expect(res.status).toBe(503);
        expect(res.body.status).toBe('unreachable');
    });
});

describe('GET /api/system/node-status-updates', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('returns app/update/cache summary payload', async () => {
        axios.get.mockImplementation((url) => {
            if (url.includes('/releases/latest')) {
                return Promise.resolve({ data: { tag_name: 'v1.1.0' } });
            }
            if (url.includes('/downloads/index.json')) {
                return Promise.resolve({
                    data: {
                        packages: [
                            {
                                id: 'green-fire-core',
                                version: '1.1.0',
                                title: 'Green Fire Core',
                                download_url: 'https://greenfire-archive.replit.app/downloads/green-fire-core.zip',
                            },
                        ],
                    },
                });
            }
            return Promise.resolve({ data: {} });
        });

        const res = await request(app).get('/api/system/node-status-updates');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(typeof res.body.currentAppVersion).toBe('string');
        expect(res.body).toHaveProperty('updateStatus');
        expect(Array.isArray(res.body.cacheStatuses)).toBe(true);
        expect(res.body.cacheStatuses.length).toBeGreaterThan(0);
    });
});

describe('POST /api/system/shutdown', () => {
    test('returns success message for local shutdown request', async () => {
        const res = await request(app).post('/api/system/shutdown').send({});
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.message).toMatch(/returning to slumber/i);
    });
});

describe('Threshold inbox import + reader endpoints', () => {
    let importedPath = null;

    test('POST /api/threshold/import imports markdown upload', async () => {
        const res = await request(app)
            .post('/api/threshold/import')
            .attach('files', Buffer.from('# Field Notes\n\nHello Threshold\n', 'utf8'), 'field-notes.md');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.imported)).toBe(true);
        expect(res.body.imported.length).toBe(1);
        expect(res.body.imported[0].type).toBe('markdown');
        expect(res.body.imported[0].path).toMatch(/^threshold\/inbox\/.+\.md$/);
        importedPath = res.body.imported[0].path;
    });

    test('GET /api/threshold/files lists imported inbox files', async () => {
        const res = await request(app).get('/api/threshold/files');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.files)).toBe(true);
        const found = res.body.files.find(f => f.path === importedPath);
        expect(found).toBeTruthy();
        expect(found.name).toBeDefined();
        expect(found.imported_at).toBeDefined();
    });

    test('GET /api/threshold/files/content reads markdown for reader', async () => {
        const res = await request(app)
            .get('/api/threshold/files/content')
            .query({ path: importedPath });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.sourceLabel).toBe('Threshold');
        expect(res.body.contentType).toBe('text/markdown');
        expect(res.body.title).toBe('Field Notes');
        expect(res.body.content).toMatch(/Field Notes/);
    });

    test('GET /api/threshold/files/content falls back to frontmatter title when H1 is missing', async () => {
        const upload = await request(app)
            .post('/api/threshold/import')
            .attach('files', Buffer.from('---\ntitle: Ember Memo\n---\nBody\n', 'utf8'), 'memo.md');
        const memoPath = upload.body.imported[0].path;
        const res = await request(app)
            .get('/api/threshold/files/content')
            .query({ path: memoPath });
        expect(res.status).toBe(200);
        expect(res.body.title).toBe('Ember Memo');
        await request(app).delete('/api/threshold/files').send({ path: memoPath });
    });

    test('GET /api/threshold/files detects Green Fire handoff frontmatter', async () => {
        const handoffDoc = [
            '---',
            'title: Builder Handoff',
            'type: research-brief',
            'source: local notes',
            'created: 2026-05-10',
            'status: reviewed',
            'archetypes: builder, scribe',
            'tags: ember, threshold',
            'license: CC-BY-4.0',
            '---',
            '# Summary',
            'Signal',
        ].join('\n');
        const upload = await request(app)
            .post('/api/threshold/import')
            .attach('files', Buffer.from(handoffDoc, 'utf8'), 'builder-handoff.md');
        const handoffPath = upload.body.imported[0].path;

        const list = await request(app).get('/api/threshold/files');
        expect(list.status).toBe(200);
        const found = (list.body.files || []).find(f => f.path === handoffPath);
        expect(found).toBeTruthy();
        expect(found.handoff).toBeTruthy();
        expect(found.handoff.detected).toBe(true);
        expect(found.handoff.type).toBe('research-brief');
        expect(found.handoff.status).toBe('reviewed');
        expect(found.handoff.archetypes).toEqual(['builder', 'scribe']);
        expect(found.handoff.tags).toEqual(['ember', 'threshold']);
        expect(found.handoff.source).toBe('local notes');
        expect(found.handoff.license).toBe('CC-BY-4.0');

        await request(app).delete('/api/threshold/files').send({ path: handoffPath });
    });

    test('GET /api/threshold/files/content returns handoff metadata for reader display', async () => {
        const handoffDoc = [
            '---',
            'title: Research Brief',
            'type: field-note',
            'status: local',
            'source: signal capture',
            'archetypes: scholar',
            'tags: note, field',
            'license: proprietary',
            '---',
            '# Summary',
            'Captured.',
        ].join('\n');
        const upload = await request(app)
            .post('/api/threshold/import')
            .attach('files', Buffer.from(handoffDoc, 'utf8'), 'research-brief.md');
        const handoffPath = upload.body.imported[0].path;

        const res = await request(app)
            .get('/api/threshold/files/content')
            .query({ path: handoffPath });

        expect(res.status).toBe(200);
        expect(res.body.handoff).toBeTruthy();
        expect(res.body.handoff.detected).toBe(true);
        expect(res.body.handoff.type).toBe('field-note');
        expect(res.body.handoff.status).toBe('local');
        expect(res.body.handoff.archetypes).toEqual(['scholar']);
        expect(res.body.handoff.tags).toEqual(['note', 'field']);
        expect(res.body.handoff.source).toBe('signal capture');
        expect(res.body.handoff.license).toBe('proprietary');

        await request(app).delete('/api/threshold/files').send({ path: handoffPath });
    });

    test('DELETE /api/threshold/files deletes imported inbox file', async () => {
        const del = await request(app)
            .delete('/api/threshold/files')
            .send({ path: importedPath });
        expect(del.status).toBe(200);
        expect(del.body.success).toBe(true);

        const list = await request(app).get('/api/threshold/files');
        const found = (list.body.files || []).find(f => f.path === importedPath);
        expect(found).toBeFalsy();
    });

    test('POST /api/threshold/import rejects unsupported extension', async () => {
        const res = await request(app)
            .post('/api/threshold/import')
            .attach('files', Buffer.from('bad', 'utf8'), 'bad.exe');
        expect(res.status).toBe(400);
        expect(String(res.body.error || '')).toMatch(/Unsupported file type/i);
    });
});

describe('Threshold cache draft workflow', () => {
    const draftId = 'phase-16h-b-test-cache-draft';
    const importedPaths = [];

    test('creates cache draft from threshold markdown and writes manifest + readme', async () => {
        const upload = await request(app)
            .post('/api/threshold/import')
            .attach('files', Buffer.from('# Draft Seed\n\nFrom threshold.', 'utf8'), 'cache-draft-source.md');
        expect(upload.status).toBe(200);
        const importedPath = upload.body.imported[0].path;
        importedPaths.push(importedPath);

        const createRes = await request(app)
            .post('/api/threshold/cache-drafts')
            .send({
                path: importedPath,
                draftId,
                title: 'Phase 16H-B Test Draft',
                description: 'Portable local cache draft from Threshold.',
            });
        expect(createRes.status).toBe(200);
        expect(createRes.body.success).toBe(true);
        expect(createRes.body.draft.id).toBe(draftId);
        expect(createRes.body.draft.files.manifest).toBe('threshold/cache-drafts/' + draftId + '/manifest.json');
        expect(createRes.body.draft.files.readme).toBe('threshold/cache-drafts/' + draftId + '/README.md');
        expect(Array.isArray(createRes.body.draft.files.documents)).toBe(true);
        expect(createRes.body.draft.files.documents.length).toBe(1);
        expect(createRes.body.draft.files.documents[0]).toBe('threshold/cache-drafts/' + draftId + '/documents/cache-draft-source.md');
        expect(createRes.body.draft.manifest.source.path).toBe(importedPath);
        expect(createRes.body.draft.manifest.source.paths).toEqual([importedPath]);
        expect(createRes.body.draft.manifest.continuity.markdownCenter).toBe(true);
        expect(createRes.body.draft.manifest.continuity.primary).toBe('documents/cache-draft-source.md');
        expect(createRes.body.draft.manifest.continuity.documents).toEqual(['documents/cache-draft-source.md']);

        const listRes = await request(app).get('/api/threshold/cache-drafts');
        expect(listRes.status).toBe(200);
        const found = (listRes.body.drafts || []).find(d => d.id === draftId);
        expect(found).toBeTruthy();
        expect(found.manifest).toBeTruthy();
        expect(found.manifest.type).toBe('cache-draft');
    });

    test('creates multi-file cache draft from threshold markdown paths array', async () => {
        const first = await request(app)
            .post('/api/threshold/import')
            .attach('files', Buffer.from('# Part A\n\nAlpha.', 'utf8'), 'multi-a.md');
        const second = await request(app)
            .post('/api/threshold/import')
            .attach('files', Buffer.from('# Part B\n\nBeta.', 'utf8'), 'multi-b.md');
        expect(first.status).toBe(200);
        expect(second.status).toBe(200);

        const firstPath = first.body.imported[0].path;
        const secondPath = second.body.imported[0].path;
        importedPaths.push(firstPath, secondPath);

        const multiDraftId = draftId + '-multi';
        const createRes = await request(app)
            .post('/api/threshold/cache-drafts')
            .send({
                draftId: multiDraftId,
                paths: [firstPath, secondPath],
                title: 'Phase 16H-C Multi Draft',
            });
        expect(createRes.status).toBe(200);
        expect(createRes.body.success).toBe(true);
        expect(createRes.body.draft.id).toBe(multiDraftId);
        expect(createRes.body.draft.manifest.source.path).toBe(firstPath);
        expect(createRes.body.draft.manifest.source.paths).toEqual([firstPath, secondPath]);
        expect(createRes.body.draft.manifest.continuity.markdownCenter).toBe(true);
        expect(createRes.body.draft.manifest.continuity.documents).toEqual([
            'documents/multi-a.md',
            'documents/multi-b.md',
        ]);
        expect(createRes.body.draft.files.documents).toEqual([
            'threshold/cache-drafts/' + multiDraftId + '/documents/multi-a.md',
            'threshold/cache-drafts/' + multiDraftId + '/documents/multi-b.md',
        ]);

        const listRes = await request(app).get('/api/threshold/cache-drafts');
        expect(listRes.status).toBe(200);
        const found = (listRes.body.drafts || []).find(d => d.id === multiDraftId);
        expect(found).toBeTruthy();
        expect(found.manifest.continuity.documents).toEqual(['documents/multi-a.md', 'documents/multi-b.md']);
    });

    test('creates cache draft directly from markdown text block and stages inbox .md source', async () => {
        const textDraftId = draftId + '-text';
        const createRes = await request(app)
            .post('/api/threshold/cache-drafts')
            .send({
                draftId: textDraftId,
                markdownFilename: 'text-block-handoff',
                markdown: '# Text Block Draft\n\nCreated from pasted markdown.',
                title: 'Phase 16H-D Text Draft',
            });

        expect(createRes.status).toBe(200);
        expect(createRes.body.success).toBe(true);
        expect(createRes.body.draft.id).toBe(textDraftId);
        expect(createRes.body.draft.path).toBe('threshold/cache-drafts/' + textDraftId);

        const sourcePath = createRes.body.draft.manifest.source.path;
        expect(sourcePath).toMatch(/^threshold\/inbox\/text-block-handoff(?:-[0-9]+(?:-[0-9]+)?)?\.md$/);
        importedPaths.push(sourcePath);

        expect(createRes.body.draft.manifest.source.paths).toEqual([sourcePath]);
        expect(createRes.body.draft.manifest.continuity.markdownCenter).toBe(true);
        expect(Array.isArray(createRes.body.draft.manifest.continuity.documents)).toBe(true);
        expect(createRes.body.draft.manifest.continuity.documents.length).toBe(1);
        expect(createRes.body.draft.files.documents[0]).toMatch(
            new RegExp('^threshold/cache-drafts/' + textDraftId + '/documents/text-block-handoff(?:-[0-9]+(?:-[0-9]+)?)?\\.md$'),
        );
    });

    test('exports cache draft as zip containing only normalized draft files', async () => {
        const res = await request(app)
            .post('/api/threshold/cache-drafts/' + draftId + '/export')
            .send({});
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.exported.exportPath).toBe('exports/cache-drafts/' + draftId + '.zip');

        const absZipPath = path.join(DATA_ROOT, res.body.exported.exportPath);
        expect(fs.existsSync(absZipPath)).toBe(true);
        const zip = new AdmZip(absZipPath);
        const names = zip.getEntries().map(entry => entry.entryName);
        expect(names).toContain(draftId + '/manifest.json');
        expect(names).toContain(draftId + '/README.md');
        expect(names).toContain(draftId + '/documents/cache-draft-source.md');
        expect(names).not.toContain(draftId + '/handoff.md');
        expect(names.some(name => name.startsWith(draftId + '/docs/'))).toBe(false);
    });

    test('installs exported draft zip into archive/caches/<id>', async () => {
        const installRes = await request(app)
            .post('/api/threshold/cache-drafts/' + draftId + '/install')
            .send({});
        expect(installRes.status).toBe(200);
        expect(installRes.body.success).toBe(true);
        expect(installRes.body.installed.installedPath).toBe('archive/caches/' + draftId);
        expect(installRes.body.installed.manifest).toBeTruthy();
        expect(installRes.body.installed.manifest.id).toBe(draftId);

        const catalog = await request(app).get('/api/archive/reader/catalog');
        expect(catalog.status).toBe(200);
        const cacheRoot = (catalog.body.roots || []).find(root => root.id === 'archive-caches');
        const installedCache = (cacheRoot && cacheRoot.caches ? cacheRoot.caches : [])
            .find(cache => cache.cacheId === draftId);
        const hasInstalledReadme = Boolean(
            installedCache &&
            Array.isArray(installedCache.files) &&
            installedCache.files.some(entry => entry.sourcePath === 'archive/caches/' + draftId + '/README.md'),
        );
        expect(hasInstalledReadme).toBe(true);
    });

    afterAll(async () => {
        for (const importedPath of importedPaths) {
            if (!importedPath) continue;
            await request(app).delete('/api/threshold/files').send({ path: importedPath });
        }
        const draftDir = path.join(DATA_ROOT, 'threshold', 'cache-drafts', draftId);
        const draftZip = path.join(DATA_ROOT, 'exports', 'cache-drafts', draftId + '.zip');
        const installDir = path.join(DATA_ROOT, 'archive', 'caches', draftId);
        const multiDraftDir = path.join(DATA_ROOT, 'threshold', 'cache-drafts', draftId + '-multi');
        const textDraftDir = path.join(DATA_ROOT, 'threshold', 'cache-drafts', draftId + '-text');
        await fs.promises.rm(draftDir, { recursive: true, force: true });
        await fs.promises.rm(draftZip, { force: true });
        await fs.promises.rm(installDir, { recursive: true, force: true });
        await fs.promises.rm(multiDraftDir, { recursive: true, force: true });
        await fs.promises.rm(textDraftDir, { recursive: true, force: true });
    });
});
