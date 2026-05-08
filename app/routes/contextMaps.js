'use strict';

/**
 * Ember Node v.ᚠ — Phase 16D Context Memory Routes
 *
 * GET  /api/context-maps/:room          — list all maps for a room
 * GET  /api/context-maps/:room/working  — get current working map
 * POST /api/context-maps/:room/refresh  — regenerate working map
 * POST /api/context-maps/:room/remember — promote working map to remembered
 * GET  /api/context-maps/:room/assemble — assemble full room context (native + imported)
 *
 * GET  /api/remembered-threads          — list all remembered thread summaries
 * GET  /api/remembered-threads/:id      — get a single remembered thread summary
 */

const express = require('express');
const { readLimiter, writeLimiter } = require('../rateLimiters');
const {
    listContextMaps,
    getWorkingMap,
    refreshWorkingMap,
    promoteToRememberedMap,
    assembleRoomContext,
}                               = require('../contextMaps');
const { listThreadSummaries, loadThreadSummary } = require('../threadMemory');

const router = express.Router();

const VALID_ROOMS = ['hearth', 'workshop', 'threshold'];

function validateRoom(req, res) {
    const { room } = req.params;
    if (!VALID_ROOMS.includes(room)) {
        res.status(400).json({ error: 'Invalid room "' + room + '". Must be hearth, workshop, or threshold.' });
        return false;
    }
    return true;
}

/**
 * GET /api/context-maps/:room
 * Returns all context maps for a room.
 */
router.get('/api/context-maps/:room', readLimiter, (req, res) => {
    if (!validateRoom(req, res)) return;
    const maps = listContextMaps(req.params.room);
    res.json({ room: req.params.room, maps });
});

/**
 * GET /api/context-maps/:room/working
 * Returns the current working map for a room.
 * Returns 404 if no working map has been generated yet.
 */
router.get('/api/context-maps/:room/working', readLimiter, (req, res) => {
    if (!validateRoom(req, res)) return;
    const map = getWorkingMap(req.params.room);
    if (!map) return res.status(404).json({ error: 'No working map found. Use POST /refresh to generate one.' });
    res.json({ map });
});

/**
 * POST /api/context-maps/:room/refresh
 * Regenerates and saves the working map for a room.
 * Returns the new map.
 */
router.post('/api/context-maps/:room/refresh', writeLimiter, (req, res) => {
    if (!validateRoom(req, res)) return;
    try {
        const map = refreshWorkingMap(req.params.room);
        res.json({ success: true, map });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/context-maps/:room/remember
 * Promotes the current working map to a remembered map.
 * Returns the remembered map.
 */
router.post('/api/context-maps/:room/remember', writeLimiter, (req, res) => {
    if (!validateRoom(req, res)) return;
    try {
        const map = promoteToRememberedMap(req.params.room);
        res.json({ success: true, map });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

/**
 * GET /api/context-maps/:room/assemble
 * Returns the assembled room context: native working map + imported maps.
 * Used internally by chat context assembly; exposed here for inspection.
 */
router.get('/api/context-maps/:room/assemble', readLimiter, (req, res) => {
    if (!validateRoom(req, res)) return;
    const context = assembleRoomContext(req.params.room);
    res.json({ room: req.params.room, context });
});

// ── Remembered Threads ────────────────────────────────────────────────────────

/**
 * GET /api/remembered-threads
 * Returns all remembered thread summaries.
 */
router.get('/api/remembered-threads', readLimiter, (req, res) => {
    const summaries = listThreadSummaries();
    res.json({ summaries });
});

/**
 * GET /api/remembered-threads/:id
 * Returns a single remembered thread summary.
 */
router.get('/api/remembered-threads/:id', readLimiter, (req, res) => {
    const summary = loadThreadSummary(req.params.id);
    if (!summary) return res.status(404).json({ error: 'Remembered thread not found' });
    res.json({ summary });
});

module.exports = router;
