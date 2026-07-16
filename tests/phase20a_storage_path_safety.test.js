'use strict';

/**
 * Phase 20A / build v118 — Storage-path safety regression tests
 *
 * Covers the shared safe-identifier helper (app/safeStorageId.js) directly,
 * plus end-to-end traversal-rejection behavior on the document and legacy
 * thread routes, alongside confirmation that ordinary create/read/update/
 * delete operations continue to work for well-formed IDs.
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const request = require('supertest');

jest.mock('axios');

const { isValidStorageId, resolveSafeStoragePath } = require('../app/safeStorageId');

describe('safeStorageId helper', () => {
    test('accepts well-formed identifiers', () => {
        expect(isValidStorageId('doc-1234')).toBe(true);
        expect(isValidStorageId('thread-abc_DEF-123')).toBe(true);
    });

    test('rejects empty, non-string, and whitespace identifiers', () => {
        expect(isValidStorageId('')).toBe(false);
        expect(isValidStorageId(undefined)).toBe(false);
        expect(isValidStorageId(null)).toBe(false);
        expect(isValidStorageId(42)).toBe(false);
        expect(isValidStorageId('  doc-1  ')).toBe(false);
    });

    test('rejects path separators and traversal sequences', () => {
        expect(isValidStorageId('../escape')).toBe(false);
        expect(isValidStorageId('..\\escape')).toBe(false);
        expect(isValidStorageId('a/../../b')).toBe(false);
        expect(isValidStorageId('sub/dir')).toBe(false);
        expect(isValidStorageId('sub\\dir')).toBe(false);
    });

    test('rejects absolute paths and null bytes', () => {
        expect(isValidStorageId('/etc/passwd')).toBe(false);
        expect(isValidStorageId('C:\\Windows\\System32')).toBe(false);
        expect(isValidStorageId('doc-1\0.json')).toBe(false);
    });

    test('rejects encoded traversal attempts', () => {
        expect(isValidStorageId('%2e%2e%2fescape')).toBe(false);
        expect(isValidStorageId('..%2fescape')).toBe(false);
        expect(isValidStorageId('%2e%2e')).toBe(false);
    });

    test('resolveSafeStoragePath stays confined to the storage root', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-safe-id-'));
        try {
            const good = resolveSafeStoragePath(root, 'doc-1');
            expect(good).toBe(path.join(path.resolve(root), 'doc-1.json'));

            expect(resolveSafeStoragePath(root, '../escape')).toBeNull();
            expect(resolveSafeStoragePath(root, '/etc/passwd')).toBeNull();
            expect(resolveSafeStoragePath(root, '')).toBeNull();
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});

describe('Phase 20A — document and legacy thread route traversal safety', () => {
    let dataRoot;

    beforeEach(() => {
        jest.resetModules();
        dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-phase20a-'));
        process.env.EMBER_NODE_DATA_ROOT = dataRoot;
        delete process.env.EMBER_DATA_ROOT;
    });

    afterEach(() => {
        delete process.env.EMBER_NODE_DATA_ROOT;
        delete process.env.EMBER_DATA_ROOT;
        try { fs.rmSync(dataRoot, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    const traversalIds = [
        '..%2fescape',
        '..%5cescape',
        '%2e%2e%2f%2e%2e%2fescape',
        'a%2fb',
    ];

    test('documents: full create/read/update/delete cycle for a valid id', async () => {
        const { app } = require('../app/server');

        const createRes = await request(app)
            .post('/api/documents')
            .send({ title: 'Hello', content: 'World' });
        expect(createRes.status).toBe(200);
        const id = createRes.body.document.id;
        expect(typeof id).toBe('string');

        const readRes = await request(app).get(`/api/documents/${id}`);
        expect(readRes.status).toBe(200);
        expect(readRes.body.document.title).toBe('Hello');

        const updateRes = await request(app)
            .put(`/api/documents/${id}`)
            .send({ title: 'Updated' });
        expect(updateRes.status).toBe(200);
        expect(updateRes.body.document.title).toBe('Updated');

        const deleteRes = await request(app).delete(`/api/documents/${id}`);
        expect(deleteRes.status).toBe(200);

        const afterDeleteRes = await request(app).get(`/api/documents/${id}`);
        expect(afterDeleteRes.status).toBe(404);
    });

    test('documents: traversal attempts are rejected with a client error, not 500', async () => {
        const { app } = require('../app/server');

        for (const method of ['get', 'put', 'delete']) {
            const res = await request(app)[method]('/api/documents/..%2f..%2fescape');
            expect([400, 404]).toContain(res.status);
            expect(res.status).toBeLessThan(500);
        }
    });

    test('documents: encoded traversal ids never escape the storage root', async () => {
        const { app } = require('../app/server');
        const { DOCUMENTS_DIR } = require('../app/storageConfig');

        // A canary file placed just outside the documents dir must never be
        // reachable or removable via a crafted :id.
        const canaryPath = path.join(path.dirname(DOCUMENTS_DIR), 'canary.json');
        fs.writeFileSync(canaryPath, JSON.stringify({ secret: true }), 'utf8');

        try {
            for (const badId of traversalIds) {
                const res = await request(app).get(`/api/documents/${badId}`);
                expect(res.status).toBeLessThan(500);
                expect(res.status).not.toBe(200);
            }
            expect(fs.existsSync(canaryPath)).toBe(true);
        } finally {
            try { fs.unlinkSync(canaryPath); } catch { /* ignore */ }
        }
    });

    test('legacy threads: full create/read/update/delete cycle for a valid id', async () => {
        const { app } = require('../app/server');

        const createRes = await request(app)
            .post('/api/threads')
            .send({ title: 'A thread', room: 'hearth' });
        expect(createRes.status).toBe(200);
        const id = createRes.body.thread.id;
        expect(typeof id).toBe('string');

        const readRes = await request(app).get(`/api/threads/${id}`);
        expect(readRes.status).toBe(200);
        expect(readRes.body.thread.title).toBe('A thread');

        const updateRes = await request(app)
            .put(`/api/threads/${id}`)
            .send({ title: 'Renamed thread' });
        expect(updateRes.status).toBe(200);
        expect(updateRes.body.thread.title).toBe('Renamed thread');

        const deleteRes = await request(app).delete(`/api/threads/${id}`);
        expect(deleteRes.status).toBe(200);

        const afterDeleteRes = await request(app).get(`/api/threads/${id}`);
        expect(afterDeleteRes.status).toBe(404);
    });

    test('legacy threads: traversal attempts are rejected with a client error, not 500', async () => {
        const { app } = require('../app/server');

        for (const method of ['get', 'put', 'delete']) {
            const res = await request(app)[method]('/api/threads/..%2f..%2fescape');
            expect([400, 404]).toContain(res.status);
            expect(res.status).toBeLessThan(500);
        }
    });

    test('legacy threads: encoded traversal ids never escape the storage root', async () => {
        const { app } = require('../app/server');
        const { THREADS_DIR } = require('../app/storageConfig');

        const canaryPath = path.join(path.dirname(THREADS_DIR), 'canary.json');
        fs.writeFileSync(canaryPath, JSON.stringify({ secret: true }), 'utf8');

        try {
            for (const badId of traversalIds) {
                const res = await request(app).get(`/api/threads/${badId}`);
                expect(res.status).toBeLessThan(500);
                expect(res.status).not.toBe(200);
            }
            expect(fs.existsSync(canaryPath)).toBe(true);
        } finally {
            try { fs.unlinkSync(canaryPath); } catch { /* ignore */ }
        }
    });
});
