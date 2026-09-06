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

function readMigrationState() {
    if (!fs.existsSync(MIGRATION_PATH)) return { version: 1, mappings: [] };
    let state;
    try {
        state = JSON.parse(fs.readFileSync(MIGRATION_PATH, 'utf8'));
    } catch {
        throw new Error('Migration tracking is corrupt');
    }
    const isMapping = item => item && typeof item.sessionId === 'string' &&
        typeof item.threadId === 'string' && item.sessionId && item.threadId;
    if (state && !Object.prototype.hasOwnProperty.call(state, 'version') &&
        Array.isArray(state.migratedSessionIds) && Array.isArray(state.created) &&
        state.migratedSessionIds.every(id => typeof id === 'string' && id) &&
        state.created.every(isMapping)) {
        return {
            version: 1,
            mappings: state.created.map(item => ({
                sessionId: item.sessionId,
                threadId: item.threadId,
                status: 'complete',
                legacy: true,
            })),
            migratedSessionIds: state.migratedSessionIds,
        };
    }
    if (!state || state.version !== 1 || !Array.isArray(state.mappings) ||
        state.mappings.some(item => !isMapping(item) || typeof item.status !== 'string' ||
            !['pending', 'complete'].includes(item.status) ||
            (item.status === 'complete' && !item.legacy && typeof item.baseline !== 'string') ||
            (item.legacy && item.legacy !== true))) {
        throw new Error('Migration tracking is corrupt');
    }
    return state;
}

function threadFingerprint(thread) {
    return crypto.createHash('sha256').update(JSON.stringify(thread)).digest('hex');
}

function migratedThread(session, threadId) {
    const entries = Array.isArray(session.entries) ? session.entries
        .filter(entry => String(entry.notes || '').trim())
        .map(entry => ({
            id: 'migrated-' + crypto.randomUUID(),
            stage: entry.stage,
            timestamp: entry.completedAt || session.updatedAt,
            content: entry.notes,
            kind: 'note',
            provenance: { type: 'session', id: session.id },
        })) : [];
    return {
        id: threadId,
        title: session.title,
        posture: 'practical',
        currentStage: session.currentStage,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        sourceNotes: 'Migrated from Session ' + session.id,
        entries,
        sessionIds: [session.id],
    };
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
    const state = readMigrationState();
    const migratedSessionIds = new Set(Array.isArray(state.migratedSessionIds) ? state.migratedSessionIds : []);
    const created = [];
    listSessions().forEach(summary => {
        if (migratedSessionIds.has(summary.id)) return;
        let mapping = state.mappings.find(item => item.sessionId === summary.id);
        if (mapping && mapping.status === 'complete' && loadSignalThread(mapping.threadId)) return;
        const session = loadSession(summary.id);
        if (!session) return;
        if (!mapping) {
            mapping = { sessionId: session.id, threadId: 'thread-' + crypto.randomUUID(), status: 'pending' };
            state.mappings.push(mapping);
            atomicWrite(MIGRATION_PATH, state);
        }
        let thread = loadSignalThread(mapping.threadId);
        if (!thread) thread = saveSignalThread(migratedThread(session, mapping.threadId));
        mapping.status = 'complete';
        if (!mapping.legacy) mapping.baseline = threadFingerprint(thread);
        atomicWrite(MIGRATION_PATH, state);
        created.push({ sessionId: session.id, threadId: thread.id });
    });
    state.updatedAt = new Date().toISOString();
    atomicWrite(MIGRATION_PATH, state);
    return { created, skipped: listSessions().length - created.length };
}

