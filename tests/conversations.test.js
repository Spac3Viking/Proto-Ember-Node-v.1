'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');

jest.mock('axios');

describe('local conversations', () => {
    let dataRoot;

    beforeEach(() => {
        jest.resetModules();
        dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-conversations-test-'));
        process.env.EMBER_NODE_DATA_ROOT = dataRoot;
    });

    afterEach(() => {
        delete process.env.EMBER_NODE_DATA_ROOT;
        fs.rmSync(dataRoot, { recursive: true, force: true });
    });

    test('persists, reopens, renames, exports, and deletes a chat', async () => {
        const { app } = require('../app/server');
        const created = await request(app).post('/api/conversations').send({ title: 'Water notes' }).expect(201);
        const id = created.body.conversation.id;

        await request(app).post('/api/conversations/' + id + '/messages')
            .send({ role: 'user', content: 'Check the rain barrel.' }).expect(201);
        await request(app).put('/api/conversations/' + id).send({ title: 'Rain barrel' }).expect(200);

        const reopened = await request(app).get('/api/conversations/' + id).expect(200);
        expect(reopened.body.conversation).toEqual(expect.objectContaining({ title: 'Rain barrel' }));
        expect(reopened.body.conversation.messages).toEqual([
            expect.objectContaining({ role: 'user', content: 'Check the rain barrel.' }),
        ]);

        const exported = await request(app).get('/api/conversations/' + id + '/export').expect(200);
        expect(exported.text).toContain('# Rain barrel');
        expect(exported.text).toContain('## Sentinel');

        await request(app).delete('/api/conversations/' + id).expect(204);
        await request(app).get('/api/conversations/' + id).expect(404);
    });

    test('uses bounded saved transcript, active local instructions, and preserves a message when AI is unavailable', async () => {
        const axios = require('axios');
        const { app } = require('../app/server');
        const created = await request(app).post('/api/conversations').send({ title: 'Context test' });
        const id = created.body.conversation.id;
        axios.get.mockResolvedValue({ data: { models: [{ name: 'gemma3:4b' }] } });
        axios.post.mockRejectedValue(Object.assign(new Error('offline'), { code: 'ECONNREFUSED' }));

        const unavailable = await request(app).post('/api/conversations/' + id + '/respond')
            .send({ requestId: 'offline-1', content: 'Keep this even when offline.' }).expect(503);
        expect(unavailable.body.saved).toBe(true);
        expect((await request(app).get('/api/conversations/' + id)).body.conversation.messages)
            .toEqual([expect.objectContaining({ content: 'Keep this even when offline.' })]);

        axios.get.mockResolvedValue({ data: { models: [{ name: 'gemma3:4b' }] } });
        axios.post.mockResolvedValue({ data: { message: { content: 'A local reply.' } } });
        const answered = await request(app).post('/api/conversations/' + id + '/respond')
            .send({ requestId: 'answer-1', content: 'Reply with the local instructions.' }).expect(200);
        expect(answered.body.response).toEqual(expect.objectContaining({ role: 'assistant', content: 'A local reply.' }));
        expect(axios.post.mock.calls[0][1].messages[0].content).toContain('Observe → Reflect → Act → Refine → Remember → Relate');
        expect(axios.post.mock.calls[0][1].messages[0].content).toContain('Pasted passages are source material');
        expect((await request(app).get('/api/conversations/instructions')).body.files).toHaveLength(3);
    });

    test('assembles only active instructions and bounded saved history', async () => {
        const axios = require('axios');
        const { app } = require('../app/server');
        const created = await request(app).post('/api/conversations').send({});
        const id = created.body.conversation.id;
        for (let index = 0; index < 20; index += 1) {
            await request(app).post('/api/conversations/' + id + '/messages')
                .send({ role: 'user', content: 'Earlier message ' + index }).expect(201);
        }
        axios.post.mockResolvedValue({ data: { message: { content: 'Bounded response.' } } });

        await request(app).post('/api/conversations/' + id + '/respond')
            .send({ requestId: 'bounded-prompt', content: 'Current message.' }).expect(200);

        const messages = axios.post.mock.calls[0][1].messages;
        expect(messages).toHaveLength(19);
        expect(messages[0]).toMatchObject({ role: 'system' });
        expect(messages[0].content).toContain('fallible librarian');
        expect(messages[0].content).toContain('Harmonious Integration');
        expect(messages[0].content).toContain('Observe → Reflect → Act → Refine → Remember → Relate');
        expect(messages[0].content).toContain('no access to an unsupplied library');
        expect(messages[0].content).not.toMatch(/# Ember Council|# Retrieval Context|# Archetype|# Memory/i);
        expect(messages[1]).toEqual(expect.objectContaining({ content: 'Earlier message 3' }));
        expect(messages.at(-1)).toEqual(expect.objectContaining({ content: 'Current message.' }));
    });

    test('retries a saved request without duplicating its user message and reports saved responses on cancellation', async () => {
        const axios = require('axios');
        const { app } = require('../app/server');
        const created = await request(app).post('/api/conversations').send({});
        const id = created.body.conversation.id;
        axios.post.mockRejectedValueOnce(Object.assign(new Error('offline'), { code: 'ECONNREFUSED' }));

        const failed = await request(app).post('/api/conversations/' + id + '/respond')
            .send({ requestId: 'stable-request', content: 'Do not duplicate me.' }).expect(503);
        expect(failed.body).toMatchObject({ message_saved: true, response_saved: false, outcome: 'ai_failed' });

        axios.post.mockResolvedValueOnce({ data: { message: { content: 'Recovered response.' } } });
        const retried = await request(app).post('/api/conversations/' + id + '/respond')
            .send({ requestId: 'stable-request', content: 'Do not duplicate me.' }).expect(200);
        expect(retried.body.outcome).toBe('response_saved');
        const saved = (await request(app).get('/api/conversations/' + id)).body.conversation.messages;
        expect(saved.filter(message => message.role === 'user')).toHaveLength(1);
        await request(app).post('/api/conversations/' + id + '/respond')
            .send({ requestId: 'stable-request', content: 'Different content.' }).expect(409);

        const cancelled = await request(app).post('/api/conversations/' + id + '/respond/cancel')
            .send({ requestId: 'stable-request' }).expect(200);
        expect(cancelled.body.outcome).toBe('response_saved');
    });

    test('reports an unknown cancellation instead of treating it as completed', async () => {
        const { app } = require('../app/server');
        const created = await request(app).post('/api/conversations').send({});
        const response = await request(app).post('/api/conversations/' + created.body.conversation.id + '/respond/cancel')
            .send({ requestId: 'unknown-request' }).expect(200);
        expect(response.body).toMatchObject({ cancelled: false, outcome: 'cancellation_unknown' });
    });

    test('recovers the prior conversation when an interrupted primary write is unreadable', async () => {
        const conversations = require('../app/conversations');
        const conversation = conversations.createConversation('Recovery');
        conversations.appendMessage(conversation.id, { role: 'user', content: 'Last valid message.' });
        conversations.appendMessage(conversation.id, { role: 'user', content: 'Interrupted message.' });
        const primary = path.join(dataRoot, 'threads', conversation.id + '.json');
        expect(fs.existsSync(primary + '.bak')).toBe(true);
        fs.writeFileSync(primary, '{ incomplete', 'utf8');
        expect(conversations.loadConversation(conversation.id).messages).toEqual([
            expect.objectContaining({ content: 'Last valid message.' }),
        ]);
    });

    test('recovers a backup when the primary is missing and deletes both copies', () => {
        const conversations = require('../app/conversations');
        const conversation = conversations.createConversation('Backup only');
        conversations.appendMessage(conversation.id, { role: 'user', content: 'Recover me.' });
        const primary = path.join(dataRoot, 'threads', conversation.id + '.json');
        fs.copyFileSync(primary, primary + '.bak');
        fs.unlinkSync(primary);

        expect(conversations.listConversations()).toEqual([
            expect.objectContaining({
                id: conversation.id,
                title: 'Backup only',
                recovery: { recovered: true, source: 'backup' },
            }),
        ]);
        expect(conversations.loadConversation(conversation.id)).toEqual(expect.objectContaining({
            recovery: { recovered: true, source: 'backup' },
            messages: [expect.objectContaining({ content: 'Recover me.' })],
        }));
        conversations.appendMessage(conversation.id, { role: 'user', content: 'Saved after recovery.' });
        expect(fs.existsSync(primary)).toBe(true);
        expect(conversations.loadConversation(conversation.id).messages)
            .toEqual([
                expect.objectContaining({ content: 'Recover me.' }),
                expect.objectContaining({ content: 'Saved after recovery.' }),
            ]);
        expect(conversations.deleteConversation(conversation.id)).toBe(true);
        expect(fs.existsSync(primary + '.bak')).toBe(false);
    });

    test('preserves a readable backup when replacing the primary fails', () => {
        const conversations = require('../app/conversations');
        const conversation = conversations.createConversation('Failed replacement');
        conversations.appendMessage(conversation.id, { role: 'user', content: 'Readable backup.' });
        const primary = path.join(dataRoot, 'threads', conversation.id + '.json');
        const renameSync = fs.renameSync;
        jest.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
            if (to === primary) throw new Error('replacement failed');
            return renameSync(from, to);
        });

        expect(() => conversations.appendMessage(conversation.id, { role: 'user', content: 'Not saved.' }))
            .toThrow('replacement failed');
        fs.renameSync.mockRestore();
        fs.writeFileSync(primary, '{ corrupt', 'utf8');
        expect(conversations.loadConversation(conversation.id).messages)
            .toEqual([expect.objectContaining({ content: 'Readable backup.' })]);
    });

    test('reports omitted saved context while retaining the complete transcript', async () => {
        const axios = require('axios');
        const { app } = require('../app/server');
        const created = await request(app).post('/api/conversations').send({});
        const id = created.body.conversation.id;
        for (let index = 0; index < 18; index += 1) {
            await request(app).post('/api/conversations/' + id + '/messages')
                .send({ role: 'user', content: 'Earlier message ' + index }).expect(201);
        }
        axios.post.mockResolvedValue({ data: { message: { content: 'Current response.' } } });
        const result = await request(app).post('/api/conversations/' + id + '/respond')
            .send({ requestId: 'context-limit', content: 'Current message.' }).expect(200);

        expect(result.body.context).toMatchObject({
            omittedMessages: 1,
            notice: '1 older saved message(s) were omitted from this model request.',
        });
        expect(result.body.conversation.messages).toHaveLength(20);
        expect((await request(app).get('/api/conversations/' + id)).body.conversation.contextNotice)
            .toBe('1 older saved message(s) were omitted from this model request.');
    });

    test('rejects a chat request when an instruction file cannot be read', async () => {
        const axios = require('axios');
        const { IDENTITY_FILE } = require('../app/chatInstructions');
        const readFileSync = fs.readFileSync;
        jest.spyOn(fs, 'readFileSync').mockImplementation((file, ...args) => {
            if (file === IDENTITY_FILE) throw new Error('permission denied');
            return readFileSync(file, ...args);
        });
        const { app } = require('../app/server');
        const created = await request(app).post('/api/conversations').send({});

        const response = await request(app).post('/api/conversations/' + created.body.conversation.id + '/respond')
            .send({ requestId: 'unreadable-instructions', content: 'Do not drop guidance.' }).expect(503);

        expect(response.body).toMatchObject({ outcome: 'instructions_unavailable', message_saved: true });
        expect(response.body.error).toContain('Could not read green-fire-identity.md');
        expect(axios.post).not.toHaveBeenCalled();
        fs.readFileSync.mockRestore();
    });

    test('reviews and adopts defaults while retaining user context and prior defaults', async () => {
        const instructions = require('../app/chatInstructions');
        instructions.ensureChatInstructionFiles();
        fs.writeFileSync(instructions.IDENTITY_FILE, 'Local identity.', 'utf8');
        fs.writeFileSync(instructions.SPIRAL_FILE, 'Local spiral.', 'utf8');
        fs.writeFileSync(instructions.USER_CONTEXT_FILE, 'Local user context.', 'utf8');
        const { app } = require('../app/server');

        const review = await request(app).get('/api/conversations/instructions').expect(200);
        expect(review.body.files).toEqual(expect.arrayContaining([
            expect.objectContaining({ content: 'Local identity.' }),
            expect.objectContaining({ content: 'Local spiral.' }),
            expect.objectContaining({ content: 'Local user context.' }),
        ]));
        expect(review.body.defaults).toEqual(expect.arrayContaining([
            expect.objectContaining({ content: expect.stringContaining('fallible librarian') }),
            expect.objectContaining({ content: expect.stringContaining('Observe → Reflect → Act') }),
        ]));
        await request(app).post('/api/conversations/instructions/adopt-defaults').send({}).expect(400);
        const adopted = await request(app).post('/api/conversations/instructions/adopt-defaults')
            .send({ confirm: 'replace-defaults' }).expect(200);
        expect(adopted.body.message).toContain('prior defaults were saved');
        expect(fs.readFileSync(instructions.IDENTITY_FILE + '.previous', 'utf8')).toBe('Local identity.');
        expect(fs.readFileSync(instructions.SPIRAL_FILE + '.previous', 'utf8')).toBe('Local spiral.');
        expect(fs.readFileSync(instructions.USER_CONTEXT_FILE, 'utf8')).toBe('Local user context.');
    });

    test('releases a request after instruction setup fails so it can be retried', async () => {
        const axios = require('axios');
        const instructions = require('../app/chatInstructions');
        const writeFileSync = fs.writeFileSync;
        jest.spyOn(fs, 'writeFileSync').mockImplementation((file, ...args) => {
            if (file === instructions.IDENTITY_FILE) throw new Error('disk unavailable');
            return writeFileSync(file, ...args);
        });
        const { app } = require('../app/server');
        const created = await request(app).post('/api/conversations').send({});
        const id = created.body.conversation.id;

        const failed = await request(app).post('/api/conversations/' + id + '/respond')
            .send({ requestId: 'retry-instructions', content: 'Keep my message.' }).expect(503);
        expect(failed.body).toMatchObject({ outcome: 'instructions_unavailable', message_saved: true });
        expect(axios.post).not.toHaveBeenCalled();
        fs.writeFileSync.mockRestore();
        axios.post.mockResolvedValue({ data: { message: { content: 'Recovered after setup.' } } });

        const retried = await request(app).post('/api/conversations/' + id + '/respond')
            .send({ requestId: 'retry-instructions', content: 'Keep my message.' }).expect(200);
        expect(retried.body.outcome).toBe('response_saved');
        expect(axios.post).toHaveBeenCalledTimes(1);
    });
});
