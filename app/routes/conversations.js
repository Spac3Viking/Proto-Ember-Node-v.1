'use strict';

const express = require('express');
const { readLimiter, writeLimiter } = require('../rateLimiters');
const {
    appendMessage,
    createConversation,
    deleteConversation,
    exportConversationMarkdown,
    listConversations,
    loadConversation,
    renameConversation,
} = require('../conversations');
const { isValidStorageId } = require('../safeStorageId');
const { requestLocalCompletion } = require('../aiGateway');
const { boundedTranscript, getActiveInstructions } = require('../chatInstructions');

const router = express.Router();
const activeRequests = new Map();

router.param('id', (req, res, next, id) => {
    if (!isValidStorageId(id)) return res.status(400).json({ error: 'Invalid conversation id' });
    next();
});

router.get('/api/conversations', readLimiter, (_req, res) => {
    res.json({ conversations: listConversations() });
});

router.get('/api/conversations/instructions', readLimiter, (_req, res) => {
    const instructions = getActiveInstructions();
    res.json({ files: instructions.files });
});

router.post('/api/conversations', writeLimiter, (req, res) => {
    try {
        res.status(201).json({ conversation: createConversation(req.body && req.body.title) });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

router.get('/api/conversations/:id', readLimiter, (req, res) => {
    const conversation = loadConversation(req.params.id);
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
    res.json({ conversation });
});

router.put('/api/conversations/:id', writeLimiter, (req, res) => {
    try {
        const conversation = renameConversation(req.params.id, req.body && req.body.title);
        if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
        res.json({ conversation });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

router.post('/api/conversations/:id/messages', writeLimiter, (req, res) => {
    try {
        const result = appendMessage(req.params.id, req.body || {});
        if (!result) return res.status(404).json({ error: 'Conversation not found' });
        res.status(201).json(result);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

router.post('/api/conversations/:id/respond', writeLimiter, async (req, res) => {
    const requestId = String(req.body && req.body.requestId || '').trim();
    const content = String(req.body && req.body.content || '').trim();
    if (!requestId || !content) return res.status(400).json({ error: 'requestId and content are required' });
    const key = req.params.id + ':' + requestId;
    if (activeRequests.has(key)) return res.status(409).json({ error: 'This request is already running' });

    let appended;
    try {
        appended = appendMessage(req.params.id, { role: 'user', content });
        if (!appended) return res.status(404).json({ error: 'Conversation not found' });
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }

    const controller = new AbortController();
    const state = { controller, completed: false, cancelled: false };
    activeRequests.set(key, state);
    const instructions = getActiveInstructions();
    const transcript = boundedTranscript(appended.conversation.messages);
    try {
        const completion = await requestLocalCompletion({
            messages: [{ role: 'system', content: instructions.systemPrompt }, ...transcript.messages],
            signal: controller.signal,
        });
        state.completed = true;
        if (state.cancelled) return res.status(409).json({ error: 'Request cancelled', cancelled: true });
        const saved = appendMessage(req.params.id, { role: 'assistant', content: completion.content });
        if (!saved) return res.status(404).json({ error: 'Conversation was deleted while generating' });
        res.json({
            conversation: saved.conversation,
            response: saved.message,
            context: {
                omittedMessages: transcript.omittedMessages,
                notice: transcript.omittedMessages
                    ? transcript.omittedMessages + ' older saved message(s) were omitted from this model request.'
                    : '',
            },
        });
    } catch (error) {
        if (state.cancelled || error.name === 'CanceledError' || error.code === 'ERR_CANCELED') {
            return res.status(409).json({ error: 'Request cancelled', cancelled: true });
        }
        res.status(error.offline ? 503 : 500).json({
            error: error.offline ? 'Local AI is unavailable' : error.message,
            saved: true,
        });
    } finally {
        activeRequests.delete(key);
    }
});

router.post('/api/conversations/:id/respond/cancel', writeLimiter, (req, res) => {
    const requestId = String(req.body && req.body.requestId || '').trim();
    const state = activeRequests.get(req.params.id + ':' + requestId);
    if (!state) return res.json({ success: true, cancelled: false, completed: true });
    if (state.completed) return res.json({ success: true, cancelled: false, completed: true });
    state.cancelled = true;
    state.controller.abort();
    res.json({ success: true, cancelled: true });
});

router.delete('/api/conversations/:id', writeLimiter, (req, res) => {
    if (!deleteConversation(req.params.id)) return res.status(404).json({ error: 'Conversation not found' });
    res.status(204).end();
});

router.get('/api/conversations/:id/export', readLimiter, (req, res) => {
    const markdown = exportConversationMarkdown(req.params.id);
    if (markdown === null) return res.status(404).json({ error: 'Conversation not found' });
    res.type('text/markdown').attachment('conversation-' + req.params.id + '.md').send(markdown);
});

module.exports = router;
