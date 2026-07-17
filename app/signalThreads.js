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

function _normalizeSessionIds(sessionIds) {
    if (!Array.isArray(sessionIds)) return [];
    const seen = new Set();
    const out = [];
    sessionIds.forEach(id => {
        const cleaned = _safeId(String(id || '').trim());
        if (!cleaned) return;
        if (seen.has(cleaned)) return;
        seen.add(cleaned);
        out.push(cleaned);
    });
    return out;
}

function _normalizeTextList(value) {
    if (Array.isArray(value)) {
        const seen = new Set();
        const out = [];
        value.forEach(item => {
            const cleaned = String(item || '').trim();
            if (!cleaned) return;
            const key = cleaned.toLowerCase();
            if (seen.has(key)) return;
            seen.add(key);
            out.push(cleaned);
        });
        return out;
    }
    const raw = String(value || '').trim();
    if (!raw) return [];
    return _normalizeTextList(raw.split(/\r?\n+/g));
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

function _normalizeCarryForwardEntry(entry) {
    const row = entry && typeof entry === 'object' ? entry : {};
    return {
        id: String(row.id || ''),
        timestamp: row.timestamp ? String(row.timestamp) : null,
        content: String(row.content || ''),
        sessionId: String(row.sessionId || ''),
    };
}

function normalizeSignalThread(raw) {
    const data = raw && typeof raw === 'object' ? raw : {};
    const now = _nowIso();
    const openPressures = _normalizeTextList(data.openPressures || data.openPressure);
    return {
        id: String(data.id || ''),
        title: String(data.title || 'Untitled Signal Thread'),
        purpose: String(data.purpose || ''),
        posture: _normalizePosture(data.posture),
        status: _normalizeStatus(data.status),
        createdAt: data.createdAt ? String(data.createdAt) : now,
        updatedAt: data.updatedAt ? String(data.updatedAt) : (data.createdAt ? String(data.createdAt) : now),
        summary: String(data.summary || ''),
        currentSituation: String(data.currentSituation || ''),
        openPressure: String(data.openPressure || openPressures[0] || ''),
        openPressures,
        carryForwardEntries: Array.isArray(data.carryForwardEntries)
            ? data.carryForwardEntries.map(_normalizeCarryForwardEntry).filter(e => e.content)
            : [],
        sourceNotes: String(data.sourceNotes || ''),
        reflections: Array.isArray(data.reflections) ? data.reflections.map(_normalizeEntry) : [],
        observations: Array.isArray(data.observations) ? data.observations.map(_normalizeEntry) : [],
        compression: String(data.compression || ''),
        tags: _normalizeTags(data.tags),
        sessionIds: _normalizeSessionIds(data.sessionIds),
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
                purpose: t.purpose,
                posture: t.posture,
                status: t.status,
                createdAt: t.createdAt,
                updatedAt: t.updatedAt,
                reflectionCount: t.reflections.length,
                observationCount: t.observations.length,
                tags: t.tags,
                sessionCount: Array.isArray(t.sessionIds) ? t.sessionIds.length : 0,
                openPressureCount: Array.isArray(t.openPressures) ? t.openPressures.length : 0,
                carryForwardCount: Array.isArray(t.carryForwardEntries) ? t.carryForwardEntries.length : 0,
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
    const openPressures = _normalizeTextList(body.openPressures || body.openPressure);
    const thread = {
        id: 'thread-' + crypto.randomUUID(),
        title,
        purpose: String(body.purpose || ''),
        posture: _normalizePosture(body.posture),
        status: 'active',
        createdAt: now,
        updatedAt: now,
        summary: String(body.summary || ''),
        currentSituation: String(body.currentSituation || ''),
        openPressure: String(body.openPressure || openPressures[0] || ''),
        openPressures,
        carryForwardEntries: Array.isArray(body.carryForwardEntries)
            ? body.carryForwardEntries.map(_normalizeCarryForwardEntry).filter(e => e.content)
            : [],
        sourceNotes: String(body.sourceNotes || ''),
        reflections: [],
        observations: [],
        compression: '',
        tags: _normalizeTags(body.tags),
        sessionIds: _normalizeSessionIds(body.sessionIds),
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
    if (typeof data.purpose === 'string') existing.purpose = data.purpose;
    if (typeof data.posture === 'string') existing.posture = _normalizePosture(data.posture);
    if (typeof data.status === 'string') existing.status = _normalizeStatus(data.status);
    if (typeof data.summary === 'string') existing.summary = data.summary;
    if (typeof data.currentSituation === 'string') existing.currentSituation = data.currentSituation;
    if (typeof data.openPressure === 'string') {
        existing.openPressure = data.openPressure;
        existing.openPressures = _normalizeTextList(data.openPressure);
    }
    if (Array.isArray(data.openPressures)) {
        existing.openPressures = _normalizeTextList(data.openPressures);
        existing.openPressure = existing.openPressures[0] || '';
    }
    if (Array.isArray(data.carryForwardEntries)) {
        existing.carryForwardEntries = data.carryForwardEntries
            .map(_normalizeCarryForwardEntry)
            .filter(e => e.content);
    }
    if (typeof data.sourceNotes === 'string') existing.sourceNotes = data.sourceNotes;
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

function addSessionToSignalThread(threadId, sessionId) {
    const thread = loadSignalThread(threadId);
    if (!thread) return null;
    const normalized = _normalizeSessionIds([sessionId]);
    if (normalized.length === 0) throw new Error('Session id is required');
    if (!Array.isArray(thread.sessionIds)) thread.sessionIds = [];
    if (!thread.sessionIds.includes(normalized[0])) {
        thread.sessionIds.push(normalized[0]);
        thread.updatedAt = _nowIso();
        saveSignalThread(thread);
    }
    return thread;
}

function addOpenPressure(threadId, openPressure) {
    const thread = loadSignalThread(threadId);
    if (!thread) return null;
    const text = String(openPressure || '').trim();
    if (!text) return thread;
    if (!Array.isArray(thread.openPressures)) thread.openPressures = [];
    const exists = thread.openPressures.some(item => String(item || '').trim().toLowerCase() === text.toLowerCase());
    if (exists) return thread;
    thread.openPressures.push(text);
    thread.openPressure = thread.openPressures[0] || '';
    thread.updatedAt = _nowIso();
    return saveSignalThread(thread);
}

function addCarryForwardEntry(threadId, content, sessionId) {
    const thread = loadSignalThread(threadId);
    if (!thread) return null;
    const text = String(content || '').trim();
    if (!text) return null;
    if (!Array.isArray(thread.carryForwardEntries)) thread.carryForwardEntries = [];
    const normalizedSessionId = String(sessionId || '').trim();
    const existing = thread.carryForwardEntries.find(entry =>
        String(entry.sessionId || '') === normalizedSessionId &&
        String(entry.content || '').trim() === text,
    );
    if (existing) return existing;
    const entry = {
        id: 'carry-forward-' + crypto.randomUUID(),
        timestamp: _nowIso(),
        content: text,
        sessionId: normalizedSessionId,
    };
    thread.carryForwardEntries.push(entry);
    thread.updatedAt = entry.timestamp;
    saveSignalThread(thread);
    return entry;
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

function _parseSagaCycleObservation(entry) {
    const stamp = entry && entry.timestamp ? String(entry.timestamp) : '';
    const raw = entry && entry.content ? String(entry.content) : '';
    if (!raw.trim().startsWith('Saga Smith — Cycle')) return null;

    const lines = raw.split('\n');
    let mode = '';
    let section = '';
    const sections = { situation: [], application: [], observation: [] };

    lines.forEach((line, index) => {
        if (index === 0) return;
        const trimmed = String(line || '').trimEnd();
        if (!trimmed.trim()) return;
        if (trimmed.startsWith('Mode:')) {
            mode = trimmed.slice('Mode:'.length).trim();
            return;
        }
        if (trimmed === 'Situation') { section = 'situation'; return; }
        if (trimmed === 'Application') { section = 'application'; return; }
        if (trimmed === 'Observation') { section = 'observation'; return; }
        if (section && sections[section]) sections[section].push(trimmed);
    });

    return {
        timestamp: stamp,
        mode,
        situation: sections.situation.join('\n').trim(),
        application: sections.application.join('\n').trim(),
        observation: sections.observation.join('\n').trim(),
    };
}

function _parseSagaCycleReflection(entry) {
    const stamp = entry && entry.timestamp ? String(entry.timestamp) : '';
    const raw = entry && entry.content ? String(entry.content) : '';
    if (!raw.trim().startsWith('Saga Smith — Reflection')) return null;

    const lines = raw.split('\n');
    let mode = '';
    let inReflection = false;
    const reflectionLines = [];
    lines.forEach((line, index) => {
        if (index === 0) return;
        const trimmed = String(line || '').trimEnd();
        if (trimmed.startsWith('Mode:')) {
            mode = trimmed.slice('Mode:'.length).trim();
            return;
        }
        if (trimmed === 'Reflection') {
            inReflection = true;
            return;
        }
        if (!inReflection) return;
        reflectionLines.push(trimmed);
    });

    return {
        timestamp: stamp,
        mode,
        reflection: reflectionLines.join('\n').trim(),
    };
}

function _deriveSagaCycles(thread) {
    const t = normalizeSignalThread(thread);
    const map = new Map();

    t.observations.forEach(entry => {
        const parsed = _parseSagaCycleObservation(entry);
        if (!parsed || !parsed.timestamp) return;
        const existing = map.get(parsed.timestamp) || { timestamp: parsed.timestamp };
        map.set(parsed.timestamp, { ...existing, ...parsed });
    });

    t.reflections.forEach(entry => {
        const parsed = _parseSagaCycleReflection(entry);
        if (!parsed || !parsed.timestamp) return;
        const existing = map.get(parsed.timestamp) || { timestamp: parsed.timestamp };
        map.set(parsed.timestamp, { ...existing, ...parsed });
    });

    return Array.from(map.values())
        .filter(row => row && row.timestamp)
        .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
}

function exportSignalThreadMarkdown(thread) {
    const t = normalizeSignalThread(thread);
    const lines = [];
    lines.push('# Signal Thread');
    lines.push('');
    lines.push('## Overview');
    lines.push('Title: ' + (t.title || ''));
    lines.push('Purpose: ' + String(t.purpose || ''));
    lines.push('Posture: ' + (t.posture || ''));
    lines.push('Status: ' + (t.status || ''));
    lines.push('Tags: ' + (Array.isArray(t.tags) && t.tags.length ? t.tags.join(', ') : ''));
    lines.push('Thread Note: ' + String(t.summary || ''));
    lines.push('Created: ' + (t.createdAt || ''));
    lines.push('Last Updated: ' + (t.updatedAt || ''));
    lines.push('');
    lines.push('## Current Compression');
    lines.push(String(t.compression || ''));
    lines.push('');
    lines.push('## Current Situation');
    lines.push(String(t.currentSituation || ''));
    lines.push('');
    lines.push('## Open Pressure');
    lines.push(String(t.openPressure || ''));
    lines.push('');
    lines.push('## Open Pressures');
    const pressureList = Array.isArray(t.openPressures) ? t.openPressures : [];
    if (!pressureList.length) {
        lines.push('');
    } else {
        pressureList.forEach(item => lines.push('- ' + String(item)));
    }
    lines.push('');
    lines.push('## Carry Forward');
    const carryForward = Array.isArray(t.carryForwardEntries)
        ? t.carryForwardEntries.slice().sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')))
        : [];
    if (!carryForward.length) {
        lines.push('');
    } else {
        carryForward.forEach(item => {
            const stamp = item && item.timestamp ? String(item.timestamp) : '';
            lines.push('- ' + (stamp ? (stamp + ' — ') : '') + String(item && item.content ? item.content : ''));
        });
    }
    lines.push('');
    lines.push('## Application / Observation / Reflection');
    const latestCycle = _deriveSagaCycles(t)[0];
    if (!latestCycle) {
        lines.push('');
    } else {
        lines.push('Cycle: ' + String(latestCycle.timestamp || ''));
        if (latestCycle.mode) lines.push('Mode: ' + String(latestCycle.mode));
        lines.push('');
        lines.push('Application');
        lines.push(String(latestCycle.application || ''));
        lines.push('');
        lines.push('Observation');
        lines.push(String(latestCycle.observation || ''));
        lines.push('');
        lines.push('Reflection');
        lines.push(String(latestCycle.reflection || ''));
        lines.push('');
    }
    lines.push('## Recent Observations');
    const obs = Array.isArray(t.observations) ? t.observations.slice().sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || ''))) : [];
    if (obs.length === 0) lines.push('');
    obs.forEach(o => {
        const stamp = o && o.timestamp ? String(o.timestamp) : '';
        lines.push('- ' + stamp);
        lines.push('');
        lines.push(String(o && o.content ? o.content : ''));
        lines.push('');
    });
    lines.push('## Recent Reflections');
    const refl = Array.isArray(t.reflections) ? t.reflections.slice().sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || ''))) : [];
    if (refl.length === 0) lines.push('');
    refl.forEach(r => {
        const stamp = r && r.timestamp ? String(r.timestamp) : '';
        lines.push('- ' + stamp);
        lines.push('');
        lines.push(String(r && r.content ? r.content : ''));
        lines.push('');
    });
    lines.push('## Saga Cycles');
    const cycles = _deriveSagaCycles(t);
    if (cycles.length === 0) {
        lines.push('');
    } else {
        cycles.forEach(cycle => {
            lines.push('- ' + String(cycle.timestamp || ''));
            if (cycle.mode) lines.push('  mode: ' + String(cycle.mode));
            if (cycle.situation) lines.push('  situation: ' + String(cycle.situation).replace(/\n/g, '\n  '));
            if (cycle.application) lines.push('  application: ' + String(cycle.application).replace(/\n/g, '\n  '));
            if (cycle.observation) lines.push('  observation: ' + String(cycle.observation).replace(/\n/g, '\n  '));
            if (cycle.reflection) lines.push('  reflection: ' + String(cycle.reflection).replace(/\n/g, '\n  '));
            lines.push('');
        });
    }
    lines.push('## Source Notes');
    lines.push(String(t.sourceNotes || ''));
    lines.push('');
    return lines.join('\n');
}

