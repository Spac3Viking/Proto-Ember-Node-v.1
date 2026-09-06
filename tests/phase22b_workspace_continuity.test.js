'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');

jest.mock('axios');

describe('Phase 22B — workspace continuity', () => {
    let dataRoot;

    beforeEach(() => {
        jest.resetModules();
        dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-phase22b-test-'));
        process.env.EMBER_NODE_DATA_ROOT = dataRoot;
        delete process.env.EMBER_DATA_ROOT;
    });

    afterEach(() => {
        delete process.env.EMBER_NODE_DATA_ROOT;
        delete process.env.EMBER_DATA_ROOT;
        fs.rmSync(dataRoot, { recursive: true, force: true });
    });

    test('remembers editable checkpoints and navigable thread relations with provenance', async () => {
        const { app } = require('../app/server');
        const created = await request(app).post('/api/signal-threads').send({ title: 'Repair desk', posture: 'practical' });
        const id = created.body.thread.id;
        const entry = await request(app).post('/api/signal-threads/' + id + '/entries').send({
            stage: 'act', content: 'Replaced the worn cable.', kind: 'ai-exchange',
            provenance: { type: 'archive', id: 'repair-manual', label: 'Repair Manual' },
        });
        expect(entry.status).toBe(200);
        expect(entry.body.entry.provenance.id).toBe('repair-manual');

        const remembered = await request(app).post('/api/signal-threads/' + id + '/remember').send({ content: 'Keep a spare cable.' });
        expect(remembered.status).toBe(200);
        expect(remembered.body.checkpoint.origin.threadId).toBe(id);
        const checkpoint = await request(app).put('/api/hearth/checkpoints/' + remembered.body.checkpoint.id)
            .send({ content: 'Keep two spare cables.' });
        expect(checkpoint.body.checkpoint.content).toBe('Keep two spare cables.');

        const related = await request(app).post('/api/workspace/relations').send({
            from: { type: 'thread', id }, to: { type: 'checkpoint', id: remembered.body.checkpoint.id },
        });
        expect(related.status).toBe(200);
        const relations = await request(app).get('/api/workspace/relations?type=thread&id=' + id);
        expect(relations.body.relations).toHaveLength(1);
    });

    test('migrates sessions only once and can roll back untouched migrated threads', async () => {
        const { app } = require('../app/server');
        const session = await request(app).post('/api/sessions').send({ title: 'Plan garden' });
        await request(app).post('/api/sessions/' + session.body.session.id + '/stage')
            .send({ stage: 'reflect', notes: 'Measure sun exposure.', advance: false });
        const first = await request(app).post('/api/workspace/migrate-sessions').send();
        expect(first.body.created).toHaveLength(1);
        const second = await request(app).post('/api/workspace/migrate-sessions').send();
        expect(second.body.created).toHaveLength(0);
        const rollback = await request(app).post('/api/workspace/rollback-session-migration').send();
        expect(rollback.body.rolledBack).toHaveLength(1);
        expect((await request(app).get('/api/signal-threads')).body.threads).toHaveLength(0);
    });

    test('preserves Session timestamps, stage, and later thread changes through rollback and rerun', async () => {
        const { app } = require('../app/server');
        const session = await request(app).post('/api/sessions').send({ title: 'Original title' });
        const sessionId = session.body.session.id;
        await request(app).put('/api/sessions/' + sessionId).send({ currentStage: 'relate' });
        const source = (await request(app).get('/api/sessions/' + sessionId)).body.session;
        const migration = await request(app).post('/api/workspace/migrate-sessions').send();
        const threadId = migration.body.created[0].threadId;
        const migrated = (await request(app).get('/api/signal-threads/' + threadId)).body.thread;
        expect(migrated.createdAt).toBe(source.createdAt);
        expect(migrated.updatedAt).toBe(source.updatedAt);
        expect(migrated.currentStage).toBe('relate');
        expect(migrated.sessionIds).toContain(sessionId);

        await request(app).put('/api/signal-threads/' + threadId).send({ title: 'Later title', currentStage: 'act' });
        await request(app).post('/api/workspace/rollback-session-migration').send();
        expect((await request(app).get('/api/signal-threads/' + threadId)).body.thread.title).toBe('Later title');
        expect((await request(app).post('/api/workspace/migrate-sessions').send()).body.created).toHaveLength(0);
    });

    test('retains migrated threads with later entries and Hearth references', async () => {
        const { app } = require('../app/server');
        const session = await request(app).post('/api/sessions').send({ title: 'Keep me' });
        const migration = await request(app).post('/api/workspace/migrate-sessions').send();
        const threadId = migration.body.created[0].threadId;
        await request(app).post('/api/signal-threads/' + threadId + '/entries').send({ stage: 'relate', content: 'Later entry' });
        await request(app).post('/api/workspace/rollback-session-migration').send();
        expect((await request(app).get('/api/signal-threads/' + threadId)).status).toBe(200);

        const checkpoint = await request(app).post('/api/signal-threads/' + threadId + '/remember').send({ content: 'Hearth link' });
        expect(checkpoint.status).toBe(200);
        await request(app).post('/api/workspace/rollback-session-migration').send();
        expect((await request(app).get('/api/signal-threads/' + threadId)).status).toBe(200);
        expect((await request(app).post('/api/workspace/migrate-sessions').send()).body.created).toHaveLength(0);
        expect(session.status).toBe(200);
    });

    test('backs up without prior archives and restores by replacement', async () => {
        const { app } = require('../app/server');
        const created = await request(app).post('/api/signal-threads').send({ title: 'Portable', posture: 'practical' });
        const id = created.body.thread.id;
        const continuity = require('../app/workspaceContinuity');
        const first = continuity.createBackup();
        const second = continuity.createBackup();
        const AdmZip = require('adm-zip');
        expect(new AdmZip(second).getEntries().map(entry => entry.entryName)).not.toContain('data/exports/' + path.basename(first));

        fs.writeFileSync(path.join(dataRoot, 'stale.txt'), 'remove me');
        continuity.restoreBackup(second);
        expect(fs.existsSync(path.join(dataRoot, 'stale.txt'))).toBe(false);
        expect((await request(app).get('/api/signal-threads/' + id)).status).toBe(200);
    });

    test('resumes interrupted migration and rejects corrupt tracking', async () => {
        const { app } = require('../app/server');
        const session = await request(app).post('/api/sessions').send({ title: 'Resume' });
        const tracking = path.join(dataRoot, 'system', 'workspace-migration.json');
        fs.mkdirSync(path.dirname(tracking), { recursive: true });
        fs.writeFileSync(tracking, JSON.stringify({
            version: 1,
            mappings: [{ sessionId: session.body.session.id, threadId: 'thread-resume', status: 'pending' }],
        }));
        expect((await request(app).post('/api/workspace/migrate-sessions').send()).body.created).toHaveLength(1);
        expect((await request(app).post('/api/workspace/migrate-sessions').send()).body.created).toHaveLength(0);
        fs.writeFileSync(tracking, '{invalid');
        expect((await request(app).post('/api/workspace/migrate-sessions').send()).status).toBe(500);
    });

    test('invalid archives and restore failures retain the existing installation', async () => {
        const { app } = require('../app/server');
        const created = await request(app).post('/api/signal-threads').send({ title: 'Safe', posture: 'practical' });
        const continuity = require('../app/workspaceContinuity');
        const backup = continuity.createBackup();
        const invalid = path.join(dataRoot, 'exports', 'invalid.zip');
        fs.writeFileSync(invalid, 'not a zip');
        expect(() => continuity.restoreBackup(invalid)).toThrow();
        expect((await request(app).get('/api/signal-threads/' + created.body.thread.id)).status).toBe(200);

        const originalRename = fs.renameSync;
        const renameSpy = jest.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
            if (String(from).includes('.restore-stage-')) throw new Error('simulated rename failure');
            return originalRename(from, to);
        });
        expect(() => continuity.restoreBackup(backup)).toThrow('Backup restore failed');
        renameSpy.mockRestore();
        expect((await request(app).get('/api/signal-threads/' + created.body.thread.id)).status).toBe(200);
    });

    test('restoring a version preserves the displaced record', async () => {
        const { app } = require('../app/server');
        const created = await request(app).post('/api/signal-threads').send({ title: 'Before', posture: 'practical' });
        const id = created.body.thread.id;
        await request(app).put('/api/signal-threads/' + id).send({ title: 'After' });
        const versions = await request(app).get('/api/signal-threads/' + id + '/versions');
        expect(versions.body.versions).toHaveLength(1);
        await request(app).post('/api/signal-threads/' + id + '/versions/' + versions.body.versions[0].id + '/restore').send();
        expect((await request(app).get('/api/signal-threads/' + id)).body.thread.title).toBe('Before');
        expect((await request(app).get('/api/signal-threads/' + id + '/versions')).body.versions.length).toBeGreaterThan(1);
    });
});
