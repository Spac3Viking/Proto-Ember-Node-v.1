'use strict';

/**
 * Ember Node v.ᚠ — System Routes
 *
 * GET /api/status
 * GET /api/ollama-status
 * GET /api/storage-info
 * GET /api/intake-state
 */

const express = require('express');
const axios   = require('axios');
const fs = require('fs');
const path = require('path');
const { readLimiter } = require('../rateLimiters');
const {
    DATA_ROOT, ROOM_DIRS,
    INDEXES_DIR, PROJECTS_DIR, THREADS_DIR,
    USER_CARTRIDGES_DIR, SYSTEM_DIR, EXPORTS_DIR,
    FORGE_DIR,
} = require('../storageConfig');
const { MODEL, OLLAMA_BASE_URL } = require('../toolRegistry');
const { loadChunks, loadEmbeddings, loadManifests } = require('../indexStore');
const { getEmbeddingStatus }                        = require('../embeddings');
const { listCartridges }                            = require('../cartridgeLoader');
const { loadIntakeState }                           = require('../intakeState');
const { loadBootstrap }                             = require('../bootstrap');
// Reuse canonical archive cache logic for version comparison and installed/update status.
const { compareVersionStrings, compareInstalledWithUpstream } = require('../archiveCacheService');

const FORGE_CORE_PATH = path.join(FORGE_DIR, 'forge-core.json');
const PACKAGE_JSON_PATH = path.join(__dirname, '..', '..', 'package.json');
const DEFAULT_UPDATE_PAGE_URL = 'https://github.com/Spac3Viking/Proto-Ember-Node-v.1/releases';
const DEFAULT_RELEASES_API_URL = 'https://api.github.com/repos/Spac3Viking/Proto-Ember-Node-v.1/releases/latest';
const CACHE_STATUS_ORDER = [
    { packageId: 'green-fire-core', label: 'Core Cache' },
    { packageId: 'green-fire-codices-cache', label: 'Codices Cache' },
    { packageId: 'green-fire-grimoires-cache', label: 'Grimoires Cache' },
    { packageId: 'green-fire-sagas-cache', label: 'Sagas Cache' },
    { packageId: 'green-fire-reference-cache', label: 'Reference Cache' },
    { packageId: 'green-fire-gallery-cache', label: 'Gallery Cache' },
    { packageId: 'green-fire-complete-cache', label: 'Complete Cache' },
];

let latestVersionCache = {
    checkedAt: 0,
    payload: null,
};

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

async function _checkLatestAppVersion(config) {
    const now = Date.now();
    const ttlMs = 5 * 60 * 1000;
    if (latestVersionCache.payload && (now - latestVersionCache.checkedAt) < ttlMs) {
        return latestVersionCache.payload;
    }

    if (!config.releasesApiUrl) {
        const payload = {
            latestVersion: null,
            updateStatus: 'Coming soon',
            checkedAt: new Date().toISOString(),
            message: 'Release checks are not configured yet.',
        };
        latestVersionCache = { checkedAt: now, payload };
        return payload;
    }

    try {
        const res = await axios.get(config.releasesApiUrl, {
            timeout: 5000,
            headers: { Accept: 'application/vnd.github+json' },
        });
        const latestVersion = _normalizeVersionString((res.data && (res.data.tag_name || res.data.name)) || null);
        const payload = {
            latestVersion,
            updateStatus: latestVersion ? null : 'Unable to check',
            checkedAt: new Date().toISOString(),
            message: latestVersion ? null : 'Latest release metadata did not include a version tag.',
        };
        latestVersionCache = { checkedAt: now, payload };
        return payload;
    } catch (err) {
        const payload = {
            latestVersion: null,
            updateStatus: 'Unable to check',
            checkedAt: new Date().toISOString(),
            message: err.message,
        };
        latestVersionCache = { checkedAt: now, payload };
        return payload;
    }
}

async function _buildNodeStatusPayload() {
    const packageConfig = _loadPackageConfig();
    const currentAppVersion = _normalizeVersionString(packageConfig.version) || '0.0.0';
    const emberNodeConfig = packageConfig.emberNode || {};
    const updatePageUrl = emberNodeConfig.updatePageUrl || DEFAULT_UPDATE_PAGE_URL;
    const releasesApiUrl = emberNodeConfig.releasesApiUrl || DEFAULT_RELEASES_API_URL;
    const latestVersionResult = await _checkLatestAppVersion({ releasesApiUrl });

    let updateStatus = latestVersionResult.updateStatus;
    if (!updateStatus && latestVersionResult.latestVersion) {
        const cmp = compareVersionStrings(currentAppVersion, latestVersionResult.latestVersion);
        updateStatus = cmp < 0 ? 'Update available' : 'Up to date';
    } else if (!updateStatus) {
        updateStatus = 'Unable to check';
    }

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
        latestAvailableVersion: latestVersionResult.latestVersion,
        updateStatus,
        updatePageUrl,
        dataRootPath: DATA_ROOT,
        checkedAt: latestVersionResult.checkedAt,
        updateMessage: latestVersionResult.message || null,
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
            model:             MODEL,
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

    return router;
}

module.exports = createSystemRouter;
