'use strict';

/**
 * Ember Node v.ᚠ — Cache Routes
 *
 * GET    /api/user-caches
 * POST   /api/user-caches
 * GET    /caches
 * GET    /caches/:name
 */

const crypto  = require('crypto');
const express = require('express');
const fs      = require('fs');
const path    = require('path');
const { readLimiter, writeLimiter } = require('../rateLimiters');
const { USER_CACHES_DIR } = require('../storageConfig');
const { listCaches, loadCache } = require('../cacheLoader');

const router = express.Router();

router.get('/api/user-caches', readLimiter, (req, res) => {
    const caches = fs.readdirSync(USER_CACHES_DIR)
        .filter(f => f.endsWith('.json'))
        .map(f => {
            try { return JSON.parse(fs.readFileSync(path.join(USER_CACHES_DIR, f), 'utf8')); }
            catch { return null; }
        })
        .filter(Boolean)
        .sort(function(a, b) { return b.createdAt.localeCompare(a.createdAt); });
    res.json({ caches });
});

router.post('/api/user-caches', writeLimiter, (req, res) => {
    const { title, description = '', sources = [], notes = '' } = req.body || {};
    if (!title) return res.status(400).json({ error: 'title is required' });
    const id        = 'cache-' + crypto.randomUUID();
    const now       = new Date().toISOString();
    const cache = { id, title, description, sources, notes, createdAt: now, updatedAt: now, ownership: 'user' };
    fs.writeFileSync(path.join(USER_CACHES_DIR, id + '.json'), JSON.stringify(cache, null, 2), 'utf8');
    res.json({ success: true, cache });
});

router.get('/caches', (req, res) => {
    res.json({ caches: listCaches() });
});

router.get('/caches/:name', (req, res) => {
    const cache = loadCache(req.params.name);
    if (!cache) {
        return res.status(404).json({ error: 'Cache "' + req.params.name + '" not found.' });
    }
    res.json(cache);
});

module.exports = router;
