'use strict';

/**
 * Ember Node v.ᚠ — Phase 18A: Session Service
 *
 * A Session is the primary unit of the Instrument Panel experience.
 * Sessions move through five stages: observe → reflect → act → refine → archive.
 *
 * Storage: each session is a single JSON file in SESSIONS_DIR/<id>.json
 *
 * Future: Sessions are designed so they can later be grouped into Signal Threads.
 */

const fs   = require('fs');
const path = require('path');
const { SESSIONS_DIR } = require('./storageConfig');

// ── Constants ─────────────────────────────────────────────────────────────────

const SESSION_STAGES = Object.freeze([
    'observe',
    'reflect',
    'act',
    'refine',
    'archive',
]);

// ── Internal helpers ──────────────────────────────────────────────────────────

function _nowIso() {
    return new Date().toISOString();
}

function _ensureDir() {
    if (!fs.existsSync(SESSIONS_DIR)) {
        fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    }
}

/**
 * Produce a filesystem-safe ID suffix from an ISO date string.
 * e.g. "2026-06-20T03:44:39.123Z" → "20260620-034439-123"
 * @param {string} isoStr
 * @returns {string}
 */
function _isoToCompact(isoStr) {
    const m = String(isoStr || '').match(
        /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.?(\d*)/,
    );
    // Fallback: use epoch millis as a plain numeric string when input is not ISO
    if (!m) return String(Date.now());
    const ms = m[7] ? m[7].slice(0, 3).padEnd(3, '0') : '000';
    return m[1] + m[2] + m[3] + '-' + m[4] + m[5] + m[6] + '-' + ms;
}

/**
 * Sanitise an untrusted session ID to prevent path traversal.
 * Allows only alphanumeric, hyphens, and underscores.
 * @param {string} id
 * @returns {string}
 */
function _safeId(id) {
    return String(id || '').replace(/[^a-zA-Z0-9_-]/g, '_');
}

function _sessionPath(id) {
    return path.join(SESSIONS_DIR, _safeId(id) + '.json');
}

function _normalizeStage(stage) {
    const value = String(stage || '').trim().toLowerCase();
    return SESSION_STAGES.includes(value) ? value : 'observe';
}

function _normalizeEntry(entry) {
    const e = entry && typeof entry === 'object' ? entry : {};
    return {
        stage: _normalizeStage(e.stage),
        notes: String(e.notes || ''),
        completedAt: e.completedAt ? String(e.completedAt) : null,
    };
}

function _normalizeContinuity(continuity) {
    const c = continuity && typeof continuity === 'object' ? continuity : {};
    return {
        threadId: String(c.threadId || ''),
        threadTitle: String(c.threadTitle || ''),
        openPressure: String(c.openPressure || ''),
        mostRecentReflection: String(c.mostRecentReflection || ''),
        lastSessionDate: String(c.lastSessionDate || ''),
    };
}

function _safeReadJson(filePath) {
    if (!fs.existsSync(filePath)) return null;
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return null;
    }
}

// ── Public normalization ──────────────────────────────────────────────────────

/**
 * Normalize a raw session object from disk or from user input.
 * @param {object} raw
 * @returns {object}
 */
function normalizeSession(raw) {
    const data = raw && typeof raw === 'object' ? raw : {};
    const now = _nowIso();
    return {
        id:           String(data.id || ''),
        title:        String(data.title || '').trim() || 'Untitled Session',
        createdAt:    data.createdAt  ? String(data.createdAt)  : now,
        updatedAt:    data.updatedAt  ? String(data.updatedAt)  : now,
        currentStage: _normalizeStage(data.currentStage),
        entries:      Array.isArray(data.entries)
            ? data.entries.map(_normalizeEntry)
            : [],
        continuity: _normalizeContinuity(data.continuity),
    };
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

/**
 * List all sessions, sorted newest-first by createdAt.
 * @returns {object[]}
 */
function listSessions() {
    _ensureDir();
    return fs.readdirSync(SESSIONS_DIR)
        .filter(f => f.endsWith('.json'))
        .map(f => {
            const data = _safeReadJson(path.join(SESSIONS_DIR, f));
            return data ? normalizeSession(data) : null;
        })
        .filter(Boolean)
        .sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));
}

/**
 * Load a single session by ID.
 * @param {string} id
 * @returns {object|null}
 */
function loadSession(id) {
    _ensureDir();
    const data = _safeReadJson(_sessionPath(id));
    return data ? normalizeSession(data) : null;
}

/**
 * Create a new session.
 * @param {{ title?: string }} opts
 * @returns {object}
 */
function createSession({ title = '', continuity = null } = {}) {
    _ensureDir();
    const now = _nowIso();
    const compact = _isoToCompact(now);
    const id = 'session-' + compact;
    const session = normalizeSession({
        id,
        title: String(title || '').trim() || 'New Session',
        createdAt: now,
        updatedAt: now,
        currentStage: 'observe',
        entries: [],
        continuity: _normalizeContinuity(continuity),
    });
    fs.writeFileSync(_sessionPath(id), JSON.stringify(session, null, 2), 'utf8');
    return session;
}

/**
 * Update an existing session.  Only provided fields are changed.
 * Advances currentStage to next when an entry for the current stage is completed.
 *
 * Accepted patch fields: title, currentStage, entries (full replacement), continuity.
 *
 * @param {string} id
 * @param {object} patch
 * @returns {object|null}  Updated session, or null if not found.
 */
