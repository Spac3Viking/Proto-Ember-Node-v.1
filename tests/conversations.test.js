'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');

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
});
