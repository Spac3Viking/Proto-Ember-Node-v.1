'use strict';

/**
 * Ember Node v.ᚠ — System Routes
 *
 * GET /api/status
 * GET /api/ollama-status
 * GET /api/storage-info
 * GET /api/intake-state
 * GET /api/ai/models
 * POST /api/ai/models/select
 * GET /api/court
 * GET /api/system/purge-manifest
 * POST /api/system/refresh-node
 * POST /api/system/incinerate
 * POST /api/system/shutdown
 * GET /api/system/tuning/runtime-runs
 * POST /api/system/tuning/runtime-runs
 */

const express = require('express');
const axios   = require('axios');
const fs = require('fs');
const path = require('path');
const { readLimiter, writeLimiter } = require('../rateLimiters');
const {
    DATA_ROOT, ROOM_DIRS,
    INDEXES_DIR, THREADS_DIR,
    USER_CACHES_DIR, SYSTEM_DIR, EXPORTS_DIR,
    FORGE_DIR, RUNTIME_TUNING_RUNS_PATH,
    ensureDataRoot, ensureCanonicalDataFiles,
} = require('../storageConfig');
const { OLLAMA_BASE_URL } = require('../runtimeStewardship');
const { TASK_ROUTES } = require('../modelRoles');
const { getSelectedModel, setSelectedModel, loadAiConfig, setModelRole } = require('../aiConfig');
const { loadChunks, loadEmbeddings, loadManifests } = require('../indexStore');
const { getEmbeddingStatus }                        = require('../embeddings');
const { listCaches }                            = require('../cacheLoader');
const { loadIntakeState }                           = require('../intakeState');
const {
    loadBootstrap, refreshBootstrap,
    getRollingBootstrapStatus, refreshRollingBootstrap, buildContinuityBootstrapMarkdown,
} = require('../bootstrap');
const { listLoadedCaches } = require('../loadedCaches');
const { recordCacheInteraction } = require('../cacheInteractionMemory');
const { loadCourtConfig }                           = require('../courtConfig');
// Reuse canonical archive cache logic for installed/update status.
const { compareInstalledWithUpstream } = require('../archiveCacheService');
const {
    PURGE_MANIFEST,
    PURGE_MODES,
    purgeNodeMemory,
    runLegacyCleanupPass,
} = require('../system/nodeMaintenance');
const {
    refreshMemoryCompression,
    getMemoryCompressionStatus,
} = require('../memoryCompression');

const FORGE_CORE_PATH = path.join(FORGE_DIR, 'forge-core.json');
const PACKAGE_JSON_PATH = path.join(__dirname, '..', '..', 'package.json');
const BUNDLED_NODE_PATH = path.join(__dirname, '..', '..', 'runtime', 'node', 'node.exe');
const ARCHIVE_UPDATE_URL = 'https://greenfire-archive.replit.app/downloads/index.json';
const DEFAULT_UPDATE_PAGE_URL = 'https://greenfire-archive.replit.app/archive';
const CACHE_STATUS_ORDER = [
    { packageId: 'green-fire-core', label: 'Core Cache' },
    { packageId: 'green-fire-codices-cache', label: 'Codices Cache' },
    { packageId: 'green-fire-grimoires-cache', label: 'Grimoires Cache' },
    { packageId: 'green-fire-sagas-cache', label: 'Sagas Cache' },
    { packageId: 'green-fire-reference-cache', label: 'Reference Cache' },
    { packageId: 'green-fire-gallery-cache', label: 'Gallery Cache' },
    { packageId: 'green-fire-complete-cache', label: 'Complete Cache' },
];
const SHUTDOWN_DELAY_MS = 250;
const MAX_RUNTIME_TUNING_RUNS = 20;
const MAX_RUNTIME_TUNING_PROMPT_LENGTH = 280;
const MAX_RUNTIME_TUNING_RESPONSE_PREVIEW_LENGTH = 320;
let shutdownScheduled = false;

