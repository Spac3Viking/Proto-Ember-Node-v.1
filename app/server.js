/**
 * Ember Node v.ᚠ — Server bootstrap
 *
 * This file is the thin bootstrap entry point.  All route logic lives in
 * dedicated modules under app/routes/.  Shared service logic lives in:
 *
 *   app/intakeState.js    — Threshold intake state persistence
 *   app/runtimeStewardship.js — Ollama runtime stewardship + Model Role resolution
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
 *   app/routes/signalThreads.js — Signal Thread persistence (meaning continuity)
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
    getSelectedModelFallback,
    probeOllamaRuntime,
} = require('./runtimeStewardship');
const { HOST, PORT, OLLAMA_TAGS_URL, OLLAMA_HEALTH_TIMEOUT_MS, BIND_ALL_INTERFACES } = require('./runtimeConfig');
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
const signalThreadsRouter  = require('./routes/signalThreads');
const documentsRouter      = require('./routes/documents');
const archiveRouter        = require('./routes/archive');
const bootstrapRouter      = require('./routes/bootstrap');
const cachesRouter         = require('./routes/caches');
const sessionsRouter       = require('./routes/sessions');

// ── Express setup ─────────────────────────────────────────────────────────────

const app  = express();

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
app.use(signalThreadsRouter);
app.use(documentsRouter);
app.use(archiveRouter);
app.use(bootstrapRouter);
app.use(cachesRouter);
app.use(sessionsRouter);

// ── Server start ──────────────────────────────────────────────────────────────

async function checkModel() {
    try {
        const response = await axios.get(OLLAMA_TAGS_URL, { timeout: OLLAMA_HEALTH_TIMEOUT_MS });
        const models   = (response.data.models || []).map(function(m) { return m.name; });
        const selectedModel = getSelectedModelFallback();
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
        // AI unavailability is a recoverable runtime state, not a server
        // failure — the Ember Node itself remains a usable local archive
        // and Session instrument even when Ollama is stopped.
        console.warn(
            'NOTE: Could not reach Ollama at ' + OLLAMA_BASE_URL + '. ' +
            'Ember Node will start without AI assistance. ' +
            'Start Ollama to enable AI features. (' + err.message + ')',
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

    // Bootstrap trusted archive sources (non-blocking)
    require('./archiveService').bootstrapArchive().catch(function(err) {
        console.warn('[archive] Bootstrap failed:', err.message);
    });

    // Seed Forge identity files and initial bootstrap
    try {
        const { seedForgeFiles, refreshBootstrap } = require('./bootstrap');
        seedForgeFiles();
        refreshBootstrap();
    } catch (err) {
        console.warn('[forge] Forge seed failed:', err.message);
    }

    // The Ember Node is a local archive and Session instrument first. Start
    // listening immediately — do not wait on Ollama or model availability.
    // AI reachability is probed afterward, non-blocking, with a short
    // timeout, and reported as a recoverable runtime state via /api/status.
    app.listen(PORT, HOST, function() {
        const displayHost = HOST === BIND_ALL_INTERFACES ? 'localhost' : HOST;
        console.log('Server is running on http://' + displayHost + ':' + PORT + ' (bound to ' + HOST + ':' + PORT + ')');

        probeOllamaRuntime().then(function(runtime) {
            if (!runtime.ok) {
                console.warn('[runtime] Ollama not detected at startup. Ember Node is running without AI assistance.');
                return;
            }
            checkModel();
        }).catch(function(err) {
            console.warn('[runtime] Startup AI probe failed:', err.message);
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
