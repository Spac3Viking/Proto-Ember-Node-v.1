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
 * POST /api/system/shutdown
 */

const express = require('express');
const axios   = require('axios');
const fs = require('fs');
const path = require('path');
const { readLimiter, writeLimiter } = require('../rateLimiters');
const {
    DATA_ROOT, ROOM_DIRS,
    INDEXES_DIR, PROJECTS_DIR, THREADS_DIR,
    USER_CARTRIDGES_DIR, SYSTEM_DIR, EXPORTS_DIR,
    FORGE_DIR,
} = require('../storageConfig');
const { OLLAMA_BASE_URL } = require('../toolRegistry');
const { getSelectedModel, setSelectedModel } = require('../aiConfig');
const { loadChunks, loadEmbeddings, loadManifests } = require('../indexStore');
const { getEmbeddingStatus }                        = require('../embeddings');
const { listCartridges }                            = require('../cartridgeLoader');
const { loadIntakeState }                           = require('../intakeState');
const { loadBootstrap }                             = require('../bootstrap');
const { loadCourtConfig }                           = require('../courtConfig');
// Reuse canonical archive cache logic for installed/update status.
const { compareInstalledWithUpstream } = require('../archiveCacheService');

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
let shutdownScheduled = false;

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

        const bundledCartridgeCount = listCartridges().length;
        const userCartridgeCount    = fs.existsSync(USER_CARTRIDGES_DIR)
            ? fs.readdirSync(USER_CARTRIDGES_DIR).filter(f => f.endsWith('.json')).length
            : 0;

        // Phase 11.5: Forge + Bootstrap status
        const forgeLoaded   = fs.existsSync(FORGE_CORE_PATH);
        const bootstrap     = loadBootstrap();
        const bootstrapStatus = bootstrap ? 'ready' : 'not generated';
        const lastRefresh     = bootstrap ? (bootstrap.nodeState || {}).lastRefresh || null : null;
        const activeArchetype = bootstrap ? (bootstrap.nodeState || {}).activeArchetype || null : null;

        res.json({
            model:             getSelectedModel(),
            ollamaBaseUrl:     OLLAMA_BASE_URL,
            port:              3477,
            cartridgeCount:    bundledCartridgeCount,
            cartridges: {
                bundled:       bundledCartridgeCount,
                user:          userCartridgeCount,
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
            // Phase 11.5
            forgeLoaded,
            bootstrapStatus,
            lastBootstrapRefresh: lastRefresh,
            activeArchetype,
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
        try {
            const response = await axios.get(OLLAMA_BASE_URL + '/api/tags');
            const models = Array.isArray(response.data && response.data.models)
                ? response.data.models
                : [];
            res.json({
                provider: 'ollama',
                available: true,
                models: models.map(model => ({
                    name: model.name || null,
                    size: model.size != null ? String(model.size) : null,
                    modified_at: model.modified_at || null,
                })).filter(model => model.name),
                selected_model: getSelectedModel(),
            });
        } catch {
            res.json({
                provider: 'ollama',
                available: false,
                models: [],
                selected_model: null,
                error: 'Ollama is not running',
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
     * GET /api/storage-info
     */
    router.get('/api/storage-info', readLimiter, (req, res) => {
        const userCartridgeCount = fs.existsSync(USER_CARTRIDGES_DIR)
            ? fs.readdirSync(USER_CARTRIDGES_DIR).filter(f => f.endsWith('.json')).length
            : 0;

        res.json({
            dataRoot:     DATA_ROOT,
            configuredBy: process.env.EMBER_NODE_DATA_ROOT ? 'EMBER_NODE_DATA_ROOT'
                        : process.env.EMBER_DATA_ROOT      ? 'EMBER_DATA_ROOT'
                        : 'default',
            directories: {
                hearth:     ROOM_DIRS.hearth,
                workshop:   ROOM_DIRS.workshop,
                threshold:  ROOM_DIRS.threshold,
                indexes:    INDEXES_DIR,
                projects:   PROJECTS_DIR,
                threads:    THREADS_DIR,
                cartridges: USER_CARTRIDGES_DIR,
                system:     SYSTEM_DIR,
                exports:    EXPORTS_DIR,
            },
            migration: {
                detected:  migrationResult.detected,
                performed: migrationResult.performed,
                mode:      migrationResult.mode,
                errors:    migrationResult.errors,
            },
            cartridges: {
                bundled: listCartridges().length,
                user:    userCartridgeCount,
            },
        });
    });

    /**
     * GET /api/intake-state
     * Returns the full persistent intake state (files and tools).
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

    return router;
}

module.exports = createSystemRouter;
