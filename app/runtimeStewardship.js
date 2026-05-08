'use strict';

const axios = require('axios');
const { spawn } = require('child_process');
const { DEFAULT_OLLAMA_MODEL, getSelectedModel } = require('./aiConfig');

const MODEL = DEFAULT_OLLAMA_MODEL;
const OLLAMA_BASE_URL = 'http://localhost:11434';
const OLLAMA_CHAT_URL = `${OLLAMA_BASE_URL}/api/chat`;

function getEmberPrimeModel() {
    return getSelectedModel();
}

function resolveEmberPrimeRuntime() {
    return {
        chatUrl: OLLAMA_CHAT_URL,
        model: getSelectedModel(),
        runtimeId: 'ollama-local',
    };
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
        proc.on('error', () => {});
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
    getEmberPrimeModel,
    resolveEmberPrimeRuntime,
    probeOllamaRuntime,
    launchOllamaRuntime,
};
