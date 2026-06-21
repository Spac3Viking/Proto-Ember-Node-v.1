'use strict';

/**
 * Ember Node v.ᚠ — Signal Thread Routes (Phase 17E foundations)
 *
 * GET    /api/signal-threads
 * POST   /api/signal-threads
 * GET    /api/signal-threads/:id
 * PUT    /api/signal-threads/:id
 * DELETE /api/signal-threads/:id
 * POST   /api/signal-threads/:id/reflections
 * POST   /api/signal-threads/:id/observations
 * PUT    /api/signal-threads/:id/compression
 * POST   /api/signal-threads/:id/saga-cycle
 * GET    /api/signal-threads/:id/export
 *
 * Signal Threads are a continuity layer distinct from conversation threads.
 */

const express = require('express');

const { readLimiter, writeLimiter } = require('../rateLimiters');
const {
    SIGNAL_THREAD_POSTURES,
    SIGNAL_THREAD_STATUSES,
    listSignalThreads,
    loadSignalThread,
    createSignalThread,
    updateSignalThread,
    deleteSignalThread,
    addReflection,
    addObservation,
    setCompression,
    addSessionToSignalThread,
    saveSagaCycle,
    exportSignalThreadMarkdown,
    exportSignalThreadBrief,
} = require('../signalThreads');
const { loadSession } = require('../sessions');

const router = express.Router();
const SUMMARY_UNRESOLVED_PATTERN = /\?|uncertain|unknown|blocked|stuck|pressure|risk/i;
const SUMMARY_PROGRESS_PATTERN = /done|improv|progress|worked|learned|completed|resolved/i;

function _safeFilenameTitle(title) {
    const base = String(title || 'signal-thread')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
    return base || 'signal-thread';
}

router.get('/api/signal-threads', readLimiter, (req, res) => {
    const threads = listSignalThreads();
    res.json({ threads });
});

