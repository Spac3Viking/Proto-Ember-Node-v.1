const axios = require('axios');
const request = require('supertest');
const { app, MODEL, OLLAMA_CHAT_URL, OLLAMA_BASE_URL } = require('../app/server');
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