function rollbackMigration() {
    const state = readMigrationState();
    const rolledBack = [];
    const retained = [];
    state.mappings.forEach(item => {
        const thread = loadSignalThread(item.threadId);
        const hasReferences = listRelations().some(relation =>
            (relation.from && relation.from.type === 'thread' && relation.from.id === item.threadId) ||
            (relation.to && relation.to.type === 'thread' && relation.to.id === item.threadId)) ||
            listCheckpoints().some(checkpoint => checkpoint.origin && checkpoint.origin.threadId === item.threadId);
        if (thread && item.status === 'complete' && typeof item.baseline === 'string' &&
            threadFingerprint(thread) === item.baseline && !hasReferences) {
            fs.rmSync(path.join(SYSTEM_DIR, 'signal-threads', item.threadId + '.json'), { force: true });
            rolledBack.push(item.threadId);
        } else {
            retained.push(item);
        }
    });
    state.mappings = retained;
    state.rolledBackAt = new Date().toISOString();
    atomicWrite(MIGRATION_PATH, state);
    return { rolledBack };
}

function createBackup() {
    fs.mkdirSync(EXPORTS_DIR, { recursive: true });
    const file = path.join(EXPORTS_DIR, 'ember-node-backup-' + Date.now() + '.zip');
    const zip = new AdmZip();
    const walk = directory => fs.readdirSync(directory, { withFileTypes: true }).forEach(entry => {
        const source = path.join(directory, entry.name);
        const relative = path.relative(DATA_ROOT, source);
        if (relative === 'exports' || relative.startsWith('exports' + path.sep) ||
            entry.name.endsWith('.tmp') || entry.name.includes('.restore-')) return;
        if (entry.isDirectory()) return walk(source);
        if (!entry.isFile()) return;
        zip.addFile(path.posix.join('data', relative.split(path.sep).join('/')), fs.readFileSync(source));
    });
    if (fs.existsSync(DATA_ROOT)) walk(DATA_ROOT);
    zip.writeZip(file);
    return file;
}

function validateBackup(zip) {
    const names = new Set();
    const entries = zip.getEntries();
    if (!entries.length) throw new Error('Backup archive is empty');
    entries.forEach(entry => {
        const name = String(entry.entryName || '').replace(/\\/g, '/');
        if (!name.startsWith('data/') || name.includes('\0') || name.split('/').includes('..') ||
            name.startsWith('/') || names.has(name)) throw new Error('Invalid backup entry: ' + name);
        names.add(name);
        if (!entry.isDirectory) {
            try { entry.getData(); } catch { throw new Error('Unreadable backup entry: ' + name); }
        }
    });
}

function restoreBackup(file) {
    const resolved = path.resolve(file);
    if (!resolved.startsWith(path.resolve(EXPORTS_DIR) + path.sep) || !fs.existsSync(resolved)) throw new Error('Backup file not found');
    const zip = new AdmZip(resolved);
    validateBackup(zip);
    const stage = DATA_ROOT + '.restore-stage-' + crypto.randomUUID();
    const prior = DATA_ROOT + '.pre-restore-' + crypto.randomUUID();
    try {
        fs.mkdirSync(stage, { recursive: true });
        zip.getEntries().forEach(entry => {
            if (entry.isDirectory) return;
            const name = entry.entryName.slice('data/'.length);
            const destination = path.join(stage, name);
            fs.mkdirSync(path.dirname(destination), { recursive: true });
            fs.writeFileSync(destination, entry.getData());
        });
        if (fs.existsSync(DATA_ROOT)) fs.renameSync(DATA_ROOT, prior);
        fs.renameSync(stage, DATA_ROOT);
        return { restored: true, mode: 'replace', recoveryPath: prior };
    } catch (error) {
        try {
            if (!fs.existsSync(DATA_ROOT) && fs.existsSync(prior)) fs.renameSync(prior, DATA_ROOT);
        } catch { /* Preserve the original error. */ }
        throw new Error('Backup restore failed: ' + error.message);
    } finally {
        fs.rmSync(stage, { recursive: true, force: true });
    }
}

module.exports = { listCheckpoints, loadCheckpoint, rememberThread, updateCheckpoint, listRelations, relate, migrateSessions, rollbackMigration, createBackup, restoreBackup };
