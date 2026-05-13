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
const { listCaches, loadCache: loadBundledCache } = require('../cacheLoader');
const {
    normalizeCacheManifestMetadata,
    listInstalledCaches,
    getInstalledCacheById,
    readLoadedCachesState,
    loadCache,
    unloadCache,
} = require('../loadedCaches');
const { recordCacheInteraction } = require('../cacheInteractionMemory');

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
    const caches = listCaches().map(cache => ({
        ...cache,
        ...normalizeCacheManifestMetadata(cache),
    }));
    res.json({ caches });
});

router.get('/caches/:name', (req, res) => {
    const cache = loadBundledCache(req.params.name);
    if (!cache) {
        return res.status(404).json({ error: 'Cache "' + req.params.name + '" not found.' });
    }
    const metadata = normalizeCacheManifestMetadata(cache.manifest || {});
    const loadedState = readLoadedCachesState();
    const cacheId = cache && cache.manifest && cache.manifest.id
        ? String(cache.manifest.id)
        : String(req.params.name || '');
    const loaded = loadedState.loaded.some(entry => entry.id === cacheId);
    cache.manifest = {
        ...(cache.manifest || {}),
        ...metadata,
        loaded,
    };
    res.json(cache);
});

router.get('/api/caches/installed', readLimiter, (req, res) => {
    res.json({ caches: listInstalledCaches() });
});

router.get('/api/caches/loaded', readLimiter, (req, res) => {
    const state = readLoadedCachesState();
    res.json({
        version: state.version,
        updated_at: state.updated_at,
        loaded: state.loaded,
    });
});

router.post('/api/caches/load', writeLimiter, (req, res) => {
    const cacheId = String(req.body && req.body.cacheId ? req.body.cacheId : '').trim();
    if (!cacheId) return res.status(400).json({ error: 'cacheId is required' });
    const installed = getInstalledCacheById(cacheId);
    if (!installed) return res.status(404).json({ error: 'Cache "' + cacheId + '" not found.' });
    try {
        const result = loadCache(installed);
        if (result.changed) {
            try {
                recordCacheInteraction({
                    kind: 'cache_loaded',
                    cacheId: installed.id,
                    sourcePaths: [installed.source],
                });
            } catch { /* non-blocking memory update */ }
        }
        return res.json({
            success: true,
            changed: result.changed,
            loaded: result.state.loaded,
        });
    } catch (err) {
        return res.status(err.status || 500).json({ error: err.message || 'Could not load cache.' });
    }
});

router.post('/api/caches/unload', writeLimiter, (req, res) => {
    const cacheId = String(req.body && req.body.cacheId ? req.body.cacheId : '').trim();
    if (!cacheId) return res.status(400).json({ error: 'cacheId is required' });
    try {
        const result = unloadCache(cacheId);
        if (result.changed) {
            try {
                recordCacheInteraction({
                    kind: 'cache_unloaded',
                    cacheId,
                });
            } catch { /* non-blocking memory update */ }
        }
        return res.json({
            success: true,
            changed: result.changed,
            loaded: result.state.loaded,
        });
    } catch (err) {
        return res.status(err.status || 500).json({ error: err.message || 'Could not unload cache.' });
    }
});

module.exports = router;
