'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');

jest.mock('axios');

describe('Phase 23 — deliberate Signal Thread AI consultation', () => {
    let dataRoot;
    let axios;

    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-phase23-test-'));
        process.env.EMBER_NODE_DATA_ROOT = dataRoot;
        delete process.env.EMBER_DATA_ROOT;
        axios = require('axios');
    });

    afterEach(() => {
        delete process.env.EMBER_NODE_DATA_ROOT;
        delete process.env.EMBER_DATA_ROOT;
        fs.rmSync(dataRoot, { recursive: true, force: true });
    });

    async function createThread(app) {
        const created = await request(app).post('/api/signal-threads')
            .send({ title: 'Water repair', posture: 'practical', currentStage: 'reflect' });
        expect(created.status).toBe(200);
        return created.body.thread.id;
    }

    test('records manual quotation attribution and saves an AI response using only selected entries', async () => {
        const { app } = require('../app/server');
        const id = await createThread(app);
        const selected = await request(app).post('/api/signal-threads/' + id + '/entries').send({
            stage: 'reflect', kind: 'quotation', attribution: 'Field manual',
            content: 'Keep the intake pipe clear.',
        });
        await request(app).post('/api/signal-threads/' + id + '/entries').send({
            stage: 'reflect', content: 'This must not reach the model.',
        });
        axios.get.mockResolvedValue({ data: { models: [{ name: 'gemma3:4b' }] } });
        axios.post.mockResolvedValue({ data: { message: { content: 'Inspect and clear the intake pipe.' } } });

        const answer = await request(app).post('/api/signal-threads/' + id + '/ask-ai').send({
            question: 'What should I do first?',
            requestId: 'request-1',
            selectedEntryIds: [selected.body.entry.id],
        });

        expect(answer.status).toBe(200);
        expect(answer.body.entry).toEqual(expect.objectContaining({
            kind: 'ai', model: 'gemma3:4b', content: 'Inspect and clear the intake pipe.',
        }));
        expect(answer.body.entry.provenance).toEqual(expect.objectContaining({
            question: 'What should I do first?',
            selectedEntryIds: [selected.body.entry.id],
            requestedAt: expect.any(String),
        }));
        const sent = axios.post.mock.calls[0][1].messages[1].content;
        expect(sent).toContain('Keep the intake pipe clear.');
        expect(sent).not.toContain('This must not reach the model.');

        const reopened = await request(app).get('/api/signal-threads/' + id);
        expect(reopened.body.thread.entries).toEqual(expect.arrayContaining([
            expect.objectContaining({ kind: 'quotation', attribution: 'Field manual' }),
            expect.objectContaining({ kind: 'ai', model: 'gemma3:4b' }),
        ]));
        const exported = await request(app).get('/api/signal-threads/' + id + '/export');
        expect(exported.text).toContain('quotation · Field manual');
        expect(exported.text).toContain('AI response');
        expect(exported.text).toContain('Question: What should I do first?');
        expect(exported.text).toContain('Selected entry IDs: ' + selected.body.entry.id);
    });

    test('reports unavailable models without changing the saved record', async () => {
        const { app } = require('../app/server');
        const id = await createThread(app);
        axios.get.mockResolvedValue({ data: { models: [] } });

        const answer = await request(app).post('/api/signal-threads/' + id + '/ask-ai').send({
            question: 'Can you help?', requestId: 'request-2', selectedEntryIds: [],
        });

        expect(answer.status).toBe(503);
        expect(answer.body.error).toMatch(/Configured local model is unavailable/);
        expect(axios.post).not.toHaveBeenCalled();
        expect((await request(app).get('/api/signal-threads/' + id)).body.thread.entries).toEqual([]);
    });

    test('cancels an in-flight request without saving an AI response', async () => {
        const { app } = require('../app/server');
        const id = await createThread(app);
        axios.get.mockResolvedValue({ data: { models: [{ name: 'gemma3:4b' }] } });
        let started;
        const startedRequest = new Promise(resolve => { started = resolve; });
        axios.post.mockImplementation((_url, _body, config) => new Promise((_resolve, reject) => {
            started();
            config.signal.addEventListener('abort', () => reject(new Error('cancelled')));
        }));

        const answer = request(app).post('/api/signal-threads/' + id + '/ask-ai').send({
            question: 'Can this wait?', requestId: 'request-3', selectedEntryIds: [],
        }).then(response => response);
        await startedRequest;
        const cancelled = await request(app).post('/api/signal-threads/' + id + '/ask-ai/cancel')
            .send({ requestId: 'request-3' });

        expect(cancelled.body).toEqual({ success: true, cancelled: true });
        expect((await answer).status).toBe(409);
        expect((await request(app).get('/api/signal-threads/' + id)).body.thread.entries).toEqual([]);
    });

    test('keeps a newer human-selected stage while recording the request stage', async () => {
        const { app } = require('../app/server');
        const id = await createThread(app);
        axios.get.mockResolvedValue({ data: { models: [{ name: 'gemma3:4b' }] } });
        let release;
        const completion = new Promise(resolve => { release = resolve; });
        let started;
        const startedInference = new Promise(resolve => { started = resolve; });
        axios.post.mockImplementation(() => {
            started();
            return completion;
        });

        const answer = request(app).post('/api/signal-threads/' + id + '/ask-ai').send({
            question: 'What is next?', requestId: 'request-stage', selectedEntryIds: [],
        }).then(response => response);
        await startedInference;
        await request(app).put('/api/signal-threads/' + id).send({ currentStage: 'act' });
        release({ data: { message: { content: 'Continue deliberately.' } } });

        expect((await answer).status).toBe(200);
        const reopened = await request(app).get('/api/signal-threads/' + id);
        expect(reopened.body.thread.currentStage).toBe('act');
        expect(reopened.body.thread.entries[0]).toEqual(expect.objectContaining({
            stage: 'reflect',
            provenance: expect.objectContaining({ question: 'What is next?' }),
        }));
    });

    test('cancels while probing the runtime before inference begins', async () => {
        const { app } = require('../app/server');
        const id = await createThread(app);
        let releaseProbe;
        let started;
        const startedProbe = new Promise(resolve => { started = resolve; });
        axios.get.mockImplementation(() => new Promise(resolve => {
            releaseProbe = resolve;
            started();
        }));

        const answer = request(app).post('/api/signal-threads/' + id + '/ask-ai').send({
            question: 'Can this wait?', requestId: 'request-probe', selectedEntryIds: [],
        }).then(response => response);
        await startedProbe;
        const cancelled = await request(app).post('/api/signal-threads/' + id + '/ask-ai/cancel')
            .send({ requestId: 'request-probe' });
        releaseProbe({ data: { models: [{ name: 'gemma3:4b' }] } });

        expect(cancelled.body).toEqual({ success: true, cancelled: true });
        expect((await answer).status).toBe(409);
        expect(axios.post).not.toHaveBeenCalled();
        expect((await request(app).get('/api/signal-threads/' + id)).body.thread.entries).toEqual([]);
    });
});
