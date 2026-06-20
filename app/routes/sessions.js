'use strict';

/**
 * Ember Node v.ᚠ — Phase 18A: Session Routes
 *
 * GET    /api/sessions              — list all sessions (summary)
 * POST   /api/sessions              — create a new session
 * GET    /api/sessions/:id          — load a session
 * PUT    /api/sessions/:id          — update session (title, currentStage, entries)
 * DELETE /api/sessions/:id          — delete a session
 * POST   /api/sessions/:id/stage    — save stage notes (optionally advance)
 * GET    /api/sessions/:id/export   — export session as markdown
 * POST   /api/sessions/:id/ai-assist — get AI field-assistant guidance for a stage
 */

const express = require('express');
const axios   = require('axios');

const { readLimiter, writeLimiter, chatLimiter } = require('../rateLimiters');
const {
    SESSION_STAGES,
    STAGE_QUESTIONS,
    STAGE_HEADINGS,
    listSessions,
    loadSession,
    createSession,
    updateSession,
    saveStageNotes,
    deleteSession,
    exportSessionMarkdown,
} = require('../sessions');
const { OLLAMA_CHAT_URL, getSelectedModelFallback } = require('../runtimeStewardship');

const router = express.Router();

const AI_ASSIST_TIMEOUT_MS = 60000;

// ── List sessions ─────────────────────────────────────────────────────────────

router.get('/api/sessions', readLimiter, (req, res) => {
    try {
        const sessions = listSessions();
        res.json({ sessions });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Create session ────────────────────────────────────────────────────────────

router.post('/api/sessions', writeLimiter, (req, res) => {
    try {
        const { title } = req.body || {};
        const session = createSession({ title: String(title || '') });
        res.json({ success: true, session });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Load session ──────────────────────────────────────────────────────────────

router.get('/api/sessions/:id', readLimiter, (req, res) => {
    const session = loadSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json({ session });
});

// ── Update session (title / currentStage / full entries replacement) ──────────

router.put('/api/sessions/:id', writeLimiter, (req, res) => {
    const patch = req.body && typeof req.body === 'object' ? req.body : {};
    if (typeof patch.currentStage === 'string') {
        if (!SESSION_STAGES.includes(patch.currentStage.trim().toLowerCase())) {
            return res.status(400).json({ error: 'Invalid stage' });
        }
    }
    try {
        const updated = updateSession(req.params.id, patch);
        if (!updated) return res.status(404).json({ error: 'Session not found' });
        res.json({ success: true, session: updated });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Delete session ────────────────────────────────────────────────────────────

router.delete('/api/sessions/:id', writeLimiter, (req, res) => {
    try {
        const deleted = deleteSession(req.params.id);
        if (!deleted) return res.status(404).json({ error: 'Session not found' });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Save stage notes ──────────────────────────────────────────────────────────

router.post('/api/sessions/:id/stage', writeLimiter, (req, res) => {
    const { stage, notes, advance } = req.body || {};
    if (!stage || !SESSION_STAGES.includes(String(stage).trim().toLowerCase())) {
        return res.status(400).json({ error: 'Invalid or missing stage' });
    }
    try {
        const updated = saveStageNotes(
            req.params.id,
            String(stage),
            String(notes || ''),
            Boolean(advance),
        );
        if (!updated) return res.status(404).json({ error: 'Session not found' });
        res.json({ success: true, session: updated });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Export as Markdown ────────────────────────────────────────────────────────

router.get('/api/sessions/:id/export', readLimiter, (req, res) => {
    try {
        const md = exportSessionMarkdown(req.params.id);
        if (md === null) return res.status(404).json({ error: 'Session not found' });
        res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
        res.setHeader(
            'Content-Disposition',
            'attachment; filename="session-' + encodeURIComponent(req.params.id) + '.md"',
        );
        res.send(md);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── AI Assist ─────────────────────────────────────────────────────────────────

/**
 * Build a focused field-assistant prompt for the given stage.
 * The assistant asks clarifying questions, summarizes notes, and suggests next steps.
 * It deliberately avoids large essays and stays brief.
 */
function _buildAssistPrompt(stage, notes, sessionTitle) {
    const heading   = STAGE_HEADINGS[stage] || stage;
    const questions = (STAGE_QUESTIONS[stage] || []).join('\n- ');
    const notesSafe = String(notes || '').trim();

    const systemPrompt = [
        'You are a quiet field assistant helping a person work through a structured reflection session.',
        'Your role is to ask clarifying questions, briefly summarise their notes, and suggest focused next steps.',
        'Keep your response short — no more than 120 words. Avoid essays. Stay practical and grounded.',
        'Stage: ' + heading,
        'Stage questions:\n- ' + questions,
    ].join('\n');

    const userContent = notesSafe
        ? 'My notes for this stage:\n\n' + notesSafe + '\n\nPlease help me reflect on this.'
        : 'I have not written any notes for this stage yet. What clarifying questions should I consider?';

    return { systemPrompt, userContent };
}

router.post('/api/sessions/:id/ai-assist', chatLimiter, async (req, res) => {
    const { stage, notes } = req.body || {};
    const normalStage = String(stage || '').trim().toLowerCase();

    if (!SESSION_STAGES.includes(normalStage)) {
        return res.status(400).json({ error: 'Invalid or missing stage' });
    }

    const session = loadSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const model = getSelectedModelFallback();
    const { systemPrompt, userContent } = _buildAssistPrompt(normalStage, notes, session.title);

    try {
        const response = await axios.post(
            OLLAMA_CHAT_URL,
            {
                model,
                stream: false,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user',   content: userContent },
                ],
            },
            { timeout: AI_ASSIST_TIMEOUT_MS },
        );
        const content = response.data &&
            response.data.message &&
            response.data.message.content
            ? response.data.message.content
            : '';
        res.json({ success: true, content });
    } catch (err) {
        // AI unavailable — return a graceful offline response
        if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' ||
            (err.response && err.response.status >= 500)) {
            return res.status(503).json({
                error: 'AI unavailable',
                offline: true,
                hint: 'You can continue the session without AI assistance.',
            });
        }
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
