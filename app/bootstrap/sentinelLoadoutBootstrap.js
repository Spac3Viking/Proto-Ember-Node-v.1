'use strict';

const fs = require('fs');
const path = require('path');
const { BOOTSTRAP_DIR } = require('../storageConfig');
const { loadRollingBootstrap } = require('../bootstrap');
const { listLoadedCaches } = require('../loadedCaches');
const { getRecentCacheInteractions, getCacheInteractionSummary } = require('../cacheInteractionMemory');

const SENTINEL_LOADOUT_FILENAME = 'sentinel-loadout-bootstrap.md';
const SENTINEL_LOADOUT_PATH = path.join(BOOTSTRAP_DIR, SENTINEL_LOADOUT_FILENAME);
const MAX_SUMMARY_CHARS = 420;
const MAX_RETRIEVAL_POSTURE_CHARS = 220;
const MAX_STEWARD_NOTE_CHARS = 220;
const MAX_PROMPT_SUMMARY_LINES = 12;

const ARCHETYPE_ORDER = ['builder', 'warrior', 'scholar', 'scribe', 'mystic'];
const ARCHETYPE_RUNES = {
    builder: 'ᛒ',
    warrior: 'ᛏ',
    scholar: 'ᚨ',
    scribe: 'ᚲ',
    mystic: 'ᛇ',
};
const ARCHETYPE_LABELS = {
    builder: 'Builder',
    warrior: 'Warrior',
    scholar: 'Scholar',
    scribe: 'Scribe',
    mystic: 'Mystic',
};
const RESPONSE_DISCIPLINE = {
    spark: 'Brief orientation only.',
    ember: 'Balanced synthesis.',
    hearth: 'Deeper continuity teaching.',
    archive: 'Broad continuity weave.',
};

function compactText(value, maxChars) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    if (text.length <= maxChars) return text;
    if (maxChars <= 3) return text.slice(0, Math.max(0, maxChars));
    return text.slice(0, Math.max(0, maxChars - 3)).trimEnd() + '...';
}

function normalizeDepth(value) {
    const depth = String(value || '').trim().toLowerCase();
    return ['spark', 'ember', 'hearth', 'archive'].includes(depth) ? depth : 'ember';
}

function extractCacheLine(cache) {
    if (!cache || typeof cache !== 'object') return '';
    const title = String(cache.title || cache.id || '').trim();
    if (!title) return '';
    const level = String(cache.level || 'spark').trim().toLowerCase();
    return '- ' + title + ' [' + level + ']';
}

function inferArchetypeBalance(activeArchetype, themes) {
    const normalizedThemes = Array.isArray(themes) ? themes.map(item => String(item || '').toLowerCase()) : [];
    return ARCHETYPE_ORDER.map(id => {
        let emphasis = 'Support posture.';
        if (id === activeArchetype) {
            emphasis = 'Primary continuity lens.';
        } else if (normalizedThemes.some(theme =>
            (id === 'builder' && /(build|system|repair|craft)/.test(theme)) ||
            (id === 'warrior' && /(pressure|risk|survival|discipline)/.test(theme)) ||
            (id === 'scholar' && /(study|theory|concept|framework)/.test(theme)) ||
            (id === 'scribe' && /(write|narrative|transmit|story)/.test(theme)) ||
            (id === 'mystic' && /(symbol|myth|ritual|threshold)/.test(theme))
        )) {
            emphasis = 'Elevated support.';
        }
        return `${ARCHETYPE_RUNES[id]} ${ARCHETYPE_LABELS[id]}: ${emphasis}`;
    });
}

function getStewardNotes(rollingBootstrap) {
    if (Array.isArray(rollingBootstrap?.steward_notes) && rollingBootstrap.steward_notes.length > 0) {
        return rollingBootstrap.steward_notes
            .slice(0, 2)
            .map(note => compactText(note, MAX_STEWARD_NOTE_CHARS))
            .filter(Boolean);
    }
    const memorySummary = compactText(getCacheInteractionSummary({ limit: 2 }), MAX_STEWARD_NOTE_CHARS);
    if (memorySummary) return [memorySummary];
    return [];
}

