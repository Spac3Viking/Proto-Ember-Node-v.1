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

function loadAiConfig() {
    try {
        if (!fs.existsSync(AI_CONFIG_PATH)) {
            saveAiConfig(DEFAULT_AI_CONFIG);
            return { ...DEFAULT_AI_CONFIG };
        }
        const parsed = JSON.parse(fs.readFileSync(AI_CONFIG_PATH, 'utf8'));
        return {
            provider: 'ollama',
            selected_model: typeof parsed.selected_model === 'string' && parsed.selected_model.trim()
                ? parsed.selected_model.trim()
                : DEFAULT_OLLAMA_MODEL,
        };
    } catch {
        return { ...DEFAULT_AI_CONFIG };
    }
}

function saveAiConfig(config) {
    const next = {
        provider: 'ollama',
        selected_model: typeof config.selected_model === 'string' && config.selected_model.trim()
            ? config.selected_model.trim()
            : DEFAULT_OLLAMA_MODEL,
    };
    fs.mkdirSync(path.dirname(AI_CONFIG_PATH), { recursive: true });
    fs.writeFileSync(AI_CONFIG_PATH, JSON.stringify(next, null, 2), 'utf8');
    return next;
}

function getSelectedModel() {
    return loadAiConfig().selected_model;
}

function setSelectedModel(model) {
    return saveAiConfig({
        provider: 'ollama',
        selected_model: model,
    }).selected_model;
}

module.exports = {
    AI_CONFIG_PATH,
    DEFAULT_OLLAMA_MODEL,
    loadAiConfig,
    saveAiConfig,
    getSelectedModel,
    setSelectedModel,
};
