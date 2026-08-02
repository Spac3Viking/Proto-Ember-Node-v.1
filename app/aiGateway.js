'use strict';

const axios = require('axios');
const { resolveModelRoleRuntime } = require('./runtimeStewardship');

const DEFAULT_TIMEOUT_MS = 120000;

function isOfflineError(error) {
    return Boolean(error && (
        ['ECONNREFUSED', 'ENOTFOUND', 'ECONNABORTED'].includes(error.code) ||
        (error.response && error.response.status >= 500)
    ));
}

async function requestLocalCompletion({ messages, request = null, runtime = null, timeout = DEFAULT_TIMEOUT_MS, signal, options } = {}) {
    const resolved = runtime || await resolveModelRoleRuntime(request);
    try {
        const response = await axios.post(resolved.chatUrl, {
            model: resolved.model,
            stream: false,
            messages: Array.isArray(messages) ? messages : [],
            ...(options ? { options } : {}),
        }, { timeout, signal });
        return {
            content: response.data && response.data.message ? String(response.data.message.content || '') : '',
            runtime: resolved,
        };
    } catch (error) {
        error.offline = isOfflineError(error);
        throw error;
    }
}

module.exports = { DEFAULT_TIMEOUT_MS, isOfflineError, requestLocalCompletion };
