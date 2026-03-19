const axios = require('axios');
const request = require('supertest');
const { app, MODEL, OLLAMA_CHAT_URL, OLLAMA_BASE_URL } = require('../app/server');

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
});

describe('GET /api/status', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('returns 200 with model, cartridgeCount, and port', async () => {
        const res = await request(app).get('/api/status');
        expect(res.status).toBe(200);
        expect(res.body.model).toBe('gemma3:4b');
        expect(typeof res.body.cartridgeCount).toBe('number');
        expect(res.body.cartridgeCount).toBeGreaterThan(0);
        expect(res.body.port).toBe(3477);
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

/* ─────────────────────────────────────────────────────────────────
   Phase 6 — Detected Files Endpoints
   ─────────────────────────────────────────────────────────────── */

describe('GET /api/detected-files', () => {
    test('returns 200 with unmanaged and changed arrays', async () => {
        const res = await request(app).get('/api/detected-files');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.unmanaged)).toBe(true);
        expect(Array.isArray(res.body.changed)).toBe(true);
    });
});

describe('POST /api/detected-files/import', () => {
    test('returns 400 when filename is missing', async () => {
        const res = await request(app)
            .post('/api/detected-files/import')
            .send({ room: 'threshold' });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/filename/i);
    });

    test('returns 400 when room is invalid', async () => {
        const res = await request(app)
            .post('/api/detected-files/import')
            .send({ filename: 'test.txt', room: 'invalid-room' });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/room/i);
    });

    test('returns 404 when file does not exist on disk', async () => {
        const res = await request(app)
            .post('/api/detected-files/import')
            .send({ filename: 'nonexistent-file-xyz.txt', room: 'threshold' });
        expect(res.status).toBe(404);
    });
});

describe('POST /api/detected-files/acknowledge', () => {
    test('returns 400 when sourceId is missing', async () => {
        const res = await request(app)
            .post('/api/detected-files/acknowledge')
            .send({});
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/sourceId/i);
    });

    test('returns 404 when source is not in manifest', async () => {
        const res = await request(app)
            .post('/api/detected-files/acknowledge')
            .send({ sourceId: 'nonexistent-source-id-xyz' });
        expect(res.status).toBe(404);
    });
});
