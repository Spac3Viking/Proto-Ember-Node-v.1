'use strict';

/**
 * Ember Node v.ᚠ — Phase 16D Rolling Bootstrap Routes
 *
 * POST /api/bootstrap/refresh  — manually rebuild + persist Rolling Bootstrap
 * GET  /api/bootstrap          — return Rolling Bootstrap + legacy bootstrap snapshot
 * GET  /api/bootstrap/rolling  — return raw Rolling Bootstrap JSON for inspection
 */

const express = require('express');
const { readLimiter, writeLimiter } = require('../rateLimiters');
const {
    loadBootstrap, refreshBootstrap,
    loadRollingBootstrap, refreshRollingBootstrap, getRollingBootstrapStatus,
} = require('../bootstrap');

const router = express.Router();

/**
 * GET /api/bootstrap
 * Returns the current Rolling Bootstrap continuity summary
 * plus legacy bootstrap compatibility payload.
 */
router.get('/api/bootstrap', readLimiter, (req, res) => {
    const rollingBootstrap = loadRollingBootstrap();
    const bootstrap = loadBootstrap();
    const rollingStatus = getRollingBootstrapStatus();
    res.json({ rollingBootstrap, rollingStatus, bootstrap });
});

/**
 * POST /api/bootstrap/refresh
 * Rebuild the rolling continuity summary from context memory and thread memory.
 * Also refreshes the legacy active-bootstrap snapshot for compatibility.
 *
 * Body (optional): { activeArchetype: "scribe" }
 */
router.post('/api/bootstrap/refresh', writeLimiter, (req, res) => {
    const { activeArchetype = null } = req.body || {};
    try {
        const rollingBootstrap = refreshRollingBootstrap({ activeArchetype });
        const bootstrap = refreshBootstrap({ activeArchetype });
        res.json({ success: true, rollingBootstrap, bootstrap });
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