function buildAiRolePayload(config) {
    const cfg = config && typeof config === 'object' ? config : loadAiConfig();
    const modelRoles = (cfg.model_roles && typeof cfg.model_roles === 'object') ? cfg.model_roles : null;
    const selectedModel = (typeof cfg.selected_model === 'string' && cfg.selected_model.trim())
        ? cfg.selected_model.trim()
        : '';
    const configuredRoles = {
        hearth: modelRoles && typeof modelRoles.hearth === 'string' ? modelRoles.hearth.trim() : '',
        forge: modelRoles && typeof modelRoles.forge === 'string' ? modelRoles.forge.trim() : '',
        scribe: modelRoles && typeof modelRoles.scribe === 'string' ? modelRoles.scribe.trim() : '',
    };
    const effectiveRoles = {
        hearth: configuredRoles.hearth || selectedModel,
        forge: configuredRoles.forge || selectedModel,
        scribe: configuredRoles.scribe || selectedModel,
    };
    return {
        // Back-compat: keep the original shape where Hearth defaults to selected_model.
        model_roles: {
            hearth: effectiveRoles.hearth,
            forge: configuredRoles.forge,
            scribe: configuredRoles.scribe,
        },
        // New: explicit configured vs effective values so the UI can show fallbacks clearly.
        model_roles_configured: configuredRoles,
        model_roles_effective: effectiveRoles,
        routing: cfg.routing || { ...TASK_ROUTES },
    };
}

function _loadPackageConfig() {
    try {
        return JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'));
    } catch {
        return {};
    }
}

function _normalizeVersionString(version) {
    if (!version) return null;
    return String(version).trim().replace(/^v/i, '');
}

function _formatCacheStatusText(row) {
    if (!row || !row.installed) return 'not installed';
    if (row.status === 'update-available') return 'update available';
    return 'installed';
}

function _detectNodeRuntimeStatus() {
    if (fs.existsSync(BUNDLED_NODE_PATH)) {
        return {
            source: 'bundled',
            status: 'Bundled runtime detected',
            path: BUNDLED_NODE_PATH,
        };
    }

    const execPath = typeof process.execPath === 'string' ? process.execPath.trim() : '';
    if (execPath) {
        return {
            source: 'system',
            status: 'System Node detected',
            path: execPath,
        };
    }

    return {
        source: 'missing',
        status: 'Missing',
        path: null,
    };
}

function _isLocalRequest(req) {
    const remoteAddress = (req && req.socket && req.socket.remoteAddress) || req.ip || '';
    return remoteAddress === '127.0.0.1' ||
        remoteAddress === '::1' ||
        remoteAddress === '::ffff:127.0.0.1';
}

