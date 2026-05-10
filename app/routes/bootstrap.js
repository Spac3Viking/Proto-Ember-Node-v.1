'use strict';

/**
 * Ember Node v.ᚠ — Phase 16D Rolling Bootstrap Routes
 *
 * POST /api/bootstrap/refresh  — manually rebuild + persist Rolling Bootstrap
 * GET  /api/bootstrap          — return Rolling Bootstrap continuity summary
 * GET  /api/bootstrap/rolling  — return raw Rolling Bootstrap JSON for inspection
 */

const express = require('express');
const { readLimiter, writeLimiter } = require('../rateLimiters');
const {
    loadRollingBootstrap, refreshRollingBootstrap, getRollingBootstrapStatus,
} = require('../bootstrap');

const router = express.Router();

/**
 * GET /api/bootstrap
 * Returns the current Rolling Bootstrap continuity summary.
 */
router.get('/api/bootstrap', readLimiter, (req, res) => {
    const rollingBootstrap = loadRollingBootstrap();
    const rollingStatus = getRollingBootstrapStatus();
    res.json({ rollingBootstrap, rollingStatus });
});

/**
 * POST /api/bootstrap/refresh
 * Rebuild the rolling continuity summary from context memory and thread memory.
 *
 * Body (optional): { activeArchetype: "scribe", responseDepth: "ember" }
 */
router.post('/api/bootstrap/refresh', writeLimiter, (req, res) => {
    const { activeArchetype = null, responseDepth = null } = req.body || {};
    try {
        const rollingBootstrap = refreshRollingBootstrap({ activeArchetype, responseDepth });
        res.json({ success: true, rollingBootstrap });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/api/bootstrap/rolling', readLimiter, (req, res) => {
    const rollingBootstrap = loadRollingBootstrap();
    if (!rollingBootstrap) {
        return res.status(404).json({ error: 'Rolling Bootstrap not generated yet.' });
    }
    return res.json({ rollingBootstrap });
});

module.exports = router;
