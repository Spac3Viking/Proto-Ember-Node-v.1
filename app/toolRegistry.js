'use strict';

/**
 * Ember Node v.ᚠ — Tool Registry
 *
 * Single source of truth for tool persistence: discovery merging, trust state,
 * role assignment, and active Heart resolution.
 */

const fs   = require('fs');
const path = require('path');
const { SYSTEM_DIR } = require('./storageConfig');
const { discoverTools, httpProbe } = require('./toolDiscovery');

// ── Constants ─────────────────────────────────────────────────────────────────

const MODEL           = 'gemma3:4b';
const OLLAMA_BASE_URL = 'http://localhost:11434';
const OLLAMA_CHAT_URL = `${OLLAMA_BASE_URL}/api/chat`;

/** Path to the tool registry JSON file. */
const TOOLS_REGISTRY_PATH = path.join(SYSTEM_DIR, 'tools.json');

// ── Registry persistence ──────────────────────────────────────────────────────

/**
 * Load the tool registry from disk.
 * Returns a default empty registry if the file does not exist.
 *
 * @returns {{ tools: object[], active: object }}
 */
function loadToolRegistry() {
    if (!fs.existsSync(TOOLS_REGISTRY_PATH)) {
        return { tools: [], active: {} };
    }
    try {
        return JSON.parse(fs.readFileSync(TOOLS_REGISTRY_PATH, 'utf8'));
    } catch {
        return { tools: [], active: {} };
    }
}

/**
 * Persist the tool registry to disk.
 *
 * @param {{ tools: object[], active: object }} registry
 */
function saveToolRegistry(registry) {
    fs.writeFileSync(TOOLS_REGISTRY_PATH, JSON.stringify(registry, null, 2), 'utf8');
}

// ── Discovery merge ───────────────────────────────────────────────────────────

/**
 * Merge a freshly discovered list of tools into the registry.
 *
 * Rules:
 *   - New tools (id not in registry) are added with trusted=false.
 *   - Existing tools keep their trust status, role, and active selection.
 *   - lastSeen is updated for all detected tools.
 *   - Tools no longer detected are kept with status='not_detected'.
 *
 * @param {object[]} detected  Array of tool records from discoverTools()
 * @returns {object[]}         Merged tools list
 */
function mergeDetectedTools(detected) {
    const registry = loadToolRegistry();
    const byId     = {};
    registry.tools.forEach(t => { byId[t.id] = t; });

    const now = new Date().toISOString();

    // Update or insert detected tools
    detected.forEach(d => {
        if (byId[d.id]) {
            byId[d.id].status   = d.status;
            byId[d.id].running  = (d.running === true);
            byId[d.id].lastSeen = d.status === 'detected' ? now : byId[d.id].lastSeen;
            if (d.endpoint !== undefined) byId[d.id].endpoint = d.endpoint;
        } else {
            byId[d.id] = {
                ...d,
                trusted:  false,
                role:     null,
                running:  (d.running === true),
                lastSeen: d.status === 'detected' ? now : null,
            };
        }
    });

    // Mark tools that are no longer detected
    const detectedIds = new Set(detected.map(d => d.id));
    Object.values(byId).forEach(t => {
        if (!detectedIds.has(t.id)) {
            t.status  = 'not_detected';
            t.running = false;
        }
    });

    const merged = Object.values(byId);
    saveToolRegistry({ tools: merged, active: registry.active });
    return merged;
}

// ── Active Heart resolution ───────────────────────────────────────────────────

/**
 * Return the active Heart's chat URL and model name, falling back to the
 * built-in Ollama defaults when no Heart is assigned or the assigned tool
 * is unavailable.
 *
 * @returns {{ chatUrl: string, model: string, toolId: string|null }}
 */
function resolveActiveHeart() {
    const registry = loadToolRegistry();
    const heartId  = registry.active && registry.active.heart;
    if (heartId) {
        const tool = (registry.tools || []).find(t => t.id === heartId && t.trusted);
        if (tool && tool.interface === 'http' && tool.endpoint) {
            return {
                chatUrl: tool.endpoint.replace(/\/$/, '') + '/api/chat',
                model:   MODEL,
                toolId:  tool.id,
            };
        }
    }
    return { chatUrl: OLLAMA_CHAT_URL, model: MODEL, toolId: null };
}

module.exports = {
    MODEL,
    OLLAMA_BASE_URL,
    OLLAMA_CHAT_URL,
    loadToolRegistry,
    saveToolRegistry,
    mergeDetectedTools,
    resolveActiveHeart,
    discoverTools,
    httpProbe,
};