function _loadRuntimeTuningRunsState() {
    try {
        const raw = fs.readFileSync(RUNTIME_TUNING_RUNS_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        const runs = Array.isArray(parsed && parsed.runs) ? parsed.runs : [];
        return {
            version: '0.1.0',
            updated_at: parsed && parsed.updated_at ? String(parsed.updated_at) : null,
            runs: runs.slice(0, MAX_RUNTIME_TUNING_RUNS),
        };
    } catch {
        return { version: '0.1.0', updated_at: null, runs: [] };
    }
}

function _saveRuntimeTuningRunsState(state) {
    const payload = {
        version: '0.1.0',
        updated_at: new Date().toISOString(),
        runs: Array.isArray(state && state.runs) ? state.runs.slice(0, MAX_RUNTIME_TUNING_RUNS) : [],
    };
    fs.mkdirSync(path.dirname(RUNTIME_TUNING_RUNS_PATH), { recursive: true });
    fs.writeFileSync(RUNTIME_TUNING_RUNS_PATH, JSON.stringify(payload, null, 2), 'utf8');
    return payload;
}

function _sanitizeRuntimeTuningRun(payload) {
    const run = payload && typeof payload === 'object' ? payload : {};
    const settings = run.settings && typeof run.settings === 'object' ? run.settings : {};
    const metrics = run.metrics && typeof run.metrics === 'object' ? run.metrics : {};
    const toFinite = (value) => {
        const num = Number(value);
        return Number.isFinite(num) ? num : null;
    };
    const normalizeIso = (value) => {
        const date = value ? new Date(value) : new Date();
        return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
    };
    const normalizeMultilineText = (value) => String(value || '')
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]+/g, ' ')
        .split('\n')
        .map(line => line.trim())
        .join('\n')
        .trim();
    return {
        id: String(run.id || 'run-' + Date.now()).trim().slice(0, 80),
        created: normalizeIso(run.created),
        prompt: normalizeMultilineText(run.prompt).slice(0, MAX_RUNTIME_TUNING_PROMPT_LENGTH),
        promptPresetId: String(run.promptPresetId || '').trim().slice(0, 64),
        settings: {
            responseDepth: String(settings.responseDepth || '').trim().slice(0, 32),
            runtimeProfile: String(settings.runtimeProfile || '').trim().slice(0, 64),
            loadoutFocus: Boolean(settings.loadoutFocus),
            archetype: String(settings.archetype || '').trim().slice(0, 32),
        },
        metrics: {
            responseTimeMs: toFinite(metrics.responseTimeMs),
            responseLength: toFinite(metrics.responseLength),
            rawChunksUsed: toFinite(metrics.rawChunksUsed),
            summariesUsed: toFinite(metrics.summariesUsed),
            loadedCacheCount: toFinite(metrics.loadedCacheCount),
            promptEstimate: toFinite(metrics.promptEstimate),
            numPredict: toFinite(metrics.numPredict),
            retrievalConfidence: toFinite(metrics.retrievalConfidence),
            cacheOverlap: toFinite(metrics.cacheOverlap),
            continuityDensity: toFinite(metrics.continuityDensity),
        },
        responsePreview: normalizeMultilineText(run.responsePreview).slice(0, MAX_RUNTIME_TUNING_RESPONSE_PREVIEW_LENGTH),
    };
}

async function _buildNodeStatusPayload() {
    const packageConfig = _loadPackageConfig();
    const currentAppVersion = _normalizeVersionString(packageConfig.version) || '0.0.0';
    const emberNodeConfig = packageConfig.emberNode || {};
    const updatePageUrl = emberNodeConfig.updatePageUrl || DEFAULT_UPDATE_PAGE_URL;
    const archiveUpdateUrl = emberNodeConfig.archiveUpdateUrl || ARCHIVE_UPDATE_URL;
    const checkedAt = new Date().toISOString();

    let comparison = [];
    let cacheWarning = null;
    try {
        const comparisonPayload = await compareInstalledWithUpstream();
        comparison = Array.isArray(comparisonPayload.comparison) ? comparisonPayload.comparison : [];
    } catch (err) {
        cacheWarning = err.message;
    }

    const comparisonById = new Map(comparison.map(row => [row.packageId, row]));
    const cacheStatuses = CACHE_STATUS_ORDER.map(def => {
        const row = comparisonById.get(def.packageId) || null;
        return {
            packageId: def.packageId,
            label: def.label,
            status: _formatCacheStatusText(row),
            installed: Boolean(row && row.installed),
            installedVersion: row ? (row.localVersion || (row.registry && row.registry.installedVersion) || null) : null,
            latestVersion: row ? (row.upstreamVersion || null) : null,
        };
    });

    const installedCacheVersions = cacheStatuses
        .filter(item => item.installed)
        .map(item => ({
            label: item.label,
            packageId: item.packageId,
            version: item.installedVersion || 'unknown',
        }));

    const coreCache = cacheStatuses.find(item => item.packageId === 'green-fire-core') || null;

    return {
        success: true,
        currentAppVersion,
        latestAvailableVersion: 'Check Archive',
        updateSource: 'Green Fire Archive',
        updateStatus: 'Coming soon',
        archiveUpdateUrl,
        updatePageUrl,
        dataRootPath: DATA_ROOT,
        checkedAt,
        updateMessage: 'Updates are distributed through the Green Fire Archive.',
        coreCacheVersion: coreCache ? (coreCache.installedVersion || null) : null,
        installedCacheVersions,
        cacheStatuses,
        cacheWarning,
    };
}

/**
 * Create the system router.
 *
 * @param {{ migrationResult: object }} deps  Runtime dependencies
 * @returns {express.Router}
 */
