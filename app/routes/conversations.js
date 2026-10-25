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

const router = express.Router();

router.param('id', (req, res, next, id) => {
    if (!isValidStorageId(id)) return res.status(400).json({ error: 'Invalid conversation id' });
    next();
});

router.get('/api/conversations', readLimiter, (_req, res) => {
    res.json({ conversations: listConversations() });
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
