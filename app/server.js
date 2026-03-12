const express = require('express');
const path = require('path');
const axios = require('axios');

const app = express();
const PORT = 3477;

const MODEL = 'gemma3:4b';
const OLLAMA_BASE_URL = 'http://localhost:11434';
const OLLAMA_CHAT_URL = `${OLLAMA_BASE_URL}/api/chat`;

// Middleware to serve static frontend files
app.use(express.static(path.join(__dirname, '..', 'public')));

// Chat API endpoint
app.use(express.json());
app.post('/chat', async (req, res) => {
    try {
        const { message, prompt, model: _ignored, ...rest } = req.body;
        const payload = {
            stream: false,
            ...rest,
            // Normalise the user text into the chat messages format
            messages: rest.messages || [{ role: 'user', content: message || prompt || '' }],
            // Always enforce the configured model, ignoring any client-supplied value
            model: MODEL,
        };
        const response = await axios.post(OLLAMA_CHAT_URL, payload);
        res.json(response.data);
    } catch (error) {
        console.error('Error forwarding prompt to Ollama:', error.message);
        res.status(500).send('Internal Server Error');
    }
});

// Check that the required Ollama model is available before starting
async function checkModel() {
    try {
        const response = await axios.get(`${OLLAMA_BASE_URL}/api/tags`);
        const models = (response.data.models || []).map((m) => m.name);
        if (!models.some((name) => name === MODEL || name.startsWith(MODEL + ':'))) {
            console.warn(
                `WARNING: Model "${MODEL}" was not found in Ollama. ` +
                `Available models: ${models.join(', ') || '(none)'}. ` +
                `Run: ollama pull ${MODEL}`
            );
        } else {
            console.log(`Model check passed: "${MODEL}" is available.`);
        }
    } catch (err) {
        console.warn(
            `WARNING: Could not reach Ollama at ${OLLAMA_BASE_URL}. ` +
            `Is Ollama running? (${err.message})`
        );
    }
}

if (require.main === module) {
    checkModel().then(() => {
        app.listen(PORT, () => {
            console.log(`Server is running on http://localhost:${PORT}`);
        });
    });
}

module.exports = { app, MODEL, OLLAMA_CHAT_URL, OLLAMA_BASE_URL };