function createSystemRouter({ migrationResult }) {
    const router = express.Router();

    /**
     * GET /api/status
     */
    router.get('/api/status', readLimiter, (req, res) => {
        const embStatus  = getEmbeddingStatus();
        const chunks     = loadChunks();
        const embeddings = loadEmbeddings();
        const manifests  = loadManifests();
        const packageConfig = _loadPackageConfig();
        const runtimeStatus = _detectNodeRuntimeStatus();

        const bundledCacheCount = listCaches().length;
        const userCacheCount    = fs.existsSync(USER_CACHES_DIR)
            ? fs.readdirSync(USER_CACHES_DIR).filter(f => f.endsWith('.json')).length
            : 0;

        // Loadout Forge + Rolling Bootstrap status
        const forgeLoaded   = fs.existsSync(FORGE_CORE_PATH);
        const bootstrap = loadBootstrap();
        const bootstrapStatus = bootstrap ? 'ready' : 'not generated';
        const legacyLastRefresh = bootstrap ? (bootstrap.nodeState || {}).lastRefresh || null : null;
        const activeArchetype = bootstrap ? (bootstrap.nodeState || {}).activeArchetype || null : null;
        const rollingBootstrap = getRollingBootstrapStatus();
        const loadedCaches = listLoadedCaches();
        const memoryCompression = getMemoryCompressionStatus();

        res.json({
            model:             getSelectedModel(),
            ollamaBaseUrl:     OLLAMA_BASE_URL,
            port:              3477,
            cacheCount:    bundledCacheCount,
            caches: {
                bundled:       bundledCacheCount,
                user:          userCacheCount,
            },
            indexedChunks:     chunks.length,
            indexedSources:    Object.keys(manifests).length,
            embeddingCount:    Object.keys(embeddings).length,
            embeddingsActive:  embStatus.working,
            embeddingEndpoint: embStatus.activeEndpoint,
            embeddingModel:    embStatus.model,
            retrievalMode:     embStatus.working ? 'semantic' : 'keyword-fallback',
            storageRoot:       DATA_ROOT,
            appVersion:        _normalizeVersionString(packageConfig.version) || '0.0.0',
            nodeRuntimeSource: runtimeStatus.source,
            nodeRuntimeStatus: runtimeStatus.status,
            nodeRuntimePath:   runtimeStatus.path,
            storageRootSource: process.env.EMBER_NODE_DATA_ROOT ? 'EMBER_NODE_DATA_ROOT'
                             : process.env.EMBER_DATA_ROOT      ? 'EMBER_DATA_ROOT'
                             : 'default',
            // Runtime bootstrap + loadout status
            forgeLoaded,
            bootstrapStatus,
            lastBootstrapRefresh: legacyLastRefresh,
            activeArchetype,
            rollingBootstrapStatus: rollingBootstrap.status,
            rollingBootstrapLastRefreshed: rollingBootstrap.lastRefreshed,
            rollingBootstrapActiveThemesCount: rollingBootstrap.activeThemesCount,
            rollingBootstrapOpenQuestionsCount: rollingBootstrap.openQuestionsCount,
            rollingBootstrapSummary: rollingBootstrap.summary,
            rollingBootstrapThemes: rollingBootstrap.themes,
            loadedCacheCount: loadedCaches.length,
            cacheLoadout: loadedCaches.slice(0, 5).map(cache => cache.title || cache.id),
            memoryCompression,
        });
    });

    /**
     * GET /api/ollama-status
     */
    router.get('/api/ollama-status', async (req, res) => {
        try {
            await axios.get(OLLAMA_BASE_URL + '/api/tags');
            res.json({ status: 'reachable' });
        } catch {
            res.status(503).json({ status: 'unreachable' });
        }
    });

    /**
     * GET /api/ai/models
     */
    router.get('/api/ai/models', readLimiter, async (req, res) => {
        const payloadExtras = buildAiRolePayload(loadAiConfig());
        try {
            const response = await axios.get(OLLAMA_BASE_URL + '/api/tags');
            const models = Array.isArray(response.data && response.data.models)
                ? response.data.models
                : [];
            const installed_models = models
                .map(model => (model && typeof model.name === 'string' ? model.name : null))
                .filter(Boolean);
            res.json({
                provider: 'ollama',
                available: true,
                models: models.map(model => ({
                    name: model.name || null,
                    size: model.size != null ? String(model.size) : null,
                    modified_at: model.modified_at || null,
                })).filter(model => model.name),
                selected_model: getSelectedModel(),
                installed_models,
                ...payloadExtras,
            });
        } catch {
            res.json({
                provider: 'ollama',
                available: false,
                models: [],
                selected_model: getSelectedModel(),
                installed_models: [],
                error: 'Ollama is not running',
                ...payloadExtras,
            });
        }
    });

    /**
     * POST /api/ai/models/select
     * Body: { model: string }
     */
    router.post('/api/ai/models/select', writeLimiter, async (req, res) => {
        const nextModel = req.body && typeof req.body.model === 'string'
            ? req.body.model.trim()
            : '';
        if (!nextModel) {
            return res.status(400).json({ success: false, error: 'model is required' });
        }

        try {
            const response = await axios.get(OLLAMA_BASE_URL + '/api/tags');
            const models = Array.isArray(response.data && response.data.models)
                ? response.data.models
                : [];
            const availableModelNames = new Set(models.map(model => model && model.name).filter(Boolean));
            if (!availableModelNames.has(nextModel)) {
                return res.status(400).json({
                    success: false,
                    error: 'Model is not installed in Ollama',
                });
            }

            return res.json({
                success: true,
                provider: 'ollama',
                selected_model: setSelectedModel(nextModel),
            });
        } catch {
            return res.status(503).json({
                success: false,
                error: 'Ollama is not running',
            });
        }
    });

    /**
     * POST /api/ai/models/roles
     * Body: { role: 'hearth' | 'forge' | 'scribe', model: string } (empty model clears role)
     */
    router.post('/api/ai/models/roles', writeLimiter, async (req, res) => {
        const role = req.body && typeof req.body.role === 'string'
            ? req.body.role.trim().toLowerCase()
            : '';
        if (!['hearth', 'forge', 'scribe'].includes(role)) {
            return res.status(400).json({ success: false, error: 'role must be hearth, forge, or scribe' });
        }

        const model = req.body && typeof req.body.model === 'string'
            ? req.body.model.trim()
            : null;
        if (model === null) {
            return res.status(400).json({ success: false, error: 'model is required (use empty string to clear)' });
        }

        if (!model) {
            const updated = setModelRole(role, '');
            const payloadExtras = buildAiRolePayload(updated);
            return res.json({
                success: true,
                provider: 'ollama',
                selected_model: updated.selected_model,
                ...payloadExtras,
            });
        }

        try {
            const response = await axios.get(OLLAMA_BASE_URL + '/api/tags');
            const models = Array.isArray(response.data && response.data.models)
                ? response.data.models
                : [];
            const availableModelNames = new Set(models.map(m => m && m.name).filter(Boolean));
            if (!availableModelNames.has(model)) {
                return res.status(400).json({
                    success: false,
                    error: 'Model is not installed in Ollama',
                });
            }

            const updated = setModelRole(role, model);
            const payloadExtras = buildAiRolePayload(updated);
            return res.json({
                success: true,
                provider: 'ollama',
                selected_model: updated.selected_model,
                ...payloadExtras,
            });
        } catch {
            return res.status(503).json({
                success: false,
                error: 'Ollama is not running',
            });
        }
    });

    /**
     * GET /api/storage-info
     */
    router.get('/api/storage-info', readLimiter, (req, res) => {
        const userCacheCount = fs.existsSync(USER_CACHES_DIR)
            ? fs.readdirSync(USER_CACHES_DIR).filter(f => f.endsWith('.json')).length
            : 0;

        res.json({
            dataRoot:     DATA_ROOT,
            configuredBy: process.env.EMBER_NODE_DATA_ROOT ? 'EMBER_NODE_DATA_ROOT'
                        : process.env.EMBER_DATA_ROOT      ? 'EMBER_DATA_ROOT'
                        : 'default',
            directories: {
                hearth:     ROOM_DIRS.hearth,
                council:    ROOM_DIRS.council,
                threshold:  ROOM_DIRS.threshold,
                indexes:    INDEXES_DIR,
                threads:    THREADS_DIR,
                caches: USER_CACHES_DIR,
                system:     SYSTEM_DIR,
                exports:    EXPORTS_DIR,
            },
            migration: {
                detected:  migrationResult.detected,
                performed: migrationResult.performed,
                mode:      migrationResult.mode,
                errors:    migrationResult.errors,
            },
            caches: {
                bundled: listCaches().length,
                user:    userCacheCount,
            },
        });
    });

    /**
     * GET /api/intake-state
     * Returns the full persistent intake state (files and runtime entries).
     */
    router.get('/api/intake-state', readLimiter, (req, res) => {
        res.json(loadIntakeState());
    });

    /**
     * GET /api/court
     * Returns Ember Court member configuration.
     */
    router.get('/api/court', readLimiter, (req, res) => {
        const court = loadCourtConfig();
        if (!court) {
            return res.status(500).json({ error: 'Could not load Ember Court configuration.' });
        }
        return res.json({ court });
    });

    /**
     * GET /api/system/node-status-updates
     * Returns installer/update guidance state for Hearth → System.
     */
    router.get('/api/system/node-status-updates', readLimiter, async (req, res) => {
        try {
            const payload = await _buildNodeStatusPayload();
            res.json(payload);
        } catch (err) {
            res.status(500).json({
                success: false,
                error: 'Could not load node status updates: ' + err.message,
            });
        }
    });

    router.get('/api/system/purge-manifest', readLimiter, (req, res) => {
        res.json({
            success: true,
            purgeManifest: PURGE_MANIFEST,
        });
    });

    router.post('/api/system/refresh-node', writeLimiter, (req, res) => {
        if (!_isLocalRequest(req)) {
            return res.status(403).json({
                success: false,
                error: 'Refresh endpoint is local-only.',
            });
        }

        try {
            ensureDataRoot();
            ensureCanonicalDataFiles();
            const cleanup = runLegacyCleanupPass();
            let bootstrapStatus = 'unchanged';
            let rollingBootstrapStatus = 'unchanged';
            try {
                refreshBootstrap();
                bootstrapStatus = 'refreshed';
            } catch {
                bootstrapStatus = 'refresh-failed';
            }
            try {
                refreshRollingBootstrap();
                rollingBootstrapStatus = 'refreshed';
            } catch {
                rollingBootstrapStatus = 'refresh-failed';
            }
            let memoryCompressionStatus = 'unchanged';
            try {
                const memoryRefresh = refreshMemoryCompression({ stage: 'all' });
                const refreshed = memoryRefresh && memoryRefresh.refreshed ? memoryRefresh.refreshed : {};
                memoryCompressionStatus = Object.values(refreshed).some(Boolean) ? 'refreshed' : 'unchanged';
            } catch {
                memoryCompressionStatus = 'refresh-failed';
            }

            return res.json({
                success: true,
                message: 'Node refreshed. Local memory remains intact.',
                bootstrapStatus,
                rollingBootstrapStatus,
                memoryCompressionStatus,
                cleanup,
                checkedAt: new Date().toISOString(),
            });
        } catch (err) {
            return res.status(500).json({
                success: false,
                error: 'Could not refresh node: ' + err.message,
            });
        }
    });

    router.get('/api/system/bootstrap/export-md', readLimiter, (req, res) => {
        try {
            const markdown = buildContinuityBootstrapMarkdown();
            try {
                recordCacheInteraction({
                    kind: 'bootstrap_exported',
                    bootstrapPath: 'exports/ember-node-continuity-bootstrap.md',
                });
            } catch { /* non-blocking memory update */ }
            res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
            res.setHeader(
                'Content-Disposition',
                'attachment; filename="ember-node-continuity-bootstrap.md"',
            );
            return res.send(markdown);
        } catch (err) {
            return res.status(500).json({ error: 'Could not export continuity bootstrap: ' + err.message });
        }
    });

    router.post('/api/system/memory-compression/refresh', writeLimiter, (req, res) => {
        if (!_isLocalRequest(req)) {
            return res.status(403).json({
                success: false,
                error: 'Refresh endpoint is local-only.',
            });
        }
        const stage = req.body && typeof req.body.stage === 'string'
            ? req.body.stage
            : 'all';
        try {
            const result = refreshMemoryCompression({ stage });
            return res.json({
                success: true,
                message: 'Memory Compression refreshed.',
                stage: result.stage,
                refreshed: result.refreshed,
                memoryCompression: getMemoryCompressionStatus(),
                checkedAt: new Date().toISOString(),
            });
        } catch (err) {
            return res.status(500).json({
                success: false,
                error: 'Could not refresh memory compression: ' + err.message,
            });
        }
    });

    router.post('/api/system/incinerate', writeLimiter, (req, res) => {
        if (!_isLocalRequest(req)) {
            return res.status(403).json({
                success: false,
                error: 'Incineration endpoint is local-only.',
            });
        }

        const requestedMode = req.body && typeof req.body.mode === 'string'
            ? req.body.mode.trim().toLowerCase()
            : PURGE_MODES.TEMPORARY;
        const mode = requestedMode === PURGE_MODES.FULL ? PURGE_MODES.FULL : PURGE_MODES.TEMPORARY;
        const includeArchive = Boolean(req.body && req.body.includeArchive === true);

        try {
            const result = purgeNodeMemory({ mode, includeArchive });
            return res.json({
                success: true,
                message: mode === PURGE_MODES.FULL
                    ? 'Full incineration complete.'
                    : 'Temporary memory purge complete.',
                result,
                checkedAt: new Date().toISOString(),
            });
        } catch (err) {
            return res.status(500).json({
                success: false,
                error: 'Could not incinerate node memory: ' + err.message,
            });
        }
    });

    router.post('/api/system/shutdown', (req, res) => {
        if (!_isLocalRequest(req)) {
            return res.status(403).json({
                success: false,
                error: 'Shutdown endpoint is local-only.',
            });
        }

        if (shutdownScheduled) {
            return res.json({
                success: true,
                message: 'Ember Node is returning to slumber. You may close this window.',
            });
        }

        shutdownScheduled = true;

        res.json({
            success: true,
            message: 'Ember Node is returning to slumber. You may close this window.',
        });

        setTimeout(() => {
            if (process.env.NODE_ENV === 'test') {
                shutdownScheduled = false;
                return;
            }
            console.log('[system] Shutdown requested from local UI. Exiting process.');
            process.exit(0);
        }, SHUTDOWN_DELAY_MS);
    });

    router.get('/api/system/tuning/runtime-runs', readLimiter, (req, res) => {
        const state = _loadRuntimeTuningRunsState();
        return res.json({
            success: true,
            updated_at: state.updated_at,
            runs: state.runs,
            maxRuns: MAX_RUNTIME_TUNING_RUNS,
        });
    });

    router.post('/api/system/tuning/runtime-runs', writeLimiter, (req, res) => {
        const incomingRun = req.body && req.body.run ? req.body.run : null;
        if (!incomingRun || typeof incomingRun !== 'object') {
            return res.status(400).json({ success: false, error: 'run payload is required' });
        }
        try {
            const run = _sanitizeRuntimeTuningRun(incomingRun);
            const prior = _loadRuntimeTuningRunsState();
            const nextRuns = [run].concat(prior.runs || []).slice(0, MAX_RUNTIME_TUNING_RUNS);
            const saved = _saveRuntimeTuningRunsState({ runs: nextRuns });
            return res.json({
                success: true,
                run,
                runs: saved.runs,
                updated_at: saved.updated_at,
                maxRuns: MAX_RUNTIME_TUNING_RUNS,
            });
        } catch (err) {
            return res.status(500).json({
                success: false,
                error: 'Could not save runtime tuning run: ' + err.message,
            });
        }
    });

    return router;
}

module.exports = createSystemRouter;
