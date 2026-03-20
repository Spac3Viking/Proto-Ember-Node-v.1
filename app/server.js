/**
 * Ember Node v.ᚠ — Phase 8.95 server (bootstrap)
 *
 * This file is the thin bootstrap entry point.  All route logic lives in
 * dedicated modules under app/routes/.  Shared service logic lives in:
 *
 *   app/intakeState.js    — Threshold intake state persistence
 *   app/toolRegistry.js   — Tool registry, trust, Heart resolution
 *   app/startupCheck.js   — Startup summary generation
 *   app/rateLimiters.js   — Shared rate limiter instances
 *
 * Route modules:
 *   app/routes/startup.js   — GET /api/startup-check
 *   app/routes/sources.js   — Source management, ingest, indexing
 *   app/routes/threshold.js — Threshold intake queue, detected-files
 *   app/routes/tools.js     — Tool registry API
 *   app/routes/chat.js      — Chat (legacy + grounded)
 *   app/routes/projects.js  — Projects, user-cartridges, bundled cartridges
 *   app/routes/threads.js   — Thread persistence
 *   app/routes/system.js    — System status, storage info, intake state
 */

'use strict';

const express = require('express');
const path    = require('path');
const axios   = require('axios');

const {
    ensureDataRoot, migrateLegacyData,
} = require('./storageConfig');

// Re-export legacy symbols for backward compatibility with tests
const { listCartridges, loadCartridge }               = require('./cartridgeLoader');
const { loadToolRegistry, saveToolRegistry,
        mergeDetectedTools, resolveActiveHeart,
        MODEL, OLLAMA_BASE_URL, OLLAMA_CHAT_URL,
        discoverTools }                                = require('./toolRegistry');
const { loadIntakeState, saveIntakeState,
        upsertIntakeFile, upsertIntakeTool }           = require('./intakeState');
const { triageFile }                                   = require('./startupCheck');

// ── Startup side-effects ──────────────────────────────────────────────────────
// Run once at module load.  Node module cache guarantees single execution.

ensureDataRoot();
const MIGRATION_RESULT = migrateLegacyData();

// ── Route modules ─────────────────────────────────────────────────────────────

const createStartupRouter  = require('./routes/startup');
const createSystemRouter   = require('./routes/system');
const chatRouter           = require('./routes/chat');
const sourcesRouter        = require('./routes/sources');
const thresholdRouter      = require('./routes/threshold');
const toolsRouter          = require('./routes/tools');
const threadsRouter        = require('./routes/threads');
const projectsRouter       = require('./routes/projects');

// ── Express setup ─────────────────────────────────────────────────────────────

const app  = express();
const PORT = 3477;

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(express.json({ limit: '10mb' }));

// ── Mount routes ──────────────────────────────────────────────────────────────

const deps = { migrationResult: MIGRATION_RESULT };

app.use(createStartupRouter(deps));
app.use(createSystemRouter(deps));
app.use(chatRouter);
app.use(sourcesRouter);
app.use(thresholdRouter);
app.use(toolsRouter);
app.use(threadsRouter);
app.use(projectsRouter);

// ── Server start ──────────────────────────────────────────────────────────────

async function checkModel() {
    try {
        const response = await axios.get(OLLAMA_BASE_URL + '/api/tags');
        const models   = (response.data.models || []).map(function(m) { return m.name; });
        if (!models.some(function(name) { return name === MODEL || name.startsWith(MODEL + ':'); })) {
            console.warn(
                'WARNING: Model "' + MODEL + '" was not found in Ollama. ' +
                'Available models: ' + (models.join(', ') || '(none)') + '. ' +
                'Run: ollama pull ' + MODEL,
            );
        } else {
            console.log('Model check passed: "' + MODEL + '" is available.');
        }
    } catch (err) {
        console.warn(
            'WARNING: Could not reach Ollama at ' + OLLAMA_BASE_URL + '. ' +
            'Is Ollama running? (' + err.message + ')',
        );
    }
}

if (require.main === module) {
    console.log('Data root: ' + require('./storageConfig').DATA_ROOT);

    // Non-blocking startup tool scan
    discoverTools().then(function(detected) {
        const tools    = mergeDetectedTools(detected);
        const newTools = tools.filter(t => t.status === 'detected');
        if (newTools.length > 0) {
            console.log('[tools] Detected ' + newTools.length + ' tool(s): ' + newTools.map(t => t.name).join(', '));
        }
    }).catch(function(err) {
        console.warn('[tools] Startup scan failed:', err.message);
    });

    checkModel().then(function() {
        app.listen(PORT, function() {
            console.log('Server is running on http://localhost:' + PORT);
        });
    });
}

module.exports = {
    app,
    MODEL,
    OLLAMA_CHAT_URL,
    OLLAMA_BASE_URL,
    listCartridges,
    loadCartridge,
    loadToolRegistry,
    saveToolRegistry,
    loadIntakeState,
    saveIntakeState,
    upsertIntakeFile,
    upsertIntakeTool,
    resolveActiveHeart,
    triageFile,
};
