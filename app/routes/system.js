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
const { readLimiter } = require('../rateLimiters');
const {
    DATA_ROOT, ROOM_DIRS,
    INDEXES_DIR, PROJECTS_DIR, THREADS_DIR,
    USER_CARTRIDGES_DIR, SYSTEM_DIR, EXPORTS_DIR,
} = require('../storageConfig');
const { MODEL, OLLAMA_BASE_URL } = require('../toolRegistry');
const { loadChunks, loadEmbeddings, loadManifests } = require('../indexStore');
const { getEmbeddingStatus }                        = require('../embeddings');
const { listCartridges }                            = require('../cartridgeLoader');
const { loadIntakeState }                           = require('../intakeState');
const fs = require('fs');

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

        const bundledCartridgeCount = listCartridges().length;
        const userCartridgeCount    = fs.existsSync(USER_CARTRIDGES_DIR)
            ? fs.readdirSync(USER_CARTRIDGES_DIR).filter(f => f.endsWith('.json')).length
            : 0;

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
            storageRootSource: process.env.EMBER_DATA_ROOT ? 'EMBER_DATA_ROOT' : 'default',
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
            configuredBy: process.env.EMBER_DATA_ROOT ? 'EMBER_DATA_ROOT' : 'default',
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

    return router;
}

module.exports = createSystemRouter;
