'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { DATA_ROOT, ROOM_DIRS, SYSTEM_DIR, EXPORTS_DIR } = require('./storageConfig');
const { loadSignalThread, createSignalThread, saveSignalThread } = require('./signalThreads');
const { listSessions, loadSession } = require('./sessions');

const CHECKPOINTS_DIR = path.join(ROOM_DIRS.hearth, 'checkpoints');
const RELATIONS_PATH = path.join(SYSTEM_DIR, 'workspace-relations.json');
const MIGRATION_PATH = path.join(SYSTEM_DIR, 'workspace-migration.json');

function readJson(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function atomicWrite(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = file + '.' + process.pid + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
    fs.renameSync(temp, file);
}

function checkpointPath(id) {
    return path.join(CHECKPOINTS_DIR, String(id).replace(/[^a-zA-Z0-9_-]/g, '_') + '.json');
}

function listCheckpoints() {
    if (!fs.existsSync(CHECKPOINTS_DIR)) return [];
    return fs.readdirSync(CHECKPOINTS_DIR).filter(file => file.endsWith('.json'))
        .map(file => readJson(path.join(CHECKPOINTS_DIR, file), null)).filter(Boolean)
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function loadCheckpoint(id) {
    return readJson(checkpointPath(id), null);
}

function rememberThread(threadId, content) {
    const thread = loadSignalThread(threadId);
    if (!thread) return null;
    const existing = listCheckpoints().find(item => item.origin && item.origin.threadId === thread.id);
    const now = new Date().toISOString();
    const checkpoint = {
        id: existing ? existing.id : 'checkpoint-' + crypto.randomUUID(),
        title: existing ? existing.title : thread.title,
        content: String(content || thread.compression || thread.summary || '').trim(),
        createdAt: existing ? existing.createdAt : now,
        updatedAt: now,
        origin: { type: 'signal-thread', threadId: thread.id, title: thread.title },
    };
    atomicWrite(checkpointPath(checkpoint.id), checkpoint);
    return checkpoint;
}

function updateCheckpoint(id, patch) {
    const current = loadCheckpoint(id);
    if (!current) return null;
    if (typeof patch.title === 'string' && patch.title.trim()) current.title = patch.title.trim();
    if (typeof patch.content === 'string') current.content = patch.content;
    current.updatedAt = new Date().toISOString();
    atomicWrite(checkpointPath(id), current);
    return current;
}

function listRelations(subject) {
    const state = readJson(RELATIONS_PATH, { relations: [] });
    const relations = Array.isArray(state.relations) ? state.relations : [];
    return subject ? relations.filter(relation => relation.from.type === subject.type && relation.from.id === subject.id) : relations;
}

function relate(from, to) {
    if (!from || !to || !['thread', 'checkpoint'].includes(from.type) ||
        !['thread', 'checkpoint', 'archive'].includes(to.type) || !from.id || !to.id) {
        throw new Error('A valid relation source and destination are required');
    }
    if (from.type === 'thread' && !loadSignalThread(from.id)) throw new Error('Source thread not found');
    if (from.type === 'checkpoint' && !loadCheckpoint(from.id)) throw new Error('Source checkpoint not found');
    const state = readJson(RELATIONS_PATH, { relations: [] });
    state.relations = Array.isArray(state.relations) ? state.relations : [];
    const existing = state.relations.find(item => item.from.type === from.type && item.from.id === from.id && item.to.type === to.type && item.to.id === to.id);
    if (existing) return existing;
    const relation = { id: 'relation-' + crypto.randomUUID(), from: { type: from.type, id: String(from.id) }, to: { type: to.type, id: String(to.id), title: String(to.title || '') }, createdAt: new Date().toISOString() };
    state.relations.push(relation);
    atomicWrite(RELATIONS_PATH, state);
    return relation;
}

function migrateSessions() {
    const prior = readJson(MIGRATION_PATH, { migratedSessionIds: [] });
    const migrated = new Set(prior.migratedSessionIds || []);
    const historicalCreated = Array.isArray(prior.created) ? prior.created : [];
    const created = [];
    listSessions().forEach(summary => {
        if (migrated.has(summary.id)) return;
        const session = loadSession(summary.id);
        if (!session) return;
        const thread = createSignalThread({ title: session.title, posture: 'practical', currentStage: session.currentStage, sourceNotes: 'Migrated from Session ' + session.id });
        session.entries.forEach(entry => {
            if (String(entry.notes || '').trim()) {
                const live = loadSignalThread(thread.id);
                live.entries.push({ id: 'migrated-' + crypto.randomUUID(), stage: entry.stage, timestamp: entry.completedAt || session.updatedAt, content: entry.notes, kind: 'note', provenance: { type: 'session', id: session.id } });
                live.currentStage = entry.stage;
                live.updatedAt = entry.completedAt || session.updatedAt;
                saveSignalThread(live);
            }
        });
        migrated.add(summary.id);
        created.push({ sessionId: summary.id, threadId: thread.id });
    });
    atomicWrite(MIGRATION_PATH, {
        migratedSessionIds: Array.from(migrated),
        created: historicalCreated.concat(created),
        updatedAt: new Date().toISOString(),
    });
    return { created, skipped: listSessions().length - created.length };
}

function rollbackMigration() {
    const state = readJson(MIGRATION_PATH, { created: [] });
    const rolledBack = [];
    (state.created || []).forEach(item => {
        const thread = loadSignalThread(item.threadId);
        if (thread && thread.entries.every(entry => String(entry.id).startsWith('migrated-'))) {
            fs.rmSync(path.join(SYSTEM_DIR, 'signal-threads', item.threadId + '.json'), { force: true });
            rolledBack.push(item.threadId);
        }
    });
    atomicWrite(MIGRATION_PATH, { migratedSessionIds: [], created: [], rolledBackAt: new Date().toISOString() });
    return { rolledBack };
}

function createBackup() {
    fs.mkdirSync(EXPORTS_DIR, { recursive: true });
    const file = path.join(EXPORTS_DIR, 'ember-node-backup-' + Date.now() + '.zip');
    const zip = new AdmZip();
    zip.addLocalFolder(DATA_ROOT, 'data');
    zip.writeZip(file);
    return file;
}

function restoreBackup(file) {
    const resolved = path.resolve(file);
    if (!resolved.startsWith(path.resolve(EXPORTS_DIR) + path.sep) || !fs.existsSync(resolved)) throw new Error('Backup file not found');
    const zip = new AdmZip(resolved);
    const target = path.resolve(DATA_ROOT) + path.sep;
    zip.getEntries().forEach(entry => {
        const name = entry.entryName.replace(/^data[\\/]/, '');
        if (!name || entry.isDirectory || name.includes('..')) return;
        const destination = path.resolve(DATA_ROOT, name);
        if (!destination.startsWith(target)) throw new Error('Unsafe backup entry');
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.writeFileSync(destination, entry.getData());
    });
    return { restored: true };
}

module.exports = { listCheckpoints, loadCheckpoint, rememberThread, updateCheckpoint, listRelations, relate, migrateSessions, rollbackMigration, createBackup, restoreBackup };
