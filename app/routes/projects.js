'use strict';

/**
 * Ember Node v.ᚠ — Project Routes
 *
 * GET    /api/projects
 * POST   /api/projects
 * GET    /api/projects/:id
 * PUT    /api/projects/:id
 * POST   /api/projects/:id/sources
 * DELETE /api/projects/:id/sources/:sourceId
 * GET    /api/user-cartridges
 * POST   /api/user-cartridges
 * GET    /cartridges
 * GET    /cartridges/:name
 */

const crypto  = require('crypto');
const express = require('express');
const fs      = require('fs');
const path    = require('path');
const { readLimiter, writeLimiter }        = require('../rateLimiters');
const { PROJECTS_DIR, USER_CARTRIDGES_DIR } = require('../storageConfig');
const { loadManifests }                     = require('../indexStore');
const { listCartridges, loadCartridge }     = require('../cartridgeLoader');

const router = express.Router();

// ── Project persistence helpers ───────────────────────────────────────────────

function loadProject(id) {
    const file = path.join(PROJECTS_DIR, id + '.json');
    if (!fs.existsSync(file)) return null;
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function saveProject(project) {
    fs.writeFileSync(
        path.join(PROJECTS_DIR, project.id + '.json'),
        JSON.stringify(project, null, 2),
        'utf8',
    );
}

// ── Project routes ────────────────────────────────────────────────────────────

/**
 * GET /api/projects
 */
router.get('/api/projects', readLimiter, (req, res) => {
    const projects = fs.readdirSync(PROJECTS_DIR)
        .filter(f => f.endsWith('.json'))
        .map(f => {
            try { return JSON.parse(fs.readFileSync(path.join(PROJECTS_DIR, f), 'utf8')); }
            catch { return null; }
        })
        .filter(Boolean)
        .sort(function(a, b) { return b.updatedAt.localeCompare(a.updatedAt); });
    res.json({ projects });
});

/**
 * POST /api/projects
 * Body: { title, notes?, linkedSources? }
 */
router.post('/api/projects', writeLimiter, (req, res) => {
    const { title = 'Untitled Project', notes = '', linkedSources = [] } = req.body || {};
    const id      = 'project-' + crypto.randomUUID();
    const now     = new Date().toISOString();
    const project = { id, title, notes, linkedSources, createdAt: now, updatedAt: now, threadId: null };
    saveProject(project);
    res.json({ success: true, project });
});

/**
 * GET /api/projects/:id
 */
router.get('/api/projects/:id', readLimiter, (req, res) => {
    const project = loadProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.json({ project });
});

/**
 * PUT /api/projects/:id
 * Body: { title?, notes?, linkedSources?, threadId? }
 */
router.put('/api/projects/:id', writeLimiter, (req, res) => {
    const project = loadProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const { title, notes, linkedSources, threadId } = req.body || {};
    if (title         !== undefined) project.title         = title;
    if (notes         !== undefined) project.notes         = notes;
    if (linkedSources !== undefined) project.linkedSources = linkedSources;
    if (threadId      !== undefined) project.threadId      = threadId;
    project.updatedAt = new Date().toISOString();
    saveProject(project);
    res.json({ success: true, project });
});

/**
 * POST /api/projects/:id/sources
 * Body: { sourceId }
 */
router.post('/api/projects/:id/sources', writeLimiter, (req, res) => {
    const project = loadProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const { sourceId } = req.body || {};
    if (!sourceId) return res.status(400).json({ error: 'sourceId is required' });

    const manifests = loadManifests();
    const source    = manifests[sourceId];
    if (!source) return res.status(404).json({ error: 'Source not found' });

    if (!project.linkedSources) project.linkedSources = [];

    const alreadyLinked = project.linkedSources.some(ls =>
        (typeof ls === 'string' ? ls : ls.sourceId) === sourceId
    );

    if (!alreadyLinked) {
        project.linkedSources.push({
            sourceId:    source.id,
            title:       source.title || source.file || source.id,
            room:        source.room,
            status:      source.status,
            description: source.description || null,
            addedAt:     new Date().toISOString(),
        });
        project.updatedAt = new Date().toISOString();
        saveProject(project);
    }

    res.json({ success: true, project });
});

/**
 * DELETE /api/projects/:id/sources/:sourceId
 */
router.delete('/api/projects/:id/sources/:sourceId', writeLimiter, (req, res) => {
    const project = loadProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    project.linkedSources = (project.linkedSources || []).filter(ls =>
        (typeof ls === 'string' ? ls : ls.sourceId) !== req.params.sourceId
    );
    project.updatedAt = new Date().toISOString();
    saveProject(project);

    res.json({ success: true, project });
});

// ── User cartridges ───────────────────────────────────────────────────────────

/**
 * GET /api/user-cartridges
 */
router.get('/api/user-cartridges', readLimiter, (req, res) => {
    const cartridges = fs.readdirSync(USER_CARTRIDGES_DIR)
        .filter(f => f.endsWith('.json'))
        .map(f => {
            try { return JSON.parse(fs.readFileSync(path.join(USER_CARTRIDGES_DIR, f), 'utf8')); }
            catch { return null; }
        })
        .filter(Boolean)
        .sort(function(a, b) { return b.createdAt.localeCompare(a.createdAt); });
    res.json({ cartridges });
});

/**
 * POST /api/user-cartridges
 * Body: { title, description?, sources?, notes? }
 */
router.post('/api/user-cartridges', writeLimiter, (req, res) => {
    const { title, description = '', sources = [], notes = '' } = req.body || {};
    if (!title) return res.status(400).json({ error: 'title is required' });
    const id        = 'cartridge-' + crypto.randomUUID();
    const now       = new Date().toISOString();
    const cartridge = { id, title, description, sources, notes, createdAt: now, updatedAt: now, ownership: 'user' };
    fs.writeFileSync(path.join(USER_CARTRIDGES_DIR, id + '.json'), JSON.stringify(cartridge, null, 2), 'utf8');
    res.json({ success: true, cartridge });
});

// ── Bundled cartridges ────────────────────────────────────────────────────────

/**
 * GET /cartridges
 */
router.get('/cartridges', (req, res) => {
    res.json({ cartridges: listCartridges() });
});

/**
 * GET /cartridges/:name
 */
router.get('/cartridges/:name', (req, res) => {
    const cartridge = loadCartridge(req.params.name);
    if (!cartridge) {
        return res.status(404).json({ error: 'Cartridge "' + req.params.name + '" not found.' });
    }
    res.json(cartridge);
});

module.exports = router;
