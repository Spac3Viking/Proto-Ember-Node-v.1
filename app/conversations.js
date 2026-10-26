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
    const normalized = {
        id: String(raw.id || crypto.randomUUID()),
        role,
        content: String(raw.content || ''),
        timestamp: raw.timestamp ? String(raw.timestamp) : now(),
    };
    if (typeof raw.requestId === 'string' && raw.requestId.trim()) normalized.requestId = raw.requestId.trim();
    return normalized;
}

function normalizeConversation(raw) {
    const record = raw && typeof raw === 'object' ? raw : {};
    return {
        id: String(record.id || ''),
        title: String(record.title || '').trim() || 'New chat',
        createdAt: record.createdAt ? String(record.createdAt) : now(),
        updatedAt: record.updatedAt ? String(record.updatedAt) : now(),
        messages: Array.isArray(record.messages) ? record.messages.map(normalizeMessage) : [],
        contextNotice: typeof record.contextNotice === 'string' ? record.contextNotice : '',
    };
}

function readConversationFile(file, id) {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.id !== id || !Array.isArray(raw.messages)) {
        throw new Error('Invalid conversation record');
    }
    return normalizeConversation(raw);
}

function loadConversation(id) {
    if (!isValidStorageId(id)) return null;
    const file = conversationPath(id);
    if (!file) return null;
    for (const candidate of [file, file + '.bak']) {
        if (!fs.existsSync(candidate)) continue;
        try {
            const conversation = readConversationFile(candidate, id);
            if (candidate !== file) {
                conversation.recovery = {
                    recovered: true,
                    source: 'backup',
                };
            }
            return conversation;
        } catch {
            // Try the recoverable prior version when an interrupted write left the primary unreadable.
        }
    }
    return null;
}

function saveConversation(conversation) {
    const file = conversationPath(conversation.id);
    if (!file) throw new Error('Invalid conversation id');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = file + '.' + process.pid + '.' + crypto.randomUUID() + '.tmp';
    try {
        fs.writeFileSync(temporary, JSON.stringify(conversation, null, 2), 'utf8');
        if (fs.existsSync(file)) {
            // Never overwrite the recovery copy with a corrupt primary.
            try {
                readConversationFile(file, conversation.id);
                fs.copyFileSync(file, file + '.bak');
            } catch {
                // A prior readable backup, if any, remains untouched.
            }
        }
        fs.renameSync(temporary, file);
    } finally {
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
    return conversation;
}

function listConversations() {
    if (!fs.existsSync(THREADS_DIR)) return [];
    return fs.readdirSync(THREADS_DIR)
        .map(file => file.match(/^(.+)\.json(?:\.bak)?$/))
        .filter(Boolean)
        .map(match => match[1])
        .filter((id, index, ids) => ids.indexOf(id) === index)
        .map(loadConversation)
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

function setContextNotice(id, notice) {
    const conversation = loadConversation(id);
    if (!conversation) return null;
    conversation.contextNotice = String(notice || '');
    conversation.updatedAt = now();
    return saveConversation(conversation);
}

function findMessageByRequestId(conversation, requestId, role) {
    if (!conversation || !requestId) return null;
    return conversation.messages.find(message => message.requestId === requestId &&
        (!role || message.role === role)) || null;
}

function deleteConversation(id) {
    const file = conversationPath(id);
    if (!file) return false;
    const backup = file + '.bak';
    const exists = fs.existsSync(file) || fs.existsSync(backup);
    if (fs.existsSync(file)) fs.unlinkSync(file);
    if (fs.existsSync(backup)) fs.unlinkSync(backup);
    return exists;
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
    findMessageByRequestId,
    listConversations,
    loadConversation,
    renameConversation,
    setContextNotice,
};