router.post('/api/signal-threads', writeLimiter, (req, res) => {
    const { title, posture, summary, tags, currentSituation, openPressure, sourceNotes, sessionIds } = req.body || {};
    const t = String(title || '').trim();
    if (!t) return res.status(400).json({ error: 'Title is required' });
    const p = String(posture || '').trim().toLowerCase();
    if (!p || !SIGNAL_THREAD_POSTURES.includes(p)) {
        return res.status(400).json({ error: 'Invalid posture' });
    }
    try {
        const thread = createSignalThread({
            title: t,
            posture: p,
            summary: String(summary || ''),
            currentSituation: String(currentSituation || ''),
            openPressure: String(openPressure || ''),
            sourceNotes: String(sourceNotes || ''),
            tags: Array.isArray(tags) ? tags : [],
            sessionIds: Array.isArray(sessionIds) ? sessionIds : [],
        });
        res.json({ success: true, thread });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/api/signal-threads/:id', readLimiter, (req, res) => {
    const thread = loadSignalThread(req.params.id);
    if (!thread) return res.status(404).json({ error: 'Signal Thread not found' });
    res.json({ thread });
});

router.put('/api/signal-threads/:id', writeLimiter, (req, res) => {
    const patch = req.body && typeof req.body === 'object' ? req.body : {};
    if (typeof patch.posture === 'string') {
        const p = patch.posture.trim().toLowerCase();
        if (p && !SIGNAL_THREAD_POSTURES.includes(p)) {
            return res.status(400).json({ error: 'Invalid posture' });
        }
    }
    if (typeof patch.status === 'string') {
        const s = patch.status.trim().toLowerCase();
        if (s && !SIGNAL_THREAD_STATUSES.includes(s)) {
            return res.status(400).json({ error: 'Invalid status' });
        }
    }

    const thread = updateSignalThread(req.params.id, patch);
    if (!thread) return res.status(404).json({ error: 'Signal Thread not found' });
    res.json({ success: true, thread });
});

router.delete('/api/signal-threads/:id', writeLimiter, (req, res) => {
    const ok = deleteSignalThread(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Signal Thread not found' });
    res.json({ success: true });
});

router.post('/api/signal-threads/:id/reflections', writeLimiter, (req, res) => {
    try {
        const entry = addReflection(req.params.id, req.body && req.body.content);
        if (!entry) return res.status(404).json({ error: 'Signal Thread not found' });
        res.json({ success: true, reflection: entry });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

router.post('/api/signal-threads/:id/observations', writeLimiter, (req, res) => {
    try {
        const entry = addObservation(req.params.id, req.body && req.body.content);
        if (!entry) return res.status(404).json({ error: 'Signal Thread not found' });
        res.json({ success: true, observation: entry });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

router.put('/api/signal-threads/:id/compression', writeLimiter, (req, res) => {
    const thread = setCompression(req.params.id, req.body && req.body.compression);
    if (!thread) return res.status(404).json({ error: 'Signal Thread not found' });
    res.json({ success: true, thread });
});

router.post('/api/signal-threads/:id/sessions', writeLimiter, (req, res) => {
    const sessionId = req.body && req.body.sessionId ? String(req.body.sessionId) : '';
    if (!sessionId.trim()) return res.status(400).json({ error: 'sessionId is required' });
    const session = loadSession(sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    try {
        const thread = addSessionToSignalThread(req.params.id, sessionId);
        if (!thread) return res.status(404).json({ error: 'Signal Thread not found' });
        res.json({ success: true, thread });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

router.get('/api/signal-threads/:id/linked-sessions', readLimiter, (req, res) => {
    const thread = loadSignalThread(req.params.id);
    if (!thread) return res.status(404).json({ error: 'Signal Thread not found' });
    const ids = Array.isArray(thread.sessionIds) ? thread.sessionIds : [];
    const sessions = ids
        .map(id => loadSession(id))
        .filter(Boolean)
        .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    res.json({ sessions });
});

function _summarizeThreadSessions(thread, sessions) {
    const MAX_PATTERN_ENTRIES = 4;
    // Keep first-line snippets compact so the summary reads like a field notebook.
    const MAX_PATTERN_LENGTH = 110;
    const t = thread && typeof thread === 'object' ? thread : {};
    const list = Array.isArray(sessions) ? sessions : [];
    const stageCounts = { observe: 0, reflect: 0, act: 0, refine: 0, archive: 0 };
    const allNotes = [];
    list.forEach(s => {
        const stage = String(s.currentStage || '').toLowerCase();
        if (Object.prototype.hasOwnProperty.call(stageCounts, stage)) stageCounts[stage] += 1;
        const entries = Array.isArray(s.entries) ? s.entries : [];
        entries.forEach(e => {
            const text = String(e && e.notes ? e.notes : '').trim();
            if (text) allNotes.push(text);
        });
    });
    let unresolved = 0;
    let progress = 0;
    allNotes.forEach(n => {
        if (SUMMARY_UNRESOLVED_PATTERN.test(n)) unresolved += 1;
        if (SUMMARY_PROGRESS_PATTERN.test(n)) progress += 1;
    });
    const recurring = allNotes
        .slice(0, MAX_PATTERN_ENTRIES)
        .map(n => '- ' + n.split('\n')[0].slice(0, MAX_PATTERN_LENGTH))
        .join('\n');
    return [
        'Patterns:',
        recurring || '- Recurring details will appear as more sessions are linked.',
        '',
        'Lessons:',
        '- ' + (progress > 0 ? 'Recent notes include practical progress and retained lessons.' : 'Lessons are still emerging; continue concise archive notes.'),
        '',
        'Open Questions:',
        '- ' + (unresolved > 0 ? 'Some unresolved pressure remains in linked session notes.' : 'No explicit unresolved questions detected in current notes.'),
        '',
        'Unresolved Pressures:',
        '- ' + (stageCounts.archive < list.length ? 'Some sessions are still in-flight and not archived.' : 'Most linked sessions are archived and stable.'),
        '',
        'Recent Progress:',
        '- Thread "' + String(t.title || 'Untitled Signal Thread') + '" now links ' + String(list.length) + ' session(s).',
    ].join('\n').trim();
}

router.post('/api/signal-threads/:id/generate-summary', writeLimiter, (req, res) => {
    const thread = loadSignalThread(req.params.id);
    if (!thread) return res.status(404).json({ error: 'Signal Thread not found' });
    const ids = Array.isArray(thread.sessionIds) ? thread.sessionIds : [];
    const sessions = ids.map(id => loadSession(id)).filter(Boolean);
    const summary = _summarizeThreadSessions(thread, sessions);
    const updated = updateSignalThread(req.params.id, { summary });
    res.json({ success: true, summary, thread: updated });
});

router.post('/api/signal-threads/:id/saga-cycle', writeLimiter, (req, res) => {
    try {
        const result = saveSagaCycle(req.params.id, req.body);
        if (!result) return res.status(404).json({ error: 'Signal Thread not found' });
        res.json({
            success: true,
            thread: result.thread,
            observation: result.observation,
            reflection: result.reflection,
        });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

router.get('/api/signal-threads/:id/export', readLimiter, (req, res) => {
    const thread = loadSignalThread(req.params.id);
    if (!thread) return res.status(404).json({ error: 'Signal Thread not found' });
    const md = exportSignalThreadMarkdown(thread);
    const filename = _safeFilenameTitle(thread.title) + '.md';
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    res.send(md);
});

router.get('/api/signal-threads/:id/brief', readLimiter, (req, res) => {
    const thread = loadSignalThread(req.params.id);
    if (!thread) return res.status(404).json({ error: 'Signal Thread not found' });
    const brief = exportSignalThreadBrief(thread);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(brief);
});

module.exports = router;
