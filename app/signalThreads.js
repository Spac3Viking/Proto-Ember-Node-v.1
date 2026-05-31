'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { SIGNAL_THREADS_DIR } = require('./storageConfig');

const SIGNAL_THREAD_POSTURES = Object.freeze([
    'exploratory',
    'reflective',
    'practical',
    'narrative',
    'strategic',
    'active',
    'dormant',
]);

const SIGNAL_THREAD_STATUSES = Object.freeze([
    'active',
    'resolved',
    'dormant',
    'archived',
]);

const SAGA_CYCLE_MODES = Object.freeze([
    'exploratory',
    'real',
]);

function _nowIso() {
    return new Date().toISOString();
}

function _ensureDir() {
    if (!fs.existsSync(SIGNAL_THREADS_DIR)) {
        fs.mkdirSync(SIGNAL_THREADS_DIR, { recursive: true });
    }
}

function _safeId(id) {
    return String(id || '').replace(/[^a-zA-Z0-9_-]/g, '_');
}

function _threadPath(id) {
    return path.join(SIGNAL_THREADS_DIR, _safeId(id) + '.json');
}

function _normalizePosture(posture) {
    const value = String(posture || '').trim().toLowerCase();
    return SIGNAL_THREAD_POSTURES.includes(value) ? value : 'exploratory';
}

function _normalizeStatus(status) {
    const value = String(status || '').trim().toLowerCase();
    return SIGNAL_THREAD_STATUSES.includes(value) ? value : 'active';
}

function _normalizeTags(tags) {
    if (!Array.isArray(tags)) return [];
    const seen = new Set();
    const out = [];
    tags.forEach(tag => {
        const cleaned = String(tag || '').trim();
        if (!cleaned) return;
        const key = cleaned.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        out.push(cleaned);
    });
    return out;
}

function _safeReadJson(filePath) {
    if (!fs.existsSync(filePath)) return null;
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return null;
    }
}

function _normalizeEntry(entry) {
    const row = entry && typeof entry === 'object' ? entry : {};
    return {
        id: String(row.id || ''),
        timestamp: row.timestamp ? String(row.timestamp) : null,
        content: String(row.content || ''),
    };
}

function normalizeSignalThread(raw) {
    const data = raw && typeof raw === 'object' ? raw : {};
    const now = _nowIso();
    return {
        id: String(data.id || ''),
        title: String(data.title || 'Untitled Signal Thread'),
        posture: _normalizePosture(data.posture),
        status: _normalizeStatus(data.status),
        createdAt: data.createdAt ? String(data.createdAt) : now,
        updatedAt: data.updatedAt ? String(data.updatedAt) : (data.createdAt ? String(data.createdAt) : now),
        summary: String(data.summary || ''),
        reflections: Array.isArray(data.reflections) ? data.reflections.map(_normalizeEntry) : [],
        observations: Array.isArray(data.observations) ? data.observations.map(_normalizeEntry) : [],
        compression: String(data.compression || ''),
        tags: _normalizeTags(data.tags),
    };
}

