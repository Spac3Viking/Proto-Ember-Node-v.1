'use strict';

/**
 * Ember Node v.ᚠ — Startup Routes
 *
 * GET /api/startup-check
 */

const express = require('express');
const { readLimiter } = require('../rateLimiters');
const { generateStartupCheck } = require('../startupCheck');

/**
 * Create the startup router.
 *
 * @param {{ migrationResult: object }} deps  Runtime dependencies
 * @returns {express.Router}
 */
function createStartupRouter({ migrationResult }) {
    const router = express.Router();

    /**
     * GET /api/startup-check
     * Returns a structured summary of the system state for the launch banner.
     */
    router.get('/api/startup-check', readLimiter, (req, res) => {
        res.json(generateStartupCheck(migrationResult));
    });

    return router;
}

module.exports = createStartupRouter;
