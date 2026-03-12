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
