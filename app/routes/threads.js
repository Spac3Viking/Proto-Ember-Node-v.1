'use strict';

/**
 * Ember Node v.ᚠ — Thread Routes
 *
 * GET  /api/threads
 * POST /api/threads
 * GET  /api/threads/:id
 * POST /api/threads/:id/messages
 * PUT  /api/threads/:id
 */

const crypto  = require('crypto');
const express = require('express');
const fs      = require('fs');
const path    = require('path');
const { readLimiter, writeLimiter } = require('../rateLimiters');
const { THREADS_DIR } = require('../storageConfig');

const router = express.Router();

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
 * Returns all thread summaries (id, title, room, createdAt, messageCount).
 */
router.get('/api/threads', readLimiter, (req, res) => {
    const { room } = req.query;
    const threads = fs.readdirSync(THREADS_DIR)
        .filter(f => f.endsWith('.json'))
        .map(f => {
            try {
                const t = JSON.parse(fs.readFileSync(path.join(THREADS_DIR, f), 'utf8'));
                return {
                    id:           t.id,
                    title:        t.title,
                    room:         t.room,
                    createdAt:    t.createdAt,
                    updatedAt:    t.updatedAt,
                    messageCount: (t.messages || []).length,
                };
            } catch { return null; }
        })
        .filter(Boolean)
        .filter(t => !room || t.room === room)
        .sort(function(a, b) { return b.updatedAt.localeCompare(a.updatedAt); });
    res.json({ threads });
});

/**
 * POST /api/threads
 * Body: { title, room? }
 */
router.post('/api/threads', writeLimiter, (req, res) => {
    const { title = 'New Thread', room = 'hearth' } = req.body || {};
    const validRooms = ['hearth', 'workshop'];
    if (!validRooms.includes(room)) {
        return res.status(400).json({ error: 'Invalid room "' + room + '"' });
    }
    const id     = 'thread-' + crypto.randomUUID();
    const now    = new Date().toISOString();
    const thread = { id, title, room, createdAt: now, updatedAt: now, messages: [] };
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

module.exports = router;