function buildSentinelLoadoutBootstrapMarkdown(opts = {}) {
    const rollingBootstrap = opts.rollingBootstrap || loadRollingBootstrap() || {};
    const loadedCaches = Array.isArray(rollingBootstrap.loaded_caches) && rollingBootstrap.loaded_caches.length > 0
        ? rollingBootstrap.loaded_caches
        : listLoadedCaches().slice(0, 8);
    const summary = compactText(rollingBootstrap.summary || '', MAX_SUMMARY_CHARS)
        || 'Continuity profile is standing by. Ignite loadout after refresh for fuller posture.';
    const activeArchetypeRaw = String(rollingBootstrap?.node_state?.active_archetype || '').toLowerCase();
    const activeArchetype = ARCHETYPE_ORDER.includes(activeArchetypeRaw) ? activeArchetypeRaw : '';
    const responseDepth = normalizeDepth(rollingBootstrap?.node_state?.response_depth || 'ember');
    const recentCacheEncounters = Array.isArray(rollingBootstrap.recent_cache_encounters) &&
        rollingBootstrap.recent_cache_encounters.length > 0
        ? rollingBootstrap.recent_cache_encounters.slice(0, 5).map(item => String(item))
        : getRecentCacheInteractions(5)
            .map(entry => entry.cacheId || entry.draftId || entry.bootstrapPath || null)
            .filter(Boolean)
            .map(String)
            .slice(0, 5);
    const activeThemes = Array.isArray(rollingBootstrap.active_themes)
        ? rollingBootstrap.active_themes.map(item => String(item)).filter(Boolean).slice(0, 5)
        : [];
    const retrievalPosture = compactText(
        rollingBootstrap?.cache_memory?.summary ||
            'Balanced retrieval with preference for loaded caches and recent continuity interactions.',
        MAX_RETRIEVAL_POSTURE_CHARS,
    );
    const stewardNotes = getStewardNotes(rollingBootstrap);
    const createdAt = new Date().toISOString();
    const archetypeBalance = inferArchetypeBalance(activeArchetype, activeThemes);

    return [
        '---',
        'title: Sentinel Loadout Bootstrap',
        'type: bootstrap',
        'source: ember-node',
        'status: local',
        'created: ' + createdAt,
        '---',
        '# Sentinel Loadout Bootstrap',
        '## Current Purpose',
        summary,
        '',
        '## Active Archetype Balance',
        ...archetypeBalance,
        '',
        '## Cache Loadout',
        ...(loadedCaches.length > 0
            ? loadedCaches.map(extractCacheLine).filter(Boolean).slice(0, 8)
            : ['- none loaded']),
        '',
        '## Response Discipline',
        'Spark: ' + RESPONSE_DISCIPLINE.spark,
        'Ember: ' + RESPONSE_DISCIPLINE.ember,
        'Hearth: ' + RESPONSE_DISCIPLINE.hearth,
        'Archive: ' + RESPONSE_DISCIPLINE.archive,
        '- Active response depth: ' + responseDepth,
        '',
        '## Retrieval Posture',
        retrievalPosture,
        '',
        '## Active Themes',
        ...(activeThemes.length > 0 ? activeThemes.slice(0, 5).map(theme => '- ' + theme) : ['- none']),
        '',
        '## Continuity Posture',
        '- Rolling summary: ' + summary,
        ...(recentCacheEncounters.length > 0
            ? ['- Recent cache encounters: ' + recentCacheEncounters.join(', ')]
            : ['- Recent cache encounters: none recorded']),
        '',
        '## Steward Notes',
        ...(stewardNotes.length > 0 ? stewardNotes.map(note => '- ' + note) : ['- none']),
        '',
        '## External AI Instructions',
        'Use this bootstrap as a compact continuity profile.',
        'Favor markdown responses and continuity preservation.',
        'Respond as a mentor-guide, not an oracle.',
        '',
        '## Avoid',
        '- unnecessary exposition',
        '- broad archive sweeps at Spark depth',
        '- overloading runtime context',
        '',
    ].join('\n');
}

function writeSentinelLoadoutBootstrap(opts = {}) {
    const markdown = buildSentinelLoadoutBootstrapMarkdown(opts);
    fs.mkdirSync(BOOTSTRAP_DIR, { recursive: true });
    fs.writeFileSync(SENTINEL_LOADOUT_PATH, markdown, 'utf8');
    return {
        path: 'system/bootstrap/' + SENTINEL_LOADOUT_FILENAME,
        markdown,
    };
}

function loadSentinelLoadoutBootstrapMarkdown() {
    if (!fs.existsSync(SENTINEL_LOADOUT_PATH)) return null;
    try {
        return fs.readFileSync(SENTINEL_LOADOUT_PATH, 'utf8');
    } catch {
        return null;
    }
}

function stripFrontmatter(markdown) {
    const text = String(markdown || '');
    if (!text.startsWith('---')) return text;
    const endIdx = text.indexOf('\n---', 3);
    if (endIdx < 0) return text;
    const bodyStart = text.indexOf('\n', endIdx + 4);
    return bodyStart >= 0 ? text.slice(bodyStart + 1) : '';
}

function loadSentinelLoadoutPromptSummary(maxChars = 320) {
    const markdown = loadSentinelLoadoutBootstrapMarkdown();
    if (!markdown) return '';
    const body = stripFrontmatter(markdown);
    const focusLines = body
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'))
        .slice(0, MAX_PROMPT_SUMMARY_LINES)
        .join(' ');
    return compactText(focusLines, Math.max(80, Math.floor(maxChars)));
}

module.exports = {
    SENTINEL_LOADOUT_FILENAME,
    SENTINEL_LOADOUT_PATH,
    buildSentinelLoadoutBootstrapMarkdown,
    writeSentinelLoadoutBootstrap,
    loadSentinelLoadoutBootstrapMarkdown,
    loadSentinelLoadoutPromptSummary,
};
