/**
 * Ember Node v.ᚠ — Phase 11 Thread Memory
 *
 * Provides durable summarized memory objects for Hearth remembered threads.
 *
 * Raw thread JSON is preserved unchanged.  When a thread is "remembered",
 * a lightweight summary object is generated and stored under:
 *
 *   DATA_ROOT/hearth/remembered-threads/<threadId>.json
 *
 * These summaries become part of Hearth's long-term continuity and are
 * included in the Hearth context map.
 *
 * Summary schema:
 *   {
 *     id,           — source thread ID
 *     title,        — thread title
 *     rememberedAt, — ISO timestamp
 *     updatedAt,    — ISO timestamp
 *     themes,       — string[]  (extracted from messages)
 *     keyInsights,  — string[]
 *     messageCount,
 *     firstMessage, — truncated first user message
 *     lastMessage,  — truncated last user message
 *     excerpt,      — first ~300 chars of thread text
 *   }
 */

'use strict';

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

const { HEARTH_REMEMBERED_THREADS_DIR } = require('./storageConfig');

/** Maximum character length for stored text excerpts */
const EXCERPT_MAX_LENGTH = 300;

/** Maximum character length for first/last message snapshots */
const MESSAGE_SNAPSHOT_LENGTH = 120;

/**
 * Path to the remembered-thread summary file for a given thread ID.
 *
 * @param {string} threadId
 * @returns {string}
 */
function summaryPath(threadId) {
    // Sanitise the ID to avoid path traversal
    const safe = threadId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(HEARTH_REMEMBERED_THREADS_DIR, safe + '.json');
}

/**
 * Load a remembered-thread summary from disk.
 * Returns null if it does not exist or is unreadable.
 *
 * @param {string} threadId
 * @returns {object|null}
 */
function loadThreadSummary(threadId) {
    const file = summaryPath(threadId);
    if (!fs.existsSync(file)) return null;
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { return null; }
}

/**
 * Save a remembered-thread summary to disk.
 *
 * @param {object} summary
 */
function saveThreadSummary(summary) {
    if (!fs.existsSync(HEARTH_REMEMBERED_THREADS_DIR)) {
        fs.mkdirSync(HEARTH_REMEMBERED_THREADS_DIR, { recursive: true });
    }
    fs.writeFileSync(summaryPath(summary.id), JSON.stringify(summary, null, 2), 'utf8');
}

/**
 * Delete a remembered-thread summary from disk.
 *
 * @param {string} threadId
 */
function deleteThreadSummary(threadId) {
    const file = summaryPath(threadId);
    if (fs.existsSync(file)) {
        try { fs.unlinkSync(file); } catch { /* ignore */ }
    }
}

/**
 * List all remembered-thread summaries.
 *
 * @returns {object[]}
 */
function listThreadSummaries() {
    if (!fs.existsSync(HEARTH_REMEMBERED_THREADS_DIR)) return [];
    return fs.readdirSync(HEARTH_REMEMBERED_THREADS_DIR)
        .filter(f => f.endsWith('.json'))
        .map(f => {
            try {
                return JSON.parse(fs.readFileSync(path.join(HEARTH_REMEMBERED_THREADS_DIR, f), 'utf8'));
            } catch { return null; }
        })
        .filter(Boolean)
        .sort((a, b) => (b.rememberedAt || '').localeCompare(a.rememberedAt || ''));
}

/**
 * Extract simple themes from message content.
 * A lightweight heuristic: collect the most common significant words.
 *
 * @param {string} text
 * @returns {string[]}
 */
function extractThemes(text) {
    if (!text) return [];
    const STOPWORDS = new Set([
        'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
        'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'be',
        'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
        'would', 'could', 'should', 'may', 'might', 'it', 'its', 'this', 'that',
        'these', 'those', 'i', 'you', 'we', 'they', 'he', 'she', 'what', 'when',
        'where', 'who', 'how', 'why', 'if', 'not', 'no', 'so', 'than', 'then',
        'can', 'about', 'up', 'out', 'into', 'my', 'your', 'our', 'their',
    ]);

    const words = text.toLowerCase()
        .replace(/[^a-z\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 4 && !STOPWORDS.has(w));

    const freq = {};
    for (const w of words) {
        freq[w] = (freq[w] || 0) + 1;
    }

    return Object.entries(freq)
        .filter(([, count]) => count >= 2)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([w]) => w);
}

/**
 * Generate a remembered-thread summary from a raw thread object.
 *
 * @param {object} thread  Raw thread record (from THREADS_DIR)
 * @returns {object}       Summary object
 */
function generateThreadSummary(thread) {
    const messages  = thread.messages || [];
    const userMsgs  = messages.filter(m => m.role === 'user');
    const allText   = messages.map(m => m.content || '').join(' ');

    const firstUserMsg = userMsgs[0]  ? userMsgs[0].content  : '';
    const lastUserMsg  = userMsgs[userMsgs.length - 1]
        ? userMsgs[userMsgs.length - 1].content
        : firstUserMsg;

    const existing = loadThreadSummary(thread.id);
    const now      = new Date().toISOString();

    return {
        id:           thread.id,
        title:        thread.title || 'Untitled Thread',
        rememberedAt: existing ? existing.rememberedAt : now,
        updatedAt:    now,
        themes:       extractThemes(allText),
        keyInsights:  [],   // placeholder — future: LLM-generated
        messageCount: messages.length,
        firstMessage: firstUserMsg.slice(0, MESSAGE_SNAPSHOT_LENGTH),
        lastMessage:  lastUserMsg.slice(0, MESSAGE_SNAPSHOT_LENGTH),
        excerpt:      allText.slice(0, EXCERPT_MAX_LENGTH),
    };
}

/**
 * Create or update the persistent memory object for a thread.
 *
 * @param {object} thread  Raw thread record
 * @returns {object}       The saved summary
 */
function rememberThread(thread) {
    const summary = generateThreadSummary(thread);
    saveThreadSummary(summary);
    return summary;
}

module.exports = {
    loadThreadSummary,
    saveThreadSummary,
    deleteThreadSummary,
    listThreadSummaries,
    generateThreadSummary,
    rememberThread,
};
