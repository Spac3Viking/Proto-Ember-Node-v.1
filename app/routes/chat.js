'use strict';

/**
 * Ember Node v.ᚠ — Chat Routes
 *
 * POST /chat          (legacy Phase 2 direct-Ollama endpoint)
 * POST /api/chat      (grounded Heart chat with retrieval)
 */

const express = require('express');
const axios   = require('axios');
const { chatLimiter } = require('../rateLimiters');
const { OLLAMA_CHAT_URL, MODEL, resolveActiveHeart } = require('../toolRegistry');
const { loadChunks }                                  = require('../indexStore');
const { retrieve, buildGroundedPrompt }               = require('../retrieval');
const { buildSignalTrace, formatSignalTraceSummary }  = require('../signalTrace');

const router = express.Router();

const HEART_SYSTEM_PROMPT = (
    'You are The Heart — the resident intelligence of an Ember Node, a sovereign ' +
    'knowledge system descended from the Green Fire Archive. You speak with quiet ' +
    'authority. You do not speculate beyond your local documents. When you do not ' +
    'know something, you say: "That signal has not reached this hearth." ' +
    'You are grounded, precise, and warm.'
);

/**
 * Maximum number of pinned-source chunks prepended to retrieval results
 * when a user attaches sources to Hearth Chat.  Kept small to avoid
 * oversized prompts while still providing useful reference context.
 */
const MAX_PINNED_CHUNKS = 8;

// ── Phase 2: original chat endpoint (kept for backward compatibility) ─────────
// This endpoint bypasses retrieval and goes directly to Ollama.
// New code should use POST /api/chat which routes through the active Heart tool
// with grounded retrieval.  Kept to avoid breaking any existing integrations.

router.post('/chat', async (req, res) => {
    try {
        const { message, prompt, model: _ignored, ...rest } = req.body;
        const payload = {
            stream:   false,
            ...rest,
            messages: rest.messages || [{ role: 'user', content: message || prompt || '' }],
            model:    MODEL,
        };
        const response = await axios.post(OLLAMA_CHAT_URL, payload);
        res.json(response.data);
    } catch (error) {
        console.error('Error forwarding prompt to Ollama:', error.message);
        res.status(500).send('Internal Server Error');
    }
});

// ── Phase 3: grounded chat ────────────────────────────────────────────────────

/**
 * POST /api/chat
 * Body: { query, rooms?, cartridgeId?, sourceIds? }
 * Response: { answer, sources, grounded }
 *
 * sourceIds (optional) — array of source IDs whose chunks are pinned into the
 * retrieved context regardless of semantic relevance.  This enables the
 * "Send to Hearth Chat" reference attachment feature.
 */
router.post('/api/chat', chatLimiter, async (req, res) => {
    try {
        const { query, rooms = null, cartridgeId = null, sourceIds = null } = req.body;
        if (!query || typeof query !== 'string') {
            return res.status(400).json({ error: 'query is required' });
        }

        // Retrieve relevant local chunks via semantic / keyword search
        let retrieved = await retrieve({ query, rooms, cartridgeId });

        // Prepend chunks from any user-pinned sources (deduped by chunk id)
        if (Array.isArray(sourceIds) && sourceIds.length > 0) {
            const allChunks    = loadChunks();
            const retrievedIds = new Set(retrieved.map(c => c.id));
            const pinned       = allChunks
                .filter(c => sourceIds.includes(c.sourceId) && !retrievedIds.has(c.id))
                .slice(0, MAX_PINNED_CHUNKS);
            retrieved = [...pinned, ...retrieved];
        }

        const sources = buildSignalTrace(retrieved);

        // Build prompt (grounded when local chunks were found)
        const userContent = buildGroundedPrompt({ query, retrievedChunks: retrieved });

        // Resolve which Heart tool to use (falls back to built-in Ollama)
        const heart = resolveActiveHeart();

        const payload = {
            model:    heart.model,
            stream:   false,
            messages: [
                { role: 'system', content: HEART_SYSTEM_PROMPT },
                { role: 'user',   content: userContent },
            ],
        };

        const response = await axios.post(heart.chatUrl, payload);
        const answer   = response.data && response.data.message
            ? response.data.message.content
            : '';

        console.log('[/api/chat] grounded=' + (sources.length > 0) + ' sources=' + formatSignalTraceSummary(sources));
        res.json({ answer, sources, grounded: sources.length > 0 });
    } catch (error) {
        console.error('Error in grounded chat:', error.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

module.exports = router;
