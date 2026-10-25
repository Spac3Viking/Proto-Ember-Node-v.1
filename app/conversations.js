'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { THREADS_DIR } = require('./storageConfig');
const { resolveSafeStoragePath, isValidStorageId } = require('./safeStorageId');

function now() {
    return new Date().toISOString();
}

function conversationPath(id) {
    return resolveSafeStoragePath(THREADS_DIR, id);
}

function normalizeMessage(message) {
    const raw = message && typeof message === 'object' ? message : {};
    const role = raw.role === 'assistant' ? 'assistant' : 'user';
    return {
        id: String(raw.id || crypto.randomUUID()),
        role,
        content: String(raw.content || ''),
        timestamp: raw.timestamp ? String(raw.timestamp) : now(),
    };
}

function normalizeConversation(raw) {
    const record = raw && typeof raw === 'object' ? raw : {};
    return {
        id: String(record.id || ''),
        title: String(record.title || '').trim() || 'New chat',
        createdAt: record.createdAt ? String(record.createdAt) : now(),
        updatedAt: record.updatedAt ? String(record.updatedAt) : now(),
        messages: Array.isArray(record.messages) ? record.messages.map(normalizeMessage) : [],
    };
}

function loadConversation(id) {
    if (!isValidStorageId(id)) return null;
    const file = conversationPath(id);
    if (!file || !fs.existsSync(file)) return null;
    try {
        return normalizeConversation(JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch {
        return null;
    }
}

function saveConversation(conversation) {
    const file = conversationPath(conversation.id);
    if (!file) throw new Error('Invalid conversation id');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(conversation, null, 2), 'utf8');
    return conversation;
}

function listConversations() {
    if (!fs.existsSync(THREADS_DIR)) return [];
    return fs.readdirSync(THREADS_DIR)
        .filter(file => file.endsWith('.json'))
        .map(file => loadConversation(path.basename(file, '.json')))
        .filter(Boolean)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .map(({ messages, ...summary }) => ({ ...summary, messageCount: messages.length }));
}

function createConversation(title) {
    const createdAt = now();
    return saveConversation({
        id: 'chat-' + crypto.randomUUID(),
        title: String(title || '').trim() || 'New chat',
        createdAt,
        updatedAt: createdAt,
        messages: [],
    });
}

function renameConversation(id, title) {
    const conversation = loadConversation(id);
    if (!conversation) return null;
    const nextTitle = String(title || '').trim();
    if (!nextTitle) throw new Error('A chat name is required');
    conversation.title = nextTitle;
    conversation.updatedAt = now();
    return saveConversation(conversation);
}

function appendMessage(id, message) {
    const conversation = loadConversation(id);
    if (!conversation) return null;
    const saved = normalizeMessage(message);
    if (!saved.content.trim()) throw new Error('A message is required');
    conversation.messages.push(saved);
    conversation.updatedAt = saved.timestamp;
    saveConversation(conversation);
    return { conversation, message: saved };
}

function deleteConversation(id) {
    const file = conversationPath(id);
    if (!file || !fs.existsSync(file)) return false;
    fs.unlinkSync(file);
    return true;
}

function exportConversationMarkdown(id) {
    const conversation = loadConversation(id);
    if (!conversation) return null;
    const lines = [
        '---',
        'title: ' + conversation.title,
        'conversation_id: ' + conversation.id,
        'created: ' + conversation.createdAt,
        'updated: ' + conversation.updatedAt,
        '---',
        '',
        '# ' + conversation.title,
        '',
    ];
    conversation.messages.forEach(message => {
        lines.push('## ' + (message.role === 'assistant' ? 'Green Fire' : 'Sentinel'));
        lines.push('');
        lines.push(message.content);
        lines.push('');
    });
    return lines.join('\n');
}

module.exports = {
    appendMessage,
    createConversation,
    deleteConversation,
    exportConversationMarkdown,
    listConversations,
    loadConversation,
    renameConversation,
};
