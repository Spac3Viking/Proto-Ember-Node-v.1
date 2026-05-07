'use strict';

const fs = require('fs');
const path = require('path');
const { DATA_ROOT, ensureDataRoot, ensureCanonicalDataFiles } = require('../storageConfig');
const { PURGE_MANIFEST, PURGE_MODES } = require('./purgeManifest');

function _normalizeRelPath(relPath) {
    return String(relPath || '')
        .replace(/\\/g, '/')
        .replace(/^\/+/, '')
        .replace(/\/+$/, '')
        .trim();
}

function _resolveUnderDataRoot(relPath) {
    const normalized = _normalizeRelPath(relPath);
    if (!normalized) return null;
    const abs = path.resolve(DATA_ROOT, normalized);
    const root = path.resolve(DATA_ROOT);
    if (abs !== root && !abs.startsWith(root + path.sep)) return null;
    return abs;
}

function _removePathSafe(absPath) {
    if (!absPath || !fs.existsSync(absPath)) return false;
    fs.rmSync(absPath, { recursive: true, force: true });
    return true;
}

function _deleteEmptyDirIfExists(absPath) {
    if (!absPath || !fs.existsSync(absPath)) return false;
    let entries = [];
    try {
        entries = fs.readdirSync(absPath);
    } catch {
        return false;
    }
    if (entries.length > 0) return false;
    try {
        fs.rmdirSync(absPath);
        return true;
    } catch {
        return false;
    }
}

function runLegacyCleanupPass() {
    const removed = [];
    const checks = [
        'archive/legacy-caches',
        'caches-legacy',
        'indexes/tmp',
        'tmp',
        'legacy',
    ];

    for (const relPath of checks) {
        const abs = _resolveUnderDataRoot(relPath);
        if (abs && _deleteEmptyDirIfExists(abs)) {
            removed.push(relPath);
        }
    }

    const logsDir = _resolveUnderDataRoot('logs');
    if (logsDir && fs.existsSync(logsDir)) {
        let files = [];
        try {
            files = fs.readdirSync(logsDir, { withFileTypes: true });
        } catch {
            files = [];
        }
        for (const entry of files) {
            if (!entry.isFile() || !entry.name.endsWith('.log')) continue;
            const absFile = path.join(logsDir, entry.name);
            let size = 0;
            try { size = fs.statSync(absFile).size; } catch { continue; }
            if (size === 0) {
                try {
                    fs.unlinkSync(absFile);
                    removed.push('logs/' + entry.name);
                } catch { /* ignore */ }
            }
        }
        _deleteEmptyDirIfExists(logsDir);
    }

    return {
        removed,
        removedCount: removed.length,
    };
}

function purgeNodeMemory({ mode = PURGE_MODES.TEMPORARY, includeArchive = false } = {}) {
    const purgeMode = mode === PURGE_MODES.FULL ? PURGE_MODES.FULL : PURGE_MODES.TEMPORARY;
    const profile = PURGE_MANIFEST.profiles[purgeMode] || [];
    const protectedSet = new Set(PURGE_MANIFEST.protectedDefaults.map(_normalizeRelPath));
    const purgePaths = [...profile];

    if (purgeMode === PURGE_MODES.FULL && includeArchive) {
        purgePaths.push(...PURGE_MANIFEST.archiveCompleteWipePaths);
    }

    const removed = [];
    const skippedProtected = [];
    for (const relPath of purgePaths) {
        const normalized = _normalizeRelPath(relPath);
        if (!normalized) continue;
        if (protectedSet.has(normalized) && !(purgeMode === PURGE_MODES.FULL && includeArchive)) {
            skippedProtected.push(normalized);
            continue;
        }
        const abs = _resolveUnderDataRoot(normalized);
        if (!abs) continue;
        if (_removePathSafe(abs)) {
            removed.push(normalized);
        }
    }

    ensureDataRoot();
    ensureCanonicalDataFiles();

    return {
        mode: purgeMode,
        includeArchive,
        removed,
        removedCount: removed.length,
        skippedProtected,
        protectedDefaults: PURGE_MANIFEST.protectedDefaults,
    };
}

module.exports = {
    purgeNodeMemory,
    runLegacyCleanupPass,
    PURGE_MANIFEST,
    PURGE_MODES,
};
