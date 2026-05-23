'use strict';

const fs = require('fs');
const path = require('path');
const { SYSTEM_CONFIG_DIR } = require('./storageConfig');

const DEFAULT_OLLAMA_MODEL = 'gemma3:4b';
const AI_CONFIG_PATH = path.join(SYSTEM_CONFIG_DIR, 'ai.json');
const DEFAULT_AI_CONFIG = {
    provider: 'ollama',
    selected_model: DEFAULT_OLLAMA_MODEL,
};

function _normalizeOptionalString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function _normalizeModelRoles(value) {
    if (!value || typeof value !== 'object') return null;
    return {
        hearth: _normalizeOptionalString(value.hearth),
        forge: _normalizeOptionalString(value.forge),
        scribe: _normalizeOptionalString(value.scribe),
    };
}

function _normalizeRouting(value) {
    if (!value || typeof value !== 'object') return null;
    const next = {};
    for (const [key, role] of Object.entries(value)) {
        const normalizedKey = _normalizeOptionalString(key).toLowerCase();
        const normalizedRole = _normalizeOptionalString(role).toLowerCase();
        if (!normalizedKey || !normalizedRole) continue;
        next[normalizedKey] = normalizedRole;
    }
    return Object.keys(next).length > 0 ? next : null;
}

function loadAiConfig() {
    try {
        if (!fs.existsSync(AI_CONFIG_PATH)) {
            saveAiConfig(DEFAULT_AI_CONFIG);
            return { ...DEFAULT_AI_CONFIG };
        }
        const parsed = JSON.parse(fs.readFileSync(AI_CONFIG_PATH, 'utf8'));
        const selected_model = typeof parsed.selected_model === 'string' && parsed.selected_model.trim()
            ? parsed.selected_model.trim()
            : DEFAULT_OLLAMA_MODEL;
        const model_roles = _normalizeModelRoles(parsed.model_roles);
        const routing = _normalizeRouting(parsed.routing);
        const next = {
            provider: 'ollama',
            selected_model,
        };
        if (model_roles) next.model_roles = model_roles;
        if (routing) next.routing = routing;
        return next;
    } catch {
        return { ...DEFAULT_AI_CONFIG };
    }
}

function saveAiConfig(config) {
    const model_roles = _normalizeModelRoles(config && config.model_roles);
    const routing = _normalizeRouting(config && config.routing);
    const next = {
        provider: 'ollama',
        selected_model: typeof (config && config.selected_model) === 'string' && config.selected_model.trim()
            ? config.selected_model.trim()
            : DEFAULT_OLLAMA_MODEL,
    };
    if (model_roles) next.model_roles = model_roles;
    if (routing) next.routing = routing;
    fs.mkdirSync(path.dirname(AI_CONFIG_PATH), { recursive: true });
    fs.writeFileSync(AI_CONFIG_PATH, JSON.stringify(next, null, 2), 'utf8');
    return next;
}

function getSelectedModel() {
    return loadAiConfig().selected_model;
}

function setSelectedModel(model) {
    const current = loadAiConfig();
    return saveAiConfig({
        provider: 'ollama',
        selected_model: model,
        model_roles: current.model_roles,
        routing: current.routing,
    }).selected_model;
}

function setModelRole(role, model) {
    const normalizedRole = typeof role === 'string' ? role.trim().toLowerCase() : '';
    if (!['hearth', 'forge', 'scribe'].includes(normalizedRole)) {
        throw new Error('Invalid role');
    }
    const current = loadAiConfig();
    const nextRoles = current.model_roles || { hearth: '', forge: '', scribe: '' };
    nextRoles[normalizedRole] = _normalizeOptionalString(model);
    return saveAiConfig({
        provider: 'ollama',
        selected_model: current.selected_model,
        model_roles: nextRoles,
        routing: current.routing,
    });
}

module.exports = {
    AI_CONFIG_PATH,
    DEFAULT_OLLAMA_MODEL,
    loadAiConfig,
    saveAiConfig,
    getSelectedModel,
    setSelectedModel,
    setModelRole,
};
