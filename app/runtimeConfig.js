'use strict';

/**
 * Ember Node v.ᚠ — Canonical Runtime Configuration
 *
 * Single source of truth for host/port binding and Ollama runtime location,
 * so that runtime stewardship, embeddings, chat, Session assistance, and
 * health reporting all agree about where the Ember Node listens and where
 * the local AI runtime lives.
 *
 * Supported environment variables
 * --------------------------------
 *   EMBER_NODE_HOST            Host/interface to bind the web server to.
 *                               Default: 127.0.0.1 (loopback-only — v118 is
 *                               explicitly local, not LAN-ready).
 *   EMBER_NODE_PORT             Port to bind the web server to.
 *                               Default: 3477.
 *   OLLAMA_BASE_URL             Base URL for the local Ollama runtime.
 *                               Default: http://localhost:11434
 *   EMBER_OLLAMA_TIMEOUT_MS     Timeout (ms) applied to Ollama model-health
 *                               and tags requests, so a stopped/unreachable
 *                               Ollama never blocks the Ember Node itself.
 *                               Default: 2000
 *   EMBER_ARCHIVE_BASE_URL      Base URL for the optional hosted Green Fire
 *                               Archive used for cache-package updates.
 *                               Default: https://greenfire-archive.replit.app
 *                               This is a separate concern from Ollama and
 *                               is never assumed to be interchangeable with
 *                               any other Green Fire domain.
 *
 * Backward compatibility: EMBER_NODE_DATA_ROOT / EMBER_DATA_ROOT (data root
 * selection) remain handled by storageConfig.js and are unaffected by this
 * module.
 */

const { DEFAULT_OLLAMA_MODEL, getSelectedModel } = require('./aiConfig');

function _parsePort(value, fallback) {
    const parsed = parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : fallback;
}

function _parseTimeoutMs(value, fallback) {
    const parsed = parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

// ── Local server binding ──────────────────────────────────────────────────────

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3477;

const HOST = (process.env.EMBER_NODE_HOST && process.env.EMBER_NODE_HOST.trim())
    || DEFAULT_HOST;
const PORT = _parsePort(process.env.EMBER_NODE_PORT, DEFAULT_PORT);

// ── Ollama runtime location ───────────────────────────────────────────────────

const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434';
const OLLAMA_BASE_URL = (process.env.OLLAMA_BASE_URL && process.env.OLLAMA_BASE_URL.trim())
    || DEFAULT_OLLAMA_BASE_URL;
const OLLAMA_CHAT_URL = OLLAMA_BASE_URL + '/api/chat';
const OLLAMA_TAGS_URL = OLLAMA_BASE_URL + '/api/tags';

// Short, explicit timeout for model-health / tags checks so that a stopped
// or unreachable Ollama runtime never blocks Ember Node startup or requests.
const DEFAULT_OLLAMA_HEALTH_TIMEOUT_MS = 2000;
const OLLAMA_HEALTH_TIMEOUT_MS = _parseTimeoutMs(
    process.env.EMBER_OLLAMA_TIMEOUT_MS,
    DEFAULT_OLLAMA_HEALTH_TIMEOUT_MS,
);

// ── Optional hosted Green Fire Archive (cache-package updates) ────────────────

const DEFAULT_ARCHIVE_BASE_URL = 'https://greenfire-archive.replit.app';
const ARCHIVE_BASE_URL = (process.env.EMBER_ARCHIVE_BASE_URL && process.env.EMBER_ARCHIVE_BASE_URL.trim())
    || DEFAULT_ARCHIVE_BASE_URL;

// ── Model selection ───────────────────────────────────────────────────────────

const MODEL = DEFAULT_OLLAMA_MODEL;

function getRuntimeModel() {
    return getSelectedModel();
}

module.exports = {
    HOST,
    PORT,
    MODEL,
    OLLAMA_BASE_URL,
    OLLAMA_CHAT_URL,
    OLLAMA_TAGS_URL,
    OLLAMA_HEALTH_TIMEOUT_MS,
    ARCHIVE_BASE_URL,
    getRuntimeModel,
};
