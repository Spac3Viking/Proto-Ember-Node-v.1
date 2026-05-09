'use strict';

const { DEFAULT_OLLAMA_MODEL, getSelectedModel } = require('./aiConfig');

const MODEL = DEFAULT_OLLAMA_MODEL;
const OLLAMA_BASE_URL = 'http://localhost:11434';
const OLLAMA_CHAT_URL = OLLAMA_BASE_URL + '/api/chat';

function getRuntimeModel() {
    return getSelectedModel();
}

module.exports = {
    MODEL,
    OLLAMA_BASE_URL,
    OLLAMA_CHAT_URL,
    getRuntimeModel,
};
