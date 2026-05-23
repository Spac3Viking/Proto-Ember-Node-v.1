const fs = require('fs');
const path = require('path');
const axios = require('axios');
const AdmZip = require('adm-zip');
const request = require('supertest');
const { app, MODEL, OLLAMA_CHAT_URL, OLLAMA_BASE_URL } = require('../app/server');
const { DATA_ROOT } = require('../app/storageConfig');
const { setSelectedModel, setModelRole } = require('../app/aiConfig');

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
        setModelRole('hearth', '');
        setModelRole('forge', '');
        setModelRole('scribe', '');
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
        setModelRole('hearth', '');
        setModelRole('forge', '');
        setModelRole('scribe', '');
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
        setModelRole('hearth', '');
        setModelRole('forge', '');
        setModelRole('scribe', '');
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
        expect(res.body.model_roles).toEqual({ hearth: 'gemma3:4b', forge: '', scribe: '' });
        expect(res.body.routing).toBeDefined();
        expect(res.body.routing.spark).toBe('hearth');
        expect(res.body.routing.archive).toBe('forge');
        expect(res.body.routing.code).toBe('scribe');
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
        expect(res.body).toMatchObject({
            provider: 'ollama',
            available: false,
            models: [],
            selected_model: null,
            error: 'Ollama is not running',
            model_roles: { hearth: 'gemma3:4b', forge: '', scribe: '' },
        });
        expect(res.body.routing).toBeDefined();
        expect(res.body.routing.spark).toBe('hearth');
        expect(res.body.routing.archive).toBe('forge');
        expect(res.body.routing.code).toBe('scribe');
    });
});

