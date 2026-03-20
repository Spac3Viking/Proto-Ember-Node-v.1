'use strict';

/**
 * Ember Node v.ᚠ — Tools Routes
 *
 * GET  /api/tools
 * POST /api/tools/scan
 * POST /api/tools/:id/trust
 * POST /api/tools/:id/role
 * GET  /api/tools/active
 * POST /api/tools/active
 * POST /api/tools/:id/launch
 * POST /api/tools/:id/inspect
 * POST /api/tools/:id/reject
 */

const express = require('express');
const { spawn } = require('child_process');
const { readLimiter, writeLimiter }        = require('../rateLimiters');
const {
    loadToolRegistry, saveToolRegistry,
    mergeDetectedTools, discoverTools, httpProbe,
}                                           = require('../toolRegistry');
const { loadIntakeState, upsertIntakeTool } = require('../intakeState');

const router = express.Router();

/**
 * GET /api/tools
 * Returns all tools in the registry with their current status.
 * Augments each tool record with its persistent intake state (if any).
 */
router.get('/api/tools', readLimiter, (req, res) => {
    const registry    = loadToolRegistry();
    const intakeState = loadIntakeState();
    const tools = (registry.tools || []).map(t => {
        const intake = (intakeState.tools && intakeState.tools[t.id]) || null;
        return Object.assign({}, t, { intake });
    });
    res.json({ tools, active: registry.active || {} });
});

/**
 * POST /api/tools/scan
 * Triggers a discovery scan and merges results into the registry.
 * New tools appear as untrusted (status: 'detected', trusted: false).
 * Does NOT auto-trust anything.
 */
router.post('/api/tools/scan', writeLimiter, async (req, res) => {
    try {
        const detected = await discoverTools();
        const tools    = mergeDetectedTools(detected);
        const registry = loadToolRegistry();
        res.json({ success: true, tools, active: registry.active || {} });
    } catch (err) {
        console.error('[/api/tools/scan]', err.message);
        res.status(500).json({ error: 'Scan failed: ' + err.message });
    }
});

/**
 * POST /api/tools/:id/trust
 * Body: { trusted: boolean }
 */
router.post('/api/tools/:id/trust', writeLimiter, (req, res) => {
    const toolId  = req.params.id;
    const trusted = req.body && typeof req.body.trusted === 'boolean' ? req.body.trusted : true;

    const registry = loadToolRegistry();
    const tool     = (registry.tools || []).find(t => t.id === toolId);
    if (!tool) return res.status(404).json({ error: 'Tool not found: ' + toolId });

    tool.trusted = trusted;
    if (!trusted) {
        tool.role = null;
        if (registry.active && registry.active.heart === toolId) {
            delete registry.active.heart;
        }
    }
    saveToolRegistry(registry);
    res.json({ success: true, tool });
});

/**
 * POST /api/tools/:id/role
 * Body: { role: 'mirror' | 'forge' | null }
 */
router.post('/api/tools/:id/role', writeLimiter, (req, res) => {
    const toolId = req.params.id;
    const role   = req.body && req.body.role !== undefined ? req.body.role : null;

    const VALID_ROLES = new Set(['mirror', 'forge', null]);
    if (!VALID_ROLES.has(role)) {
        return res.status(400).json({ error: 'role must be "mirror", "forge", or null' });
    }

    const registry = loadToolRegistry();
    const tool     = (registry.tools || []).find(t => t.id === toolId);
    if (!tool)         return res.status(404).json({ error: 'Tool not found: ' + toolId });
    if (!tool.trusted) return res.status(400).json({ error: 'Tool must be trusted before assigning a role.' });

    tool.role = role;
    saveToolRegistry(registry);
    res.json({ success: true, tool });
});

/**
 * GET /api/tools/active
 * Returns the current active assignments (e.g. which tool is the Heart).
 */
router.get('/api/tools/active', readLimiter, (req, res) => {
    const registry = loadToolRegistry();
    res.json({ active: registry.active || {} });
});

