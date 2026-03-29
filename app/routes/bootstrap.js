'use strict';

/**
 * Ember Node v.ᚠ — Phase 11.5 Bootstrap Routes
 *
 * POST /api/bootstrap/refresh  — rebuild + persist the active bootstrap
 * GET  /api/bootstrap          — return the current active bootstrap (or generate if missing)
 */

const express = require('express');
const { readLimiter, writeLimiter } = require('../rateLimiters');
const { loadBootstrap, refreshBootstrap } = require('../bootstrap');

const router = express.Router();

/**
 * GET /api/bootstrap
 * Returns the current active bootstrap.
 * If no bootstrap has been generated yet, builds and returns one on-demand.
 */
router.get('/api/bootstrap', readLimiter, (req, res) => {
    let bootstrap = loadBootstrap();
    if (!bootstrap) {
        try {
            bootstrap = refreshBootstrap();
        } catch (err) {
            return res.status(500).json({ error: 'Could not generate bootstrap: ' + err.message });
        }
    }
    res.json({ bootstrap });
});

/**
 * POST /api/bootstrap/refresh
 * Rebuild the active bootstrap from current context maps and thread memory.
 * Overwrites the existing active-bootstrap.json.
 *
 * Body (optional): { activeArchetype: "scribe" }
 */
router.post('/api/bootstrap/refresh', writeLimiter, (req, res) => {
    const { activeArchetype = null } = req.body || {};
    try {
        const bootstrap = refreshBootstrap({ activeArchetype });
        res.json({ success: true, bootstrap });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
