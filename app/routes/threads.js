'use strict';

/**
 * Ember Node v.ᚠ — Thread Routes
 *
 * GET    /api/threads
 * POST   /api/threads
 * GET    /api/threads/:id
 * POST   /api/threads/:id/messages
 * PUT    /api/threads/:id
 * POST   /api/threads/:id/archive
 * POST   /api/threads/:id/remember
 * DELETE /api/threads/:id
 *
 * Phase 11: Thread states — 'active' | 'archived' | 'remembered'
 * Remembering a thread generates a durable summarized memory object.
 */

const crypto  = require('crypto');
const express = require('express');
const fs      = require('fs');
const path    = require('path');
const { readLimiter, writeLimiter } = require('../rateLimiters');
const { THREADS_DIR } = require('../storageConfig');
const { rememberThread, deleteThreadSummary } = require('../threadMemory');

const router = express.Router();

function normalizeRoom(room) {
    // Legacy migration alias. Remove after user data migration stabilizes.
    return room === 'workshop' ? 'council' : room;
}

// ── Thread persistence helpers ────────────────────────────────────────────────

function loadThread(id) {
    const file = path.join(THREADS_DIR, id + '.json');
    if (!fs.existsSync(file)) return null;
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function saveThread(thread) {
    fs.writeFileSync(
        path.join(THREADS_DIR, thread.id + '.json'),
        JSON.stringify(thread, null, 2),
        'utf8',
    );
}

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * GET /api/threads
 * Returns all thread summaries (id, title, room, status, createdAt, messageCount).
 */
router.get('/api/threads', readLimiter, (req, res) => {
    const { room, status } = req.query;
    const threads = fs.readdirSync(THREADS_DIR)
        .filter(f => f.endsWith('.json'))
        .map(f => {
            try {
                const t = JSON.parse(fs.readFileSync(path.join(THREADS_DIR, f), 'utf8'));
                return {
                    id:           t.id,
                    title:        t.title,
                    room:         normalizeRoom(t.room),
                    status:       t.status || 'active',
                    createdAt:    t.createdAt,
                    updatedAt:    t.updatedAt,
                    messageCount: (t.messages || []).length,
                };
            } catch { return null; }
        })
        .filter(Boolean)
        .filter(t => !room   || t.room   === normalizeRoom(room))
        .filter(t => !status || t.status === status)
        .sort(function(a, b) { return b.updatedAt.localeCompare(a.updatedAt); });
    res.json({ threads });
});

/**
 * POST /api/threads
 * Body: { title, room? }
 */
router.post('/api/threads', writeLimiter, (req, res) => {
    const { title = 'New Thread', room: roomInput = 'hearth' } = req.body || {};
    const room = normalizeRoom(roomInput);
    const validRooms = ['hearth', 'council'];
    if (!validRooms.includes(room)) {
        return res.status(400).json({ error: 'Invalid room "' + room + '"' });
    }
    const id     = 'thread-' + crypto.randomUUID();
    const now    = new Date().toISOString();
    const thread = { id, title, room, status: 'active', createdAt: now, updatedAt: now, messages: [] };
    saveThread(thread);
    res.json({ success: true, thread });
});

/**
 * GET /api/threads/:id
 */
router.get('/api/threads/:id', readLimiter, (req, res) => {
    const thread = loadThread(req.params.id);
    if (!thread) return res.status(404).json({ error: 'Thread not found' });
    res.json({ thread });
});

/**
 * POST /api/threads/:id/messages
 * Body: { role, content }
 */
router.post('/api/threads/:id/messages', writeLimiter, (req, res) => {
    const thread = loadThread(req.params.id);
    if (!thread) return res.status(404).json({ error: 'Thread not found' });
    const { role, content } = req.body || {};
    if (!role || !content) return res.status(400).json({ error: 'role and content are required' });
    const message = { role, content, timestamp: new Date().toISOString() };
    thread.messages.push(message);
    thread.updatedAt = message.timestamp;
    saveThread(thread);
    res.json({ success: true, message });
});

/**
 * PUT /api/threads/:id
 * Body: { title? }
 */
router.put('/api/threads/:id', writeLimiter, (req, res) => {
    const thread = loadThread(req.params.id);
    if (!thread) return res.status(404).json({ error: 'Thread not found' });
    const { title } = req.body || {};
    if (title) thread.title = title;
    thread.updatedAt = new Date().toISOString();
    saveThread(thread);
    res.json({ success: true, thread });
});

// ── Phase 11: Thread state actions ───────────────────────────────────────────

/**
 * POST /api/threads/:id/archive
 * Moves a thread to 'archived' status.
 */
router.post('/api/threads/:id/archive', writeLimiter, (req, res) => {
    const thread = loadThread(req.params.id);
    if (!thread) return res.status(404).json({ error: 'Thread not found' });
    thread.status    = 'archived';
    thread.updatedAt = new Date().toISOString();
    saveThread(thread);
    res.json({ success: true, thread });
});

/**
 * POST /api/threads/:id/remember
 * Promotes a thread to 'remembered' status and generates a durable
 * memory summary object stored under hearth/remembered-threads/.
 *
 * Response: { success, thread, summary }
 */
router.post('/api/threads/:id/remember', writeLimiter, (req, res) => {
    const thread = loadThread(req.params.id);
    if (!thread) return res.status(404).json({ error: 'Thread not found' });

    thread.status    = 'remembered';
    thread.updatedAt = new Date().toISOString();
    saveThread(thread);

    let summary = null;
    try {
        summary = rememberThread(thread);
    } catch (err) {
        console.warn('[threads] Could not generate memory summary for ' + thread.id + ': ' + err.message);
    }

    res.json({ success: true, thread, summary });
});

/**
 * DELETE /api/threads/:id
 * Permanently deletes a thread and its memory summary if present.
 */
router.delete('/api/threads/:id', writeLimiter, (req, res) => {
    const file = path.join(THREADS_DIR, req.params.id + '.json');
    if (!fs.existsSync(file)) return res.status(404).json({ error: 'Thread not found' });

    try {
        fs.unlinkSync(file);
    } catch (err) {
        return res.status(500).json({ error: 'Could not delete thread: ' + err.message });
    }

    // Also remove any remembered-thread summary
    try { deleteThreadSummary(req.params.id); } catch { /* ignore */ }

    res.json({ success: true });
});

module.exports = router;