function updateSession(id, patch) {
    _ensureDir();
    const existing = loadSession(id);
    if (!existing) return null;

    const p = patch && typeof patch === 'object' ? patch : {};

    if (typeof p.title === 'string') {
        existing.title = p.title.trim() || existing.title;
    }
    if (typeof p.currentStage === 'string') {
        existing.currentStage = _normalizeStage(p.currentStage);
    }
    if (Array.isArray(p.entries)) {
        existing.entries = p.entries.map(_normalizeEntry);
    }
    if (p.continuity && typeof p.continuity === 'object') {
        existing.continuity = _normalizeContinuity(p.continuity);
    }

    existing.updatedAt = _nowIso();

    fs.writeFileSync(_sessionPath(id), JSON.stringify(existing, null, 2), 'utf8');
    return existing;
}

/**
 * Save notes for the current stage and optionally advance to the next stage.
 *
 * @param {string} id           Session ID
 * @param {string} stage        The stage being saved (must match currentStage)
 * @param {string} notes        User notes for the stage
 * @param {boolean} [advance]   If true, mark stage complete and advance
 * @returns {object|null}
 */
function saveStageNotes(id, stage, notes, advance = false) {
    _ensureDir();
    const existing = loadSession(id);
    if (!existing) return null;

    const normalStage = _normalizeStage(stage);

    // Remove any previous entry for this stage, then append the new one
    const entries = existing.entries.filter(e => e.stage !== normalStage);
    const entry = {
        stage: normalStage,
        notes: String(notes || ''),
        completedAt: advance ? _nowIso() : null,
    };
    entries.push(entry);
    existing.entries = entries;

    if (advance) {
        const idx = SESSION_STAGES.indexOf(normalStage);
        if (idx >= 0 && idx < SESSION_STAGES.length - 1) {
            existing.currentStage = SESSION_STAGES[idx + 1];
        }
        // If already at archive (last stage), stay there
    }

    existing.updatedAt = _nowIso();
    fs.writeFileSync(_sessionPath(id), JSON.stringify(existing, null, 2), 'utf8');
    return existing;
}

/**
 * Delete a session by ID.
 * @param {string} id
 * @returns {boolean}
 */
function deleteSession(id) {
    const filePath = _sessionPath(id);
    if (!fs.existsSync(filePath)) return false;
    fs.unlinkSync(filePath);
    return true;
}

// ── Markdown export ───────────────────────────────────────────────────────────

const STAGE_HEADINGS = Object.freeze({
    observe: 'Observe',
    reflect: 'Reflect',
    act:     'Act',
    refine:  'Refine',
    archive: 'Archive',
});

const STAGE_QUESTIONS = Object.freeze({
    observe: [
        'What are you noticing?',
        'What is happening?',
        'What is known?',
        'What is uncertain?',
    ],
    reflect: [
        'Why does this matter?',
        'What assumptions are present?',
        'What perspectives should be considered?',
    ],
    act: [
        'What is the next useful step?',
        'What can be tested?',
        'What should be avoided?',
    ],
    refine: [
        'What happened?',
        'What worked?',
        'What changed?',
        'What was learned?',
    ],
    archive: [
        'What should be remembered?',
        'What remains unresolved?',
        'What is worth carrying forward?',
    ],
});

/**
 * Export a session to a Markdown string.
 * @param {string} id
 * @returns {string|null}
 */
function exportSessionMarkdown(id) {
    const session = loadSession(id);
    if (!session) return null;

    const lines = [];
    lines.push('---');
    lines.push('title: ' + (session.title || 'Untitled Session'));
    lines.push('session_id: ' + session.id);
    lines.push('created: ' + session.createdAt);
    lines.push('updated: ' + session.updatedAt);
    lines.push('stage: ' + session.currentStage);
    if (session.continuity && session.continuity.threadId) {
        lines.push('continuity_thread: ' + session.continuity.threadId);
    }
    lines.push('---');
    lines.push('');
    lines.push('# ' + (session.title || 'Untitled Session'));
    lines.push('');
    if (session.continuity && session.continuity.threadId) {
        lines.push('## Continuity');
        lines.push('');
        lines.push('- Thread: ' + (session.continuity.threadTitle || session.continuity.threadId));
        lines.push('- Open Pressure: ' + (session.continuity.openPressure || ''));
        lines.push('- Last Reflection: ' + (session.continuity.mostRecentReflection || ''));
        lines.push('- Last Session Date: ' + (session.continuity.lastSessionDate || ''));
        lines.push('');
    }

    for (const stage of SESSION_STAGES) {
        const entry = session.entries.find(e => e.stage === stage);
        const heading = STAGE_HEADINGS[stage] || stage;
        const questions = STAGE_QUESTIONS[stage] || [];
        const completed = entry && entry.completedAt;

        lines.push('## ' + heading + (completed ? ' ✓' : ''));
        lines.push('');

        if (questions.length > 0) {
            lines.push('*' + questions.join(' · ') + '*');
            lines.push('');
        }

        if (entry && entry.notes && entry.notes.trim()) {
            lines.push(entry.notes.trim());
        } else {
            lines.push('*(not yet completed)*');
        }
        lines.push('');
    }

    return lines.join('\n');
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
    SESSION_STAGES,
    STAGE_QUESTIONS,
    STAGE_HEADINGS,
    normalizeSession,
    listSessions,
    loadSession,
    createSession,
    updateSession,
    saveStageNotes,
    deleteSession,
    exportSessionMarkdown,
};