/**
 * POST /api/tools/active
 * Body: { heart: 'tool-id' | null }
 */
router.post('/api/tools/active', writeLimiter, (req, res) => {
    const heartId = req.body && req.body.heart !== undefined ? req.body.heart : null;

    const registry = loadToolRegistry();

    if (heartId !== null) {
        const tool = (registry.tools || []).find(t => t.id === heartId);
        if (!tool)         return res.status(404).json({ error: 'Tool not found: ' + heartId });
        if (!tool.trusted) return res.status(400).json({ error: 'Tool must be trusted before it can become the Heart.' });
    }

    if (!registry.active) registry.active = {};
    if (heartId === null) {
        delete registry.active.heart;
    } else {
        registry.active.heart = heartId;
    }
    saveToolRegistry(registry);
    res.json({ success: true, active: registry.active });
});

/**
 * POST /api/tools/:id/launch
 * Attempt to start a known local tool.  Only ollama-local is supported.
 */
router.post('/api/tools/:id/launch', writeLimiter, async (req, res) => {
    const toolId = req.params.id;

    const registry = loadToolRegistry();
    const tool     = (registry.tools || []).find(t => t.id === toolId);
    if (!tool) return res.status(404).json({ error: 'Tool not found: ' + toolId });

    if (toolId !== 'ollama-local') {
        return res.status(400).json({
            error: 'Launch is only supported for ollama-local at this time.',
        });
    }

    const preProbe = await httpProbe(tool.endpoint + '/api/tags');
    if (preProbe.ok) {
        tool.running  = true;
        tool.lastSeen = new Date().toISOString();
        saveToolRegistry(registry);
        return res.json({ success: true, status: 'already_running', message: 'Ollama is already running.' });
    }

    try {
        const proc = spawn('ollama', ['serve'], { detached: true, stdio: 'ignore' });
        proc.on('error', () => {});
        proc.unref();
    } catch (err) {
        return res.json({
            success: false,
            status:  'error',
            message: 'Could not start Ollama: ' + err.message + '. Try: ollama serve',
        });
    }

    await new Promise(r => setTimeout(r, 2500));
    const postProbe = await httpProbe(tool.endpoint + '/api/tags');

    if (postProbe.ok) {
        tool.running  = true;
        tool.lastSeen = new Date().toISOString();
        saveToolRegistry(registry);
        return res.json({ success: true, status: 'launched', message: 'Ollama started successfully.' });
    }

    return res.json({
        success: false,
        status:  'launch_failed',
        message: 'Ollama was launched but did not respond in time. Try: ollama serve',
    });
});

// ── Phase 8.5: Tool intake actions ───────────────────────────────────────────

/**
 * POST /api/tools/:id/inspect
 * Marks a tool as inspected in the persistent intake state.
 */
router.post('/api/tools/:id/inspect', writeLimiter, (req, res) => {
    const toolId   = req.params.id;
    const registry = loadToolRegistry();
    const tool     = (registry.tools || []).find(t => t.id === toolId);
    if (!tool) return res.status(404).json({ error: 'Tool not found: ' + toolId });

    const entry = upsertIntakeTool(toolId, { state: 'inspected' });
    res.json({ success: true, intake: entry });
});

/**
 * POST /api/tools/:id/reject
 * Persistently rejects a tool from the intake queue.
 * Body: { notes? }
 */
router.post('/api/tools/:id/reject', writeLimiter, (req, res) => {
    const toolId           = req.params.id;
    const { notes = null } = req.body || {};
    const registry         = loadToolRegistry();
    const tool             = (registry.tools || []).find(t => t.id === toolId);
    if (!tool) return res.status(404).json({ error: 'Tool not found: ' + toolId });

    const entry = upsertIntakeTool(toolId, {
        state: 'rejected',
        notes: notes || undefined,
    });
    res.json({ success: true, intake: entry });
});

module.exports = router;
