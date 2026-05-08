/**
 * Ember Node v.ᚠ — Phase 8.95 server (bootstrap)
 *
 * This file is the thin bootstrap entry point.  All route logic lives in
 * dedicated modules under app/routes/.  Shared service logic lives in:
 *
 *   app/intakeState.js    — Threshold intake state persistence
 *   app/runtimeStewardship.js — Ollama runtime stewardship + Ember Prime resolution
 *   app/startupCheck.js   — Startup summary generation
 *   app/rateLimiters.js   — Shared rate limiter instances
 *
 * Route modules:
 *   app/routes/startup.js   — GET /api/startup-check
 *   app/routes/sources.js   — Source management, ingest, indexing
 *   app/routes/threshold.js — Threshold intake queue and inbox reader routes
 *   app/routes/threshold.js — Threshold intake + runtime stewardship API
 *   app/routes/chat.js      — Chat (legacy + grounded)
 *   app/routes/threads.js   — Thread persistence
 *   app/routes/system.js    — System status, storage info, intake state
 */

'use strict';

const express = require('express');
const path    = require('path');
const axios   = require('axios');

const {
    ensureDataRoot, ensureCanonicalDataFiles, migrateLegacyData, seedDataRoot,
} = require('./storageConfig');
const { installBundledCoreCache } = require('./archiveCacheService');
const { ensureUserConceptIndex } = require('./conceptIndex');
const { ensureCourtConfig } = require('./courtConfig');
const { runLegacyCleanupPass } = require('./system/nodeMaintenance');

// Re-export legacy symbols for backward compatibility with tests
const { listCaches, loadCache } = require('./cacheLoader');
const {
    MODEL, OLLAMA_BASE_URL, OLLAMA_CHAT_URL,
    getEmberPrimeModel,
    probeOllamaRuntime,
} = require('./runtimeStewardship');
const { loadIntakeState, saveIntakeState,
        upsertIntakeFile }           = require('./intakeState');
const { triageFile }                                   = require('./startupCheck');

// ── Startup side-effects ──────────────────────────────────────────────────────
// Run once at module load.  Node module cache guarantees single execution.

ensureDataRoot();
const MIGRATION_RESULT = migrateLegacyData();
seedDataRoot();
installBundledCoreCache();
ensureCanonicalDataFiles();
ensureCourtConfig();
ensureUserConceptIndex();
runLegacyCleanupPass();

// ── Route modules ─────────────────────────────────────────────────────────────

const createStartupRouter  = require('./routes/startup');
const createSystemRouter   = require('./routes/system');
const chatRouter           = require('./routes/chat');
const sourcesRouter        = require('./routes/sources');
const thresholdRouter      = require('./routes/threshold');
const threadsRouter        = require('./routes/threads');
const documentsRouter      = require('./routes/documents');
const archiveRouter        = require('./routes/archive');
const bootstrapRouter      = require('./routes/bootstrap');

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
app.use(threadsRouter);
app.use(documentsRouter);
app.use(archiveRouter);
app.use(bootstrapRouter);

// Cache manager endpoints
app.get('/caches', (req, res) => {
    res.json({ caches: listCaches() });
});
app.get('/caches/:name', (req, res) => {
    const cache = loadCache(req.params.name);
    if (!cache) return res.status(404).json({ error: 'Cache "' + req.params.name + '" not found.' });
    return res.json(cache);
});

// ── Server start ──────────────────────────────────────────────────────────────

async function checkModel() {
    try {
        const response = await axios.get(OLLAMA_BASE_URL + '/api/tags');
        const models   = (response.data.models || []).map(function(m) { return m.name; });
        const selectedModel = getEmberPrimeModel();
        if (!models.some(function(name) { return name === selectedModel || name.startsWith(selectedModel + ':'); })) {
            console.warn(
                'WARNING: Model "' + selectedModel + '" was not found in Ollama. ' +
                'Available models: ' + (models.join(', ') || '(none)') + '. ' +
                'Run: ollama pull ' + selectedModel,
            );
        } else {
            console.log('Model check passed: "' + selectedModel + '" is available.');
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

    // Auto-register any unmanaged files already present in the threshold folder
    // so they appear in the intake queue without requiring manual re-upload.
    try {
        const { autoRegisterThresholdFiles } = require('./routes/threshold');
        if (typeof autoRegisterThresholdFiles === 'function') {
            autoRegisterThresholdFiles();
        }
    } catch { /* non-critical — threshold route handles this on first list call */ }

    // Phase 11: Bootstrap trusted archive sources (non-blocking)
    require('./archiveService').bootstrapArchive().catch(function(err) {
        console.warn('[archive] Bootstrap failed:', err.message);
    });

    // Phase 11.5: Seed Forge identity files and initial bootstrap
    try {
        const { seedForgeFiles, refreshBootstrap } = require('./bootstrap');
        seedForgeFiles();
        refreshBootstrap();
    } catch (err) {
        console.warn('[forge] Forge seed failed:', err.message);
    }

    // Non-blocking startup runtime check
    probeOllamaRuntime().then(function(runtime) {
        if (!runtime.ok) {
            console.warn('[runtime] Ollama not detected during startup.');
        }
    }).catch(function(err) {
        console.warn('[runtime] Startup check failed:', err.message);
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
    listCaches,
    loadCache,
    loadIntakeState,
    saveIntakeState,
    upsertIntakeFile,
    triageFile,
};
