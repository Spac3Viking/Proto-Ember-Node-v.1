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
});
