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
    exportSessionMarkdown,
} = require('../sessions');
const {
    createSignalThread,
    deleteSignalThread,
    addOpenPressure,
    addCarryForwardEntry,
    loadSignalThread,
} = require('../signalThreads');
const { isValidStorageId } = require('../safeStorageId');
const { linkSessionToThread, resolveSessionContinuity, deleteSessionWithDetach } = require('../continuityContext');
const { requestLocalCompletion } = require('../aiGateway');
const { buildAiRequest } = require('../aiRequestContext');

const router = express.Router();

function normalizeSessionStageInput(stage) {
    const value = String(stage || '').trim().toLowerCase();
    return value === 'archive' ? 'remember' : value;
}

router.param('id', (req, res, next, id) => {
    if (!isValidStorageId(id)) return res.status(400).json({ error: 'Invalid session id' });
    next();
});

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
        const threadId = String(continueThreadId || '').trim();
        if (threadId) {
            if (!isValidStorageId(threadId)) return res.status(400).json({ error: 'Invalid thread id' });
            if (!loadSignalThread(threadId)) return res.status(404).json({ error: 'Thread not found' });
        }
        let session = createSession({ title: String(title || '') });
        if (threadId) {
            const linked = linkSessionToThread(session.id, threadId);
            if (linked.error) return res.status(linked.status).json({ error: linked.error });
            session = linked.session;
        }
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
    if (patch.continuity && Object.prototype.hasOwnProperty.call(patch.continuity, 'threadId')) {
        return res.status(409).json({ error: 'Use the canonical Thread link operation to change continuity.threadId' });
    }
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
        const result = deleteSessionWithDetach(req.params.id);
        if (result.error) return res.status(result.status).json({ error: result.error });
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

function _buildAssistPrompt(stage, notes) {
    const heading   = STAGE_HEADINGS[stage] || stage;
    const questions = (STAGE_QUESTIONS[stage] || []).join('\n- ');
    const notesSafe = String(notes || '').trim();

    const systemPrompt = [
        'You are a fallible local companion supporting observation, clarification, practical judgment, and continuity.',
        'Answer the person naturally, clearly, and practically. Distinguish observation, inference, and uncertainty when useful.',
        'Suggest a next action or ask a question only when it genuinely helps. Do not force headings, worksheets, or reflection prompts.',
        'The person remains the final authority. Records may be incomplete, outdated, biased, or contradictory.',
        'Stage: ' + heading,
        'Stage considerations:\n- ' + questions,
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

    const resolved = resolveSessionContinuity(session.id, String(notes || ''));
    const { systemPrompt, userContent } = _buildAssistPrompt(normalStage, notes);

    try {
        const aiRequest = buildAiRequest({
            systemPrompt,
            continuityContext: resolved.context,
            userContent,
        });
        const completion = await requestLocalCompletion({
            request: { query: userContent },
            timeout: 60000,
            messages: aiRequest.messages,
        });
        const content = completion.content;
        res.json({ success: true, content });
    } catch (err) {
        // AI unavailable — return a graceful offline response
        if (err.offline) {
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
    if (!threadId && session.continuity && session.continuity.threadId) {
        return res.status(409).json({ error: 'Session is already linked to another Thread' });
    }

    try {
        let thread = null;
        if (threadId) {
            const linked = linkSessionToThread(session.id, threadId);
            if (linked.error) return res.status(linked.status).json({ error: linked.error });
            thread = linked.thread;
        } else {
            const created = createSignalThread({
                title: newThreadTitle,
                posture: 'practical',
                summary: '',
                tags: [],
                sessionIds: [],
            });
            const linked = linkSessionToThread(session.id, created.id);
            if (linked.error) {
                deleteSignalThread(created.id);
                return res.status(linked.status).json({ error: linked.error });
            }
            thread = linked.thread;
        }
        if (openPressure) {
            thread = addOpenPressure(thread.id, openPressure) || thread;
        }
        if (carryForward) {
            addCarryForwardEntry(thread.id, carryForward, session.id);
            thread = loadSignalThread(thread.id) || thread;
        }
        res.json({ success: true, session: loadSession(session.id), thread });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

module.exports = router;
