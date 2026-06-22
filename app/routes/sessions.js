'use strict';

/**
 * Ember Node v.ᚠ — Phase 18A: Session Routes
 *
 * GET    /api/sessions              — list all sessions (summary)
 * POST   /api/sessions              — create a new session
 * GET    /api/sessions/:id          — load a session
 * PUT    /api/sessions/:id          — update session (title, currentStage, entries)
 * DELETE /api/sessions/:id          — delete a session
 * POST   /api/sessions/:id/stage    — save stage notes (optionally advance; legacy "archive" maps to "remember")
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
const {
    createSignalThread,
    addSessionToSignalThread,
    addOpenPressure,
    addCarryForwardEntry,
    loadSignalThread,
} = require('../signalThreads');
const { OLLAMA_CHAT_URL, getSelectedModelFallback } = require('../runtimeStewardship');

const router = express.Router();

const AI_ASSIST_TIMEOUT_MS = 60000;

function normalizeSessionStageInput(stage) {
    const value = String(stage || '').trim().toLowerCase();
    return value === 'archive' ? 'remember' : value;
}

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
        const { title, continueThreadId } = req.body || {};
        let continuity = null;
        const threadId = String(continueThreadId || '').trim();
        if (threadId) {
            const thread = loadSignalThread(threadId);
            if (!thread) return res.status(404).json({ error: 'Signal Thread not found' });
            const latestReflection = Array.isArray(thread.reflections)
                ? thread.reflections.slice().sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')))[0]
                : null;
            const latestCarryForward = Array.isArray(thread.carryForwardEntries)
                ? thread.carryForwardEntries
                    .slice()
                    .sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')))[0]
                : null;
            continuity = {
                threadId: thread.id,
                threadTitle: thread.title,
                threadPurpose: String(thread.purpose || ''),
                openPressure: Array.isArray(thread.openPressures) && thread.openPressures.length
                    ? String(thread.openPressures[0])
                    : String(thread.openPressure || ''),
                carryForward: latestCarryForward && latestCarryForward.content
                    ? String(latestCarryForward.content)
                    : '',
                mostRecentReflection: latestReflection && latestReflection.content
                    ? String(latestReflection.content)
                    : '',
                lastSessionDate: '',
            };

            const linkedIds = Array.isArray(thread.sessionIds) ? thread.sessionIds : [];
            const linkedSessions = linkedIds.map(id => loadSession(id)).filter(Boolean);
            if (linkedSessions.length) {
                const latestSession = linkedSessions
                    .slice()
                    .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')))[0];
                continuity.lastSessionDate = String(latestSession.updatedAt || latestSession.createdAt || '');
            }
        }

        const session = createSession({ title: String(title || ''), continuity });
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
        patch.currentStage = normalizeSessionStageInput(patch.currentStage);
        if (!SESSION_STAGES.includes(patch.currentStage)) {
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
    const normalizedStage = normalizeSessionStageInput(stage);
    if (!stage || !SESSION_STAGES.includes(normalizedStage)) {
        return res.status(400).json({ error: 'Invalid or missing stage' });
    }
    try {
        const updated = saveStageNotes(
            req.params.id,
            normalizedStage,
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
        'Ask short, clarifying questions first. Keep a reflective, steady tone.',
        'Respond in 3–6 sentences, mostly as questions.',
        'Support continuity across sessions: unresolved pressure, carry forward, and next meaningful attention.',
        'Avoid conclusions, avoid long explanations, and avoid certainty language.',
        'Use prompts like: "What still matters from previous sessions?", "What remains unresolved?", and "What should be carried forward?".',
        'Do not over-explain or narrate; stay practical and compact.',
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
    const normalStage = normalizeSessionStageInput(stage);

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

router.post('/api/sessions/:id/archive-thread', writeLimiter, (req, res) => {
    const session = loadSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const threadId = String(body.threadId || '').trim();
    const newThreadTitle = String(body.newThreadTitle || '').trim();
    const openPressure = String(body.openPressure || '').trim();
    const carryForward = String(body.carryForward || '').trim();

    if (!threadId && !newThreadTitle) {
        return res.status(400).json({ error: 'threadId or newThreadTitle is required' });
    }

    try {
        let thread = null;
        if (threadId) {
            thread = addSessionToSignalThread(threadId, session.id);
            if (!thread) return res.status(404).json({ error: 'Signal Thread not found' });
        } else {
            const created = createSignalThread({
                title: newThreadTitle,
                posture: 'practical',
                summary: '',
                tags: [],
                sessionIds: [session.id],
            });
            thread = loadSignalThread(created.id);
        }
        if (openPressure) {
            thread = addOpenPressure(thread.id, openPressure) || thread;
        }
        if (carryForward) {
            addCarryForwardEntry(thread.id, carryForward, session.id);
            thread = loadSignalThread(thread.id) || thread;
        }
        res.json({ success: true, session, thread });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

module.exports = router;
