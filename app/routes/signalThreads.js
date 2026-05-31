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
    saveSagaCycle,
    exportSignalThreadMarkdown,
} = require('../signalThreads');

const router = express.Router();

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
    const { title, posture, summary, tags, currentSituation, openPressure, sourceNotes } = req.body || {};
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

module.exports = router;
