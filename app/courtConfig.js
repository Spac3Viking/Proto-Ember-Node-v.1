'use strict';

const fs = require('fs');
const path = require('path');
const { SYSTEM_CONFIG_DIR } = require('./storageConfig');

const BUNDLED_COURT_CONFIG_PATH = path.join(__dirname, 'court-config', 'ember-court.json');
const RUNTIME_COURT_CONFIG_PATH = path.join(SYSTEM_CONFIG_DIR, 'ember-court.json');
const DEFAULT_MEMBER_IDS = ['builder', 'warrior', 'scholar', 'scribe', 'mystic'];
const MAX_COURT_MEMBER_RETRIEVAL_TOP_K = 20;

function readJson(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return null;
    }
}

function normalizeMember(raw) {
    if (!raw || typeof raw !== 'object') return null;
    // Server-side normalization mirrors the client helper to keep persisted IDs stable.
    const id = String(raw.id || '').toLowerCase().trim().replace(/[^a-z0-9_-]/g, '');
    if (!id) return null;
    const topK = raw.retrieval && Number.isFinite(raw.retrieval.topK)
        ? Math.max(1, Math.min(MAX_COURT_MEMBER_RETRIEVAL_TOP_K, Math.floor(raw.retrieval.topK)))
        : 12;
    return {
        id,
        name: raw.name || id,
        role: raw.role || '',
        shortDescription: raw.shortDescription || '',
        primaryDomains: Array.isArray(raw.primaryDomains) ? raw.primaryDomains.map(String) : [],
        preferredSources: Array.isArray(raw.preferredSources) ? raw.preferredSources.map(String) : [],
        toneCadence: raw.toneCadence || raw.tone || '',
        retrieval: { topK },
    };
}

function normalizeCourtConfig(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const members = Array.isArray(raw.members)
        ? raw.members.map(normalizeMember).filter(Boolean)
        : [];
    // Restrict to canonical Ember Court identities to keep routing/prompt overlays stable.
    // Additional members can be enabled later by expanding DEFAULT_MEMBER_IDS intentionally.
    const filteredMembers = members.filter(m => DEFAULT_MEMBER_IDS.includes(m.id));
    if (filteredMembers.length === 0) return null;

    const defaultMember = String(raw.defaultMember || '').toLowerCase().trim();
    return {
        version: raw.version || '15.8',
        courtName: raw.courtName || 'Ember Court',
        defaultMember: filteredMembers.some(m => m.id === defaultMember)
            ? defaultMember
            : filteredMembers[0].id,
        members: filteredMembers,
    };
}

function loadBundledCourtConfig() {
    return normalizeCourtConfig(readJson(BUNDLED_COURT_CONFIG_PATH));
}

function ensureCourtConfig() {
    if (fs.existsSync(RUNTIME_COURT_CONFIG_PATH)) return;
    const bundled = loadBundledCourtConfig();
    if (!bundled) return;
    fs.mkdirSync(path.dirname(RUNTIME_COURT_CONFIG_PATH), { recursive: true });
    fs.writeFileSync(RUNTIME_COURT_CONFIG_PATH, JSON.stringify(bundled, null, 2), 'utf8');
}

function loadCourtConfig() {
    ensureCourtConfig();
    const runtime = normalizeCourtConfig(readJson(RUNTIME_COURT_CONFIG_PATH));
    if (runtime) return runtime;
    return loadBundledCourtConfig();
}

function getCourtMember(memberId) {
    const normalizedId = String(memberId || '').toLowerCase().trim();
    const config = loadCourtConfig();
    if (!config) return null;
    const match = config.members.find(m => m.id === normalizedId);
    if (match) return match;
    return config.members.find(m => m.id === config.defaultMember) || config.members[0] || null;
}

module.exports = {
    BUNDLED_COURT_CONFIG_PATH,
    RUNTIME_COURT_CONFIG_PATH,
    MAX_COURT_MEMBER_RETRIEVAL_TOP_K,
    ensureCourtConfig,
    loadCourtConfig,
    getCourtMember,
};