function exportSignalThreadBrief(thread) {
    const t = normalizeSignalThread(thread);

    function block(label, value) {
        const lines = [];
        lines.push(label + ':');
        lines.push(String(value || '').trim());
        return lines.join('\n');
    }

    function entryList(title, entries) {
        const out = [];
        out.push(title + ':');
        const list = Array.isArray(entries) ? entries.slice().sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || ''))) : [];
        if (list.length === 0) {
            out.push('');
            return out.join('\n');
        }
        list.forEach(entry => {
            const stamp = entry && entry.timestamp ? String(entry.timestamp) : '';
            out.push('- ' + stamp);
            const content = entry && entry.content ? String(entry.content) : '';
            content.split('\n').forEach(line => {
                out.push('  ' + line);
            });
            out.push('');
        });
        return out.join('\n').trimEnd();
    }

    const lines = [];
    lines.push('SIGNAL THREAD');
    lines.push('');
    lines.push('Overview:');
    lines.push('Title: ' + String(t.title || ''));
    lines.push('Purpose: ' + String(t.purpose || '').trim());
    lines.push('Posture: ' + String(t.posture || ''));
    lines.push('Status: ' + String(t.status || ''));
    lines.push('Tags: ' + (Array.isArray(t.tags) && t.tags.length ? t.tags.join(', ') : ''));
    lines.push('Thread Note: ' + String(t.summary || '').trim());
    lines.push('Last Updated: ' + String(t.updatedAt || ''));
    lines.push('');
    lines.push(block('Current Compression', t.compression));
    lines.push('');
    lines.push(block('Current Situation', t.currentSituation));
    lines.push('');
    lines.push(block('Open Pressure', t.openPressure));
    lines.push('');
    lines.push(block(
        'Open Pressures',
        Array.isArray(t.openPressures) && t.openPressures.length
            ? t.openPressures.map(item => '- ' + item).join('\n')
            : '',
    ));
    lines.push('');
    lines.push(entryList('Carry Forward', t.carryForwardEntries));
    lines.push('');
    lines.push('Application / Observation / Reflection:');
    const currentCycle = _deriveSagaCycles(t)[0];
    if (!currentCycle) {
        lines.push('');
    } else {
        lines.push('- ' + String(currentCycle.timestamp || '') + (currentCycle.mode ? (' (' + String(currentCycle.mode) + ')') : ''));
        if (currentCycle.application) lines.push('  application: ' + String(currentCycle.application).replace(/\n/g, '\n  '));
        if (currentCycle.observation) lines.push('  observation: ' + String(currentCycle.observation).replace(/\n/g, '\n  '));
        if (currentCycle.reflection) lines.push('  reflection: ' + String(currentCycle.reflection).replace(/\n/g, '\n  '));
        lines.push('');
    }
    lines.push(entryList('Recent Observations', t.observations));
    lines.push('');
    lines.push(entryList('Recent Reflections', t.reflections));
    lines.push('');
    lines.push('Saga Cycles:');
    const cycles = _deriveSagaCycles(t);
    if (cycles.length === 0) {
        lines.push('');
    } else {
        cycles.forEach(cycle => {
            lines.push('- ' + String(cycle.timestamp || ''));
            if (cycle.mode) lines.push('  mode: ' + String(cycle.mode));
            if (cycle.situation) {
                lines.push('  situation: ' + String(cycle.situation).replace(/\n/g, '\n  '));
            }
            if (cycle.application) {
                lines.push('  application: ' + String(cycle.application).replace(/\n/g, '\n  '));
            }
            if (cycle.observation) {
                lines.push('  observation: ' + String(cycle.observation).replace(/\n/g, '\n  '));
            }
            if (cycle.reflection) {
                lines.push('  reflection: ' + String(cycle.reflection).replace(/\n/g, '\n  '));
            }
            lines.push('');
        });
    }
    lines.push(block('Source Notes', t.sourceNotes));
    return lines.join('\n').trimEnd() + '\n';
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
    addSessionToSignalThread,
    addOpenPressure,
    addCarryForwardEntry,
    saveSagaCycle,
    exportSignalThreadMarkdown,
    exportSignalThreadBrief,
};