describe('POST /api/ai/models/roles', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSelectedModel('gemma3:4b');
        setModelRole('hearth', '');
        setModelRole('forge', '');
        setModelRole('scribe', '');
    });

    test('clears a role when model is empty (offline-safe)', async () => {
        const res = await request(app)
            .post('/api/ai/models/roles')
            .send({ role: 'forge', model: '' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.provider).toBe('ollama');
        expect(res.body.selected_model).toBe('gemma3:4b');
        expect(res.body.model_roles).toEqual({ hearth: 'gemma3:4b', forge: '', scribe: '' });
        expect(axios.get).not.toHaveBeenCalled();
    });

    test('rejects invalid role values', async () => {
        const res = await request(app)
            .post('/api/ai/models/roles')
            .send({ role: 'invalid', model: 'qwen2.5:14b' });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    test('sets a role when model exists in Ollama tags', async () => {
        axios.get.mockResolvedValue({
            data: { models: [{ name: 'gemma3:4b' }, { name: 'qwen2.5:14b' }] },
        });

        const res = await request(app)
            .post('/api/ai/models/roles')
            .send({ role: 'scribe', model: 'qwen2.5:14b' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.model_roles).toEqual({ hearth: 'gemma3:4b', forge: '', scribe: 'qwen2.5:14b' });
    });
});

describe('POST /api/ai/models/select', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSelectedModel('gemma3:4b');
        setModelRole('hearth', '');
        setModelRole('forge', '');
        setModelRole('scribe', '');
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

    test('POST /api/threshold/inbox/markdown saves pasted markdown into threshold inbox', async () => {
        const saveRes = await request(app)
            .post('/api/threshold/inbox/markdown')
            .send({
                filename: 'external-ai-response.md',
                markdown: '# External Response\n\nPortable handoff.',
            });
        expect(saveRes.status).toBe(200);
        expect(saveRes.body.success).toBe(true);
        expect(saveRes.body.file).toBeTruthy();
        expect(saveRes.body.file.path).toMatch(/^threshold\/inbox\/.+\.md$/);
        const savedPath = saveRes.body.file.path;

        const listRes = await request(app).get('/api/threshold/files');
        expect(listRes.status).toBe(200);
        const found = (listRes.body.files || []).find(f => f.path === savedPath);
        expect(found).toBeTruthy();
        expect(found.type).toBe('markdown');

        await request(app).delete('/api/threshold/files').send({ path: savedPath });
    });

    test('POST /api/threshold/inbox/markdown rejects empty markdown', async () => {
        const res = await request(app)
            .post('/api/threshold/inbox/markdown')
            .send({ filename: 'empty.md', markdown: '   ' });
        expect(res.status).toBe(400);
        expect(String(res.body.error || '')).toMatch(/markdown is required/i);
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
        expect(found.bootstrapDetected).toBe(false);

        await request(app).delete('/api/threshold/files').send({ path: handoffPath });
    });

    test('GET /api/threshold/files flags bootstrap markdown handoff', async () => {
        const bootstrapDoc = [
            '---',
            'title: Continuity Bootstrap',
            'type: bootstrap',
            'status: local',
            'source: ember-node',
            '---',
            '# Ember Node Continuity Bootstrap',
            '## Current Orientation',
            'Signal',
        ].join('\n');
        const upload = await request(app)
            .post('/api/threshold/import')
            .attach('files', Buffer.from(bootstrapDoc, 'utf8'), 'continuity-bootstrap.md');
        const bootstrapPath = upload.body.imported[0].path;

        const list = await request(app).get('/api/threshold/files');
        expect(list.status).toBe(200);
        const found = (list.body.files || []).find(f => f.path === bootstrapPath);
        expect(found).toBeTruthy();
        expect(found.bootstrapDetected).toBe(true);
        expect(found.sentinelLoadoutDetected).toBe(false);

        const useRes = await request(app)
            .post('/api/threshold/bootstrap/use')
            .send({ path: bootstrapPath, overwrite: true });
        expect(useRes.status).toBe(200);
        expect(useRes.body.success).toBe(true);
        expect(useRes.body.message).toMatch(/Bootstrap detected/i);
        expect(useRes.body.rollingBootstrap).toBeTruthy();

        await request(app).delete('/api/threshold/files').send({ path: bootstrapPath });
    });

    test('GET /api/threshold/files detects Sentinel Loadout Bootstrap markdown', async () => {
        const bootstrapDoc = [
            '---',
            'title: Sentinel Loadout Bootstrap',
            'type: bootstrap',
            'status: local',
            'source: ember-node',
            '---',
            '# Sentinel Loadout Bootstrap',
            '## Current Purpose',
            'Compact continuity profile.',
        ].join('\n');
        const upload = await request(app)
            .post('/api/threshold/import')
            .attach('files', Buffer.from(bootstrapDoc, 'utf8'), 'sentinel-loadout-bootstrap.md');
        const bootstrapPath = upload.body.imported[0].path;

        const list = await request(app).get('/api/threshold/files');
        expect(list.status).toBe(200);
        const found = (list.body.files || []).find(f => f.path === bootstrapPath);
        expect(found).toBeTruthy();
        expect(found.bootstrapDetected).toBe(true);
        expect(found.sentinelLoadoutDetected).toBe(true);

        await request(app).delete('/api/threshold/files').send({ path: bootstrapPath });
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
        expect(createRes.body.draft.manifest.id).toBe(draftId);
        expect(createRes.body.draft.manifest.title).toBe('Phase 16H-B Test Draft');
        expect(createRes.body.draft.manifest.type).toBe('local-cache-draft');
        expect(createRes.body.draft.manifest.status).toBe('draft');
        expect(createRes.body.draft.manifest.source).toBe('threshold');
        expect(createRes.body.draft.manifest.recommended_destination).toBe('archive/caches/' + draftId);
        expect(createRes.body.draft.manifest.purpose_summary).toBe('Portable local cache draft from Threshold.');
        expect(createRes.body.draft.manifest.cache_creation_flow).toEqual([
            'gather',
            'review',
            'summarize',
            'distill',
            'structure',
            'package',
        ]);
        expect(Array.isArray(createRes.body.draft.manifest.documents)).toBe(true);
        expect(createRes.body.draft.manifest.documents[0].path).toBe('documents/cache-draft-source.md');
        expect(createRes.body.draft.manifest.documents[0].status).toBe('unverified');

        const readmePath = path.join(DATA_ROOT, 'threshold', 'cache-drafts', draftId, 'README.md');
        const readme = fs.readFileSync(readmePath, 'utf8');
        expect(readme).toMatch(/## Purpose Summary \(1–5 lines\)/);
        expect(readme).toMatch(/## Cache Creation Flow/);
        expect(readme).toMatch(/gather → review → summarize → distill → structure → package/);
        expect(readme).toMatch(/## Distillation Readiness/);
        expect(readme).toMatch(/## Signal Quality Guidance/);
        expect(readme).toMatch(/## Markdown Handoff Lifecycle/);
        expect(readme).toMatch(/conversation → markdown → cache → distillation/);
        expect(readme).toMatch(/## Suggested Next Steps/);

        const listRes = await request(app).get('/api/threshold/cache-drafts');
        expect(listRes.status).toBe(200);
        const found = (listRes.body.drafts || []).find(d => d.id === draftId);
        expect(found).toBeTruthy();
        expect(found.manifest).toBeTruthy();
        expect(found.manifest.type).toBe('local-cache-draft');
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
        expect(createRes.body.draft.manifest.type).toBe('local-cache-draft');
        expect(createRes.body.draft.manifest.documents.map(doc => doc.path)).toEqual(['documents/multi-a.md', 'documents/multi-b.md']);
        expect(createRes.body.draft.files.documents).toEqual([
            'threshold/cache-drafts/' + multiDraftId + '/documents/multi-a.md',
            'threshold/cache-drafts/' + multiDraftId + '/documents/multi-b.md',
        ]);

        const listRes = await request(app).get('/api/threshold/cache-drafts');
        expect(listRes.status).toBe(200);
        const found = (listRes.body.drafts || []).find(d => d.id === multiDraftId);
        expect(found).toBeTruthy();
        expect(found.manifest.documents.map(doc => doc.path)).toEqual(['documents/multi-a.md', 'documents/multi-b.md']);
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
        expect(Array.isArray(createRes.body.draft.source_paths)).toBe(true);
        if (createRes.body.draft.source_paths[0]) importedPaths.push(createRes.body.draft.source_paths[0]);
        expect(Array.isArray(createRes.body.draft.manifest.documents)).toBe(true);
        expect(createRes.body.draft.manifest.documents.length).toBe(1);
        const createdDocPath = createRes.body.draft.manifest.documents[0].path;
        expect(createdDocPath).toMatch(/^documents\/text-block-handoff(?:-[0-9]+(?:-[0-9]+)?)?\.md$/);
        expect(createRes.body.draft.files.documents[0]).toMatch(
            new RegExp('^threshold/cache-drafts/' + textDraftId + '/documents/text-block-handoff(?:-[0-9]+(?:-[0-9]+)?)?\\.md$'),
        );
    });

    test('supports adding selected non-pdf files to existing draft and opening/removing draft documents', async () => {
        const txtUpload = await request(app)
            .post('/api/threshold/import')
            .attach('files', Buffer.from('plain threshold text', 'utf8'), 'draft-extra.txt');
        const jsonUpload = await request(app)
            .post('/api/threshold/import')
            .attach('files', Buffer.from(JSON.stringify({ k: 'v' }, null, 2), 'utf8'), 'draft-extra.json');
        expect(txtUpload.status).toBe(200);
        expect(jsonUpload.status).toBe(200);
        const txtPath = txtUpload.body.imported[0].path;
        const jsonPath = jsonUpload.body.imported[0].path;
        importedPaths.push(txtPath, jsonPath);

        const addRes = await request(app)
            .post('/api/threshold/cache-drafts/' + draftId + '/documents/add')
            .send({ paths: [txtPath, jsonPath] });
        expect(addRes.status).toBe(200);
        expect(addRes.body.success).toBe(true);
        expect(Array.isArray(addRes.body.draft.added)).toBe(true);
        expect(addRes.body.draft.added.length).toBe(2);
        expect(addRes.body.draft.added.map(doc => doc.path)).toEqual(
            expect.arrayContaining(['documents/draft-extra.txt', 'documents/draft-extra.json']),
        );

        const getRes = await request(app).get('/api/threshold/cache-drafts/' + draftId);
        expect(getRes.status).toBe(200);
        expect(getRes.body.success).toBe(true);
        expect(getRes.body.draft.manifest.documents.some(doc => doc.path === 'documents/draft-extra.txt')).toBe(true);
        expect(getRes.body.draft.manifest.documents.some(doc => doc.path === 'documents/draft-extra.json')).toBe(true);

        const readRes = await request(app)
            .get('/api/threshold/cache-drafts/' + draftId + '/documents/content')
            .query({ path: 'documents/draft-extra.json' });
        expect(readRes.status).toBe(200);
        expect(readRes.body.success).toBe(true);
        expect(readRes.body.path).toBe('threshold/cache-drafts/' + draftId + '/documents/draft-extra.json');
        expect(readRes.body.contentType).toBe('application/json');

        const removeRes = await request(app)
            .delete('/api/threshold/cache-drafts/' + draftId + '/documents')
            .send({ path: 'documents/draft-extra.txt' });
        expect(removeRes.status).toBe(200);
        expect(removeRes.body.success).toBe(true);
        expect(removeRes.body.updated.manifest.documents.some(doc => doc.path === 'documents/draft-extra.txt')).toBe(false);
    });

    test('exports cache draft as zip containing only normalized draft files', async () => {
        const hiddenFile = path.join(DATA_ROOT, 'threshold', 'cache-drafts', draftId, '.DS_Store');
        await fs.promises.writeFile(hiddenFile, 'junk', 'utf8');
        const artifactDir = path.join(DATA_ROOT, 'threshold', 'cache-drafts', draftId, 'artifacts', 'raw');
        await fs.promises.mkdir(artifactDir, { recursive: true });
        await fs.promises.writeFile(path.join(artifactDir, 'seed.txt'), 'artifact payload', 'utf8');

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
        expect(names).toContain(draftId + '/artifacts/raw/seed.txt');
        expect(names).not.toContain(draftId + '/.DS_Store');
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

    test('rejects cache install when export zip is missing documents/', async () => {
        const badDraftId = draftId + '-bad-no-docs';
        const badZip = new AdmZip();
        badZip.addFile(badDraftId + '/manifest.json', Buffer.from(JSON.stringify({ id: badDraftId }), 'utf8'));
        badZip.addFile(badDraftId + '/README.md', Buffer.from('# Missing documents', 'utf8'));
        const exportRelPath = 'exports/cache-drafts/' + badDraftId + '.zip';
        const absBadZipPath = path.join(DATA_ROOT, exportRelPath);
        await fs.promises.mkdir(path.dirname(absBadZipPath), { recursive: true });
        badZip.writeZip(absBadZipPath);

        const installRes = await request(app)
            .post('/api/threshold/cache-drafts/' + badDraftId + '/install')
            .send({ exportPath: exportRelPath });
        expect(installRes.status).toBe(400);
        expect(String(installRes.body.error || '')).toMatch(/missing documents/i);
    });

    test('rejects cache install when export zip includes continuity/ paths', async () => {
        const badDraftId = draftId + '-bad-continuity';
        const badZip = new AdmZip();
        badZip.addFile(badDraftId + '/manifest.json', Buffer.from(JSON.stringify({ id: badDraftId }), 'utf8'));
        badZip.addFile(badDraftId + '/README.md', Buffer.from('# Invalid continuity layer', 'utf8'));
        badZip.addFile(badDraftId + '/documents/valid.md', Buffer.from('# valid', 'utf8'));
        badZip.addFile(badDraftId + '/continuity/legacy.md', Buffer.from('# legacy', 'utf8'));
        const exportRelPath = 'exports/cache-drafts/' + badDraftId + '.zip';
        const absBadZipPath = path.join(DATA_ROOT, exportRelPath);
        await fs.promises.mkdir(path.dirname(absBadZipPath), { recursive: true });
        badZip.writeZip(absBadZipPath);

        const installRes = await request(app)
            .post('/api/threshold/cache-drafts/' + badDraftId + '/install')
            .send({ exportPath: exportRelPath });
        expect(installRes.status).toBe(400);
        expect(String(installRes.body.error || '')).toMatch(/continuity/i);
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
        const draftZipMulti = path.join(DATA_ROOT, 'exports', 'cache-drafts', draftId + '-multi.zip');
        const draftZipText = path.join(DATA_ROOT, 'exports', 'cache-drafts', draftId + '-text.zip');
        const badZipNoDocs = path.join(DATA_ROOT, 'exports', 'cache-drafts', draftId + '-bad-no-docs.zip');
        const badZipContinuity = path.join(DATA_ROOT, 'exports', 'cache-drafts', draftId + '-bad-continuity.zip');
        const badInstallNoDocs = path.join(DATA_ROOT, 'archive', 'caches', draftId + '-bad-no-docs');
        const badInstallContinuity = path.join(DATA_ROOT, 'archive', 'caches', draftId + '-bad-continuity');
        await fs.promises.rm(draftDir, { recursive: true, force: true });
        await fs.promises.rm(draftZip, { force: true });
        await fs.promises.rm(installDir, { recursive: true, force: true });
        await fs.promises.rm(multiDraftDir, { recursive: true, force: true });
        await fs.promises.rm(textDraftDir, { recursive: true, force: true });
        await fs.promises.rm(draftZipMulti, { force: true });
        await fs.promises.rm(draftZipText, { force: true });
        await fs.promises.rm(badZipNoDocs, { force: true });
        await fs.promises.rm(badZipContinuity, { force: true });
        await fs.promises.rm(badInstallNoDocs, { recursive: true, force: true });
        await fs.promises.rm(badInstallContinuity, { recursive: true, force: true });
    });
});

describe('System bootstrap export route', () => {
    test('GET /api/system/bootstrap/export-md returns markdown bootstrap download', async () => {
        const res = await request(app).get('/api/system/bootstrap/export-md');
        expect(res.status).toBe(200);
        expect(String(res.headers['content-type'] || '')).toMatch(/text\/markdown/i);
        expect(res.text).toMatch(/# Ember Node Continuity Bootstrap/);
        expect(res.text).toMatch(/type: bootstrap/);
    });
});

describe('Sentinel loadout bootstrap routes', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('POST /api/bootstrap/sentinel/ignite generates sentinel markdown', async () => {
        const res = await request(app)
            .post('/api/bootstrap/sentinel/ignite')
            .send({});
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.path).toBe('system/bootstrap/sentinel-loadout-bootstrap.md');
        expect(res.body.markdown).toMatch(/# Sentinel Loadout Bootstrap/);
        expect(res.body.markdown).toMatch(/## Runtime Profile/);
        expect(res.body.markdown).toMatch(/Balanced Ember/);
        expect(res.body.markdown).toMatch(/## External AI Instructions/);

        const absPath = path.join(DATA_ROOT, 'system', 'bootstrap', 'sentinel-loadout-bootstrap.md');
        expect(fs.existsSync(absPath)).toBe(true);
    });

    test('GET /api/bootstrap/sentinel/download returns markdown download', async () => {
        await request(app).post('/api/bootstrap/sentinel/ignite').send({});
        const res = await request(app).get('/api/bootstrap/sentinel/download');
        expect(res.status).toBe(200);
        expect(String(res.headers['content-type'] || '')).toMatch(/text\/markdown/i);
        expect(res.text).toMatch(/title: Sentinel Loadout Bootstrap/);
        expect(res.text).toMatch(/## Response Discipline/);
        expect(res.text).toMatch(/## Runtime Profile/);
    });

    test('chat prompt assembly can include sentinel loadout summary when available', async () => {
        await request(app).post('/api/bootstrap/sentinel/ignite').send({});
        axios.post.mockResolvedValue({ data: { message: { content: 'ok' } } });

        const chatRes = await request(app)
            .post('/api/chat')
            .send({ query: 'Use continuity posture.', responseDepth: 'ember' });

        expect(chatRes.status).toBe(200);
        const payload = axios.post.mock.calls[0][1];
        const userPrompt = payload && payload.messages && payload.messages[1]
            ? String(payload.messages[1].content || '')
            : '';
        expect(userPrompt).toContain('=== Sentinel Loadout Bootstrap Summary ===');
    });
});
