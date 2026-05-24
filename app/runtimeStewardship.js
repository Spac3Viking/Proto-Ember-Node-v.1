'use strict';

const axios = require('axios');
const { spawn } = require('child_process');
const { DEFAULT_OLLAMA_MODEL, getSelectedModel } = require('./aiConfig');
const { resolveModelRuntimeForRequest } = require('./modelRoles');

const MODEL = DEFAULT_OLLAMA_MODEL;
const OLLAMA_BASE_URL = 'http://localhost:11434';
const OLLAMA_CHAT_URL = `${OLLAMA_BASE_URL}/api/chat`;

function getSelectedModelFallback() {
    return getSelectedModel();
}

// Legacy naming: keep until call sites are fully migrated.
function getEmberPrimeModel() {
    return getSelectedModelFallback();
}

let _ollamaTagsCache = {
    updatedAt: 0,
    models: [],
};

async function getInstalledOllamaModels() {
    const cacheTtlMs = 15_000;
    const now = Date.now();
    if (_ollamaTagsCache.models.length > 0 && (now - _ollamaTagsCache.updatedAt) < cacheTtlMs) {
        return _ollamaTagsCache.models.slice();
    }
    const probed = await probeOllamaRuntime();
    if (probed.ok) {
        _ollamaTagsCache = { updatedAt: now, models: probed.models.slice() };
        return probed.models.slice();
    }
    // If Ollama is unreachable and we have no prior successful probe, return null
    // so downstream routing does not treat "no models" as authoritative.
    if (_ollamaTagsCache.updatedAt <= 0) return null;
    return _ollamaTagsCache.models.slice();
}

async function resolveModelRoleRuntime(request = null) {
    const installedModels = await getInstalledOllamaModels().catch(() => null);
    const resolved = resolveModelRuntimeForRequest({
        ...(request || undefined),
        ...(installedModels ? { installedModels } : {}),
    });
    return {
        chatUrl: OLLAMA_CHAT_URL,
        model: resolved.model || getSelectedModel(),
        runtimeId: 'ollama-local',
        modelRole: resolved.modelRole || 'hearth',
        fallbackUsed: Boolean(resolved.fallbackUsed),
        requestedRoleModel: resolved.requestedRoleModel || null,
        fallbackReason: resolved.fallbackReason || null,
    };
}

// Legacy naming: keep until call sites are fully migrated.
async function resolveEmberPrimeRuntime(request = null) {
    return resolveModelRoleRuntime(request);
}

async function probeOllamaRuntime() {
    try {
        const response = await axios.get(OLLAMA_BASE_URL + '/api/tags');
        const models = Array.isArray(response.data && response.data.models) ? response.data.models : [];
        return {
            ok: true,
            models: models
                .map(m => (m && typeof m.name === 'string' ? m.name : null))
                .filter(Boolean),
        };
    } catch {
        return { ok: false, models: [] };
    }
}

async function launchOllamaRuntime() {
    const pre = await probeOllamaRuntime();
    if (pre.ok) {
        return { success: true, status: 'already_running' };
    }

    try {
        const proc = spawn('ollama', ['serve'], { detached: true, stdio: 'ignore' });
        proc.on('error', (err) => {
            console.warn('[runtime] Launch error:', err.message);
        });
        proc.unref();
    } catch (err) {
        return { success: false, status: 'error', error: err.message };
    }

    await new Promise(r => setTimeout(r, 2500));
    const post = await probeOllamaRuntime();
    if (!post.ok) {
        return { success: false, status: 'launch_failed' };
    }
    return { success: true, status: 'launched' };
}

module.exports = {
    MODEL,
    OLLAMA_BASE_URL,
    OLLAMA_CHAT_URL,
    getSelectedModelFallback,
    getEmberPrimeModel,
    resolveModelRoleRuntime,
    resolveEmberPrimeRuntime,
    probeOllamaRuntime,
    launchOllamaRuntime,
};
