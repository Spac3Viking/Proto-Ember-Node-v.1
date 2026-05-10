'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { CACHE_INTERACTIONS_PATH } = require('./storageConfig');

const MAX_INTERACTIONS = 200;

const KNOWN_KINDS = new Set([
    'cache_draft_created',
    'cache_draft_exported',
    'cache_draft_installed',
    'threshold_handoff_viewed',
]);

function defaultMemory() {
    return {
        version: '0.1.0',
        updated_at: null,
        interactions: [],
    };
}

function readMemory() {
    if (!fs.existsSync(CACHE_INTERACTIONS_PATH)) return defaultMemory();
    try {
        const parsed = JSON.parse(fs.readFileSync(CACHE_INTERACTIONS_PATH, 'utf8'));
        const base = defaultMemory();
        const interactions = Array.isArray(parsed && parsed.interactions)
            ? parsed.interactions
            : [];
        return {
            version: parsed && parsed.version ? String(parsed.version) : base.version,
            updated_at: parsed && parsed.updated_at ? String(parsed.updated_at) : null,
            interactions,
        };
    } catch {
        return defaultMemory();
    }
}

function writeMemory(memory) {
    fs.mkdirSync(path.dirname(CACHE_INTERACTIONS_PATH), { recursive: true });
    fs.writeFileSync(CACHE_INTERACTIONS_PATH, JSON.stringify(memory, null, 2), 'utf8');
}

function normalizePaths(sourcePaths) {
    if (!Array.isArray(sourcePaths)) return [];
    const seen = new Set();
    const out = [];
    for (const value of sourcePaths) {
        const pathText = String(value || '').trim().replace(/\\/g, '/');
        if (!pathText || seen.has(pathText)) continue;
        seen.add(pathText);
        out.push(pathText);
    }
    return out.slice(0, 16);
}

function normalizeInteraction(input) {
    const kind = String(input && input.kind || '').trim().toLowerCase();
    if (!KNOWN_KINDS.has(kind)) return null;
    const now = new Date().toISOString();
    return {
        id: input && input.id ? String(input.id) : crypto.randomUUID(),
        kind,
        at: input && input.at ? String(input.at) : now,
        draftId: input && input.draftId ? String(input.draftId).trim() : null,
        cacheId: input && input.cacheId ? String(input.cacheId).trim() : null,
        sourcePaths: normalizePaths(input && input.sourcePaths),
        handoffType: input && input.handoffType ? String(input.handoffType).trim() : null,
        handoffStatus: input && input.handoffStatus ? String(input.handoffStatus).trim() : null,
    };
}

function summarizeInteraction(interaction) {
    if (!interaction || !interaction.kind) return '';
    if (interaction.kind === 'cache_draft_created') {
        return 'Created cache draft `' + (interaction.draftId || 'unknown') + '`.';
    }
    if (interaction.kind === 'cache_draft_exported') {
        return 'Exported cache draft `' + (interaction.draftId || 'unknown') + '`.';
    }
    if (interaction.kind === 'cache_draft_installed') {
        return 'Installed cache `' + (interaction.cacheId || interaction.draftId || 'unknown') + '` into archive.';
    }
    if (interaction.kind === 'threshold_handoff_viewed') {
        const type = interaction.handoffType || 'handoff';
        return 'Viewed threshold handoff (`' + type + '`).';
    }
    return '';
}

function recordCacheInteraction(input) {
    const normalized = normalizeInteraction(input);
    if (!normalized) return null;
    const memory = readMemory();
    const interactions = Array.isArray(memory.interactions) ? memory.interactions.slice() : [];
    interactions.unshift(normalized);
    memory.interactions = interactions.slice(0, MAX_INTERACTIONS);
    memory.updated_at = new Date().toISOString();
    writeMemory(memory);
    return normalized;
}

function getRecentCacheInteractions(limit = 8) {
    const memory = readMemory();
    const interactions = Array.isArray(memory.interactions) ? memory.interactions : [];
    const cap = Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 32) : 8;
    return interactions.slice(0, cap).map(item => normalizeInteraction(item)).filter(Boolean);
}

function getCacheInteractionSummary(opts) {
    const options = opts || {};
    const limit = Number.isFinite(options.limit) ? options.limit : 4;
    const parts = getRecentCacheInteractions(limit)
        .map(summarizeInteraction)
        .filter(Boolean);
    return parts.join(' ');
}

module.exports = {
    recordCacheInteraction,
    getRecentCacheInteractions,
    getCacheInteractionSummary,
};