function listSignalThreads() {
    _ensureDir();
    return fs.readdirSync(SIGNAL_THREADS_DIR)
        .filter(f => f.endsWith('.json'))
        .map(f => {
            const parsed = _safeReadJson(path.join(SIGNAL_THREADS_DIR, f));
            if (!parsed) return null;
            const t = normalizeSignalThread(parsed);
            if (!t.id) return null;
            return {
                id: t.id,
                title: t.title,
                posture: t.posture,
                status: t.status,
                createdAt: t.createdAt,
                updatedAt: t.updatedAt,
                reflectionCount: t.reflections.length,
                observationCount: t.observations.length,
                tags: t.tags,
            };
        })
        .filter(Boolean)
        .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

function loadSignalThread(id) {
    const thread = _safeReadJson(_threadPath(id));
    if (!thread) return null;
    const normalized = normalizeSignalThread(thread);
    return normalized.id ? normalized : null;
}

function saveSignalThread(thread) {
    const normalized = normalizeSignalThread(thread);
    if (!normalized.id) throw new Error('Signal Thread id is required');
    _ensureDir();
    fs.writeFileSync(_threadPath(normalized.id), JSON.stringify(normalized, null, 2), 'utf8');
    return normalized;
}

function createSignalThread(input) {
    const body = input && typeof input === 'object' ? input : {};
    const title = String(body.title || '').trim();
    if (!title) {
        throw new Error('Title is required');
    }
    const now = _nowIso();
    const thread = {
        id: 'thread-' + crypto.randomUUID(),
        title,
        posture: _normalizePosture(body.posture),
        status: 'active',
        createdAt: now,
        updatedAt: now,
        summary: String(body.summary || ''),
        reflections: [],
        observations: [],
        compression: '',
        tags: _normalizeTags(body.tags),
    };
    return saveSignalThread(thread);
}

function updateSignalThread(id, patch) {
    const existing = loadSignalThread(id);
    if (!existing) return null;
    const data = patch && typeof patch === 'object' ? patch : {};

    if (typeof data.title === 'string') {
        const trimmed = data.title.trim();
        if (trimmed) existing.title = trimmed;
    }
    if (typeof data.posture === 'string') existing.posture = _normalizePosture(data.posture);
    if (typeof data.status === 'string') existing.status = _normalizeStatus(data.status);
    if (typeof data.summary === 'string') existing.summary = data.summary;
    if (typeof data.compression === 'string') existing.compression = data.compression;
    if (Array.isArray(data.tags)) existing.tags = _normalizeTags(data.tags);

    existing.updatedAt = _nowIso();
    return saveSignalThread(existing);
}

function deleteSignalThread(id) {
    const file = _threadPath(id);
    if (!fs.existsSync(file)) return false;
    fs.unlinkSync(file);
    return true;
}

function addReflection(threadId, content) {
    const thread = loadSignalThread(threadId);
    if (!thread) return null;
    const text = String(content || '').trim();
    if (!text) throw new Error('Reflection content is required');

    const entry = {
        id: 'reflection-' + crypto.randomUUID(),
        timestamp: _nowIso(),
        content: text,
    };
    thread.reflections.push(entry);
    thread.updatedAt = entry.timestamp;
    saveSignalThread(thread);
    return entry;
}

function addObservation(threadId, content) {
    const thread = loadSignalThread(threadId);
    if (!thread) return null;
    const text = String(content || '').trim();
    if (!text) throw new Error('Observation content is required');

    const entry = {
        id: 'observation-' + crypto.randomUUID(),
        timestamp: _nowIso(),
        content: text,
    };
    thread.observations.push(entry);
    thread.updatedAt = entry.timestamp;
    saveSignalThread(thread);
    return entry;
}

function setCompression(threadId, compression) {
    const thread = loadSignalThread(threadId);
    if (!thread) return null;
    thread.compression = String(compression || '');
    thread.updatedAt = _nowIso();
    return saveSignalThread(thread);
}

function _normalizeSagaMode(mode) {
    const value = String(mode || '').trim().toLowerCase();
    return SAGA_CYCLE_MODES.includes(value) ? value : null;
}

function _pushThreadEntry(thread, { prefix, content, timestamp }) {
    const text = String(content || '').trim();
    if (!text) throw new Error(prefix + ' content is required');
    const now = timestamp || _nowIso();
    const entry = {
        id: prefix + '-' + crypto.randomUUID(),
        timestamp: now,
        content: text,
    };
    return entry;
}

function _buildSagaCycleObservationContent({ mode, situation, application, observation }) {
    const lines = [];
    lines.push('Saga Smith — Cycle');
    lines.push('Mode: ' + mode);

    const sit = String(situation || '').trim();
    if (sit) {
        lines.push('');
        lines.push('Situation');
        lines.push(sit);
    }

    const app = String(application || '').trim();
    if (app) {
        lines.push('');
        lines.push('Application');
        lines.push(app);
    }

    lines.push('');
    lines.push('Observation');
    lines.push(String(observation || '').trim());
    return lines.join('\n');
}

function _buildSagaCycleReflectionContent({ mode, reflection }) {
    const lines = [];
    lines.push('Saga Smith — Reflection');
    lines.push('Mode: ' + mode);
    lines.push('');
    lines.push('Reflection');
    lines.push(String(reflection || '').trim());
    return lines.join('\n');
}

function saveSagaCycle(threadId, cycle) {
    const thread = loadSignalThread(threadId);
    if (!thread) return null;
    const body = cycle && typeof cycle === 'object' ? cycle : {};

    const mode = _normalizeSagaMode(body.mode);
    if (!mode) throw new Error('Invalid saga mode');

    const observationText = String(body.observation || '').trim();
    const reflectionText = String(body.reflection || '').trim();
    if (!observationText) throw new Error('Observation content is required');
    if (!reflectionText) throw new Error('Reflection content is required');

    const stamp = _nowIso();
    const observationEntry = _pushThreadEntry(thread, {
        prefix: 'observation',
        content: _buildSagaCycleObservationContent({
            mode,
            situation: body.situation,
            application: body.application,
            observation: observationText,
        }),
        timestamp: stamp,
    });
    const reflectionEntry = _pushThreadEntry(thread, {
        prefix: 'reflection',
        content: _buildSagaCycleReflectionContent({ mode, reflection: reflectionText }),
        timestamp: stamp,
    });

    thread.observations.push(observationEntry);
    thread.reflections.push(reflectionEntry);

    if (typeof body.compression === 'string') {
        thread.compression = body.compression;
    }

    thread.updatedAt = stamp;
    saveSignalThread(thread);
    return { thread, observation: observationEntry, reflection: reflectionEntry };
}

function exportSignalThreadMarkdown(thread) {
    const t = normalizeSignalThread(thread);
    const lines = [];
    lines.push('# Signal Thread');
    lines.push('Title: ' + (t.title || ''));
    lines.push('Posture: ' + (t.posture || ''));
    lines.push('Status: ' + (t.status || ''));
    lines.push('');
    lines.push('## Summary');
    lines.push(String(t.summary || ''));
    lines.push('');
    lines.push('## Reflections');
    if (t.reflections.length === 0) {
        lines.push('');
    } else {
        t.reflections.forEach(r => {
            const stamp = r.timestamp ? String(r.timestamp) : '';
            lines.push('- ' + stamp);
            lines.push('');
            lines.push(String(r.content || ''));
            lines.push('');
        });
    }
    lines.push('## Observations');
    if (t.observations.length === 0) {
        lines.push('');
    } else {
        t.observations.forEach(o => {
            const stamp = o.timestamp ? String(o.timestamp) : '';
            lines.push('- ' + stamp);
            lines.push('');
            lines.push(String(o.content || ''));
            lines.push('');
        });
    }
    lines.push('## Compression');
    lines.push(String(t.compression || ''));
    lines.push('');
    return lines.join('\n');
}

module.exports = {
    SIGNAL_THREAD_POSTURES,
    SIGNAL_THREAD_STATUSES,
    SAGA_CYCLE_MODES,
    normalizeSignalThread,
    listSignalThreads,
    loadSignalThread,
    saveSignalThread,
    createSignalThread,
    updateSignalThread,
    deleteSignalThread,
    addReflection,
    addObservation,
    setCompression,
    saveSagaCycle,
    exportSignalThreadMarkdown,
};
