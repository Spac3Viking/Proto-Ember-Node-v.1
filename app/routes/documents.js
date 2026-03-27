'use strict';

/**
 * Ember Node v.ᚠ — Document Routes (Phase 9: Scribe Forge)
 *
 * GET    /api/documents
 * POST   /api/documents
 * GET    /api/documents/:id
 * PUT    /api/documents/:id
 * DELETE /api/documents/:id
 */

const crypto  = require('crypto');
const express = require('express');
const fs      = require('fs');
const path    = require('path');
const { readLimiter, writeLimiter } = require('../rateLimiters');
const { DOCUMENTS_DIR }             = require('../storageConfig');

const router = express.Router();

// ── Document persistence helpers ──────────────────────────────────────────────

function loadDocument(id) {
    const file = path.join(DOCUMENTS_DIR, id + '.json');
    if (!fs.existsSync(file)) return null;
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function saveDocument(doc) {
    fs.writeFileSync(
        path.join(DOCUMENTS_DIR, doc.id + '.json'),
        JSON.stringify(doc, null, 2),
        'utf8',
    );
}

// ── Document routes ───────────────────────────────────────────────────────────

/**
 * GET /api/documents
 * Returns all documents sorted by updatedAt descending.
 */
router.get('/api/documents', readLimiter, (req, res) => {
    const docs = fs.readdirSync(DOCUMENTS_DIR)
        .filter(f => f.endsWith('.json'))
        .map(f => {
            try { return JSON.parse(fs.readFileSync(path.join(DOCUMENTS_DIR, f), 'utf8')); }
            catch { return null; }
        })
        .filter(Boolean)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    res.json({ documents: docs });
});

/**
 * POST /api/documents
 * Body: { title?, content?, type?, linkedSources?, projectId? }
 */
router.post('/api/documents', writeLimiter, (req, res) => {
    const {
        title         = 'Untitled',
        content       = '',
        type          = 'note',
        linkedSources = [],
        projectId     = null,
    } = req.body || {};

    const id  = 'doc-' + crypto.randomUUID();
    const now = new Date().toISOString();
    const doc = { id, title, content, type, linkedSources, projectId, createdAt: now, updatedAt: now };
    saveDocument(doc);
    res.json({ success: true, document: doc });
});

/**
 * GET /api/documents/:id
 */
router.get('/api/documents/:id', readLimiter, (req, res) => {
    const doc = loadDocument(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    res.json({ document: doc });
});

/**
 * PUT /api/documents/:id
 * Body: { title?, content?, type?, linkedSources?, projectId? }
 */
router.put('/api/documents/:id', writeLimiter, (req, res) => {
    const doc = loadDocument(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    const { title, content, type, linkedSources, projectId } = req.body || {};
    if (title         !== undefined) doc.title         = title;
    if (content       !== undefined) doc.content       = content;
    if (type          !== undefined) doc.type          = type;
    if (linkedSources !== undefined) doc.linkedSources = linkedSources;
    if (projectId     !== undefined) doc.projectId     = projectId;
    doc.updatedAt = new Date().toISOString();
    saveDocument(doc);
    res.json({ success: true, document: doc });
});

/**
 * DELETE /api/documents/:id
 */
router.delete('/api/documents/:id', writeLimiter, (req, res) => {
    const file = path.join(DOCUMENTS_DIR, req.params.id + '.json');
    if (!fs.existsSync(file)) return res.status(404).json({ error: 'Document not found' });
    try {
        fs.unlinkSync(file);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Could not delete document: ' + e.message });
    }
});

module.exports = router;
