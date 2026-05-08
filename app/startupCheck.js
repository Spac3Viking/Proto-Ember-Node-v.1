'use strict';

/**
 * Ember Node v.ᚠ — Startup Check
 *
 * Single source of truth for launch summary generation.
 * Gathers system state and returns a structured startup summary object.
 */

const fs   = require('fs');
const path = require('path');
const { DATA_ROOT } = require('./storageConfig');
const { loadManifests } = require('./indexStore');
const { loadIntakeState } = require('./intakeState');

// ── File detection constants ──────────────────────────────────────────────────

const DETECT_SUPPORTED_EXTS = new Set(['.txt', '.md', '.pdf', '.docx']);
const DETECT_IGNORE_FILES   = new Set(['.gitkeep', '.DS_Store', 'Thumbs.db']);

// ── File triage ───────────────────────────────────────────────────────────────

/**
 * Classify a file by its extension for basic triage.
 * Returns a category string and a boolean indicating whether to flag the file.
 *
 * @param {string} filename
 * @returns {{ category: string, flag: boolean }}
 */
function triageFile(filename) {
    const ext = path.extname(filename).toLowerCase();
    const TEXT_DOCS = new Set(['.txt', '.md', '.pdf', '.docx', '.doc', '.odt', '.rtf', '.csv']);
    const ARCHIVES  = new Set(['.zip', '.tar', '.gz', '.bz2', '.7z', '.rar', '.tgz']);
    const SCRIPTS   = new Set(['.sh', '.bat', '.cmd', '.ps1', '.bash', '.zsh', '.fish', '.py', '.js', '.rb', '.pl']);
    const BINARIES  = new Set(['.exe', '.dll', '.so', '.dylib', '.bin', '.app', '.deb', '.rpm']);

    if (TEXT_DOCS.has(ext))  return { category: 'document', flag: false };
    if (ARCHIVES.has(ext))   return { category: 'archive',  flag: true  };
    if (SCRIPTS.has(ext))    return { category: 'script',   flag: true  };
    if (BINARIES.has(ext))   return { category: 'binary',   flag: true  };
    return { category: 'unknown', flag: true };
}

// ── Changed-file summary ──────────────────────────────────────────────────────

/**
 * Collect changed files by comparing mtime against ingestTimestamp.
 * Reusable helper for the startup check and other summaries.
 *
 * @param {object} manifests
 * @returns {{ changed: object[] }}
 */
function getChangedFilesSummary(manifests) {
    const changed = [];
    const monitoredPrefixes = ['threshold/inbox/', 'archive/core/', 'archive/caches/'];
    Object.values(manifests).forEach(manifest => {
        const relPath = String(manifest.path || '').replace(/\\/g, '/');
        if (!manifest.ingestTimestamp || !relPath) return;
        if (!monitoredPrefixes.some(prefix => relPath.startsWith(prefix))) return;
        const ext = path.extname(relPath).toLowerCase();
        if (!DETECT_SUPPORTED_EXTS.has(ext)) return;
        const absPath = path.resolve(DATA_ROOT, relPath);
        if (!fs.existsSync(absPath)) return;
        let stats;
        try { stats = fs.statSync(absPath); } catch { return; }
        const ingestMs = new Date(manifest.ingestTimestamp).getTime();
        const mtimeMs  = stats.mtime.getTime();
        if (mtimeMs > ingestMs + 2000) {
            changed.push({
                filename: path.basename(relPath),
                path: relPath,
                room: relPath.startsWith('threshold/inbox/') ? 'threshold' : 'archive',
                sourceId: manifest.id,
            });
        }
    });

    return { changed };
}

// ── Startup summary ───────────────────────────────────────────────────────────

/**
 * Generate the structured startup summary for /api/startup-check.
 *
 * @param {{ performed: boolean }} migrationResult  Result of migrateLegacyData()
 * @returns {object}  Startup summary object
 */
function generateStartupCheck(migrationResult) {
    const manifests = loadManifests();
    const intakeState = loadIntakeState();

    // File counts — Threshold intake states
    const allSources   = Object.values(manifests);
    const thFiles      = allSources.filter(m => m.room === 'threshold');
    const waitingFiles = thFiles.filter(m => !m.status || m.status === 'waiting').length;
    const flaggedFiles = thFiles.filter(m => m.status === 'flagged').length;

    // Changed files
    const { changed } = getChangedFilesSummary(manifests);
    const changedFiles = changed.length;

    // Runtime stewardship counts from persisted Threshold intake decisions.
    const runtimeEntries = Object.values((intakeState && intakeState.tools) || {});
    const trustedRuntimeEntries = runtimeEntries.filter(t => t.state === 'trusted');
    const trustedTools = trustedRuntimeEntries.length;
    const newTools = runtimeEntries.filter(t => t.state === 'inspected').length;
    const runningTools = 0;
    const offlineTools = 0;
    const activeHeartAvailable = trustedTools > 0;

    // Migration state
    const migrationState = (migrationResult && migrationResult.performed) ? 'migrated' : 'none';

    // Warnings
    const warnings = [];
    if (runtimeEntries.length > 0 && runningTools === 0) {
        warnings.push('No running local AI runtimes detected');
    }

    return {
        waitingFiles,
        changedFiles,
        flaggedFiles,
        newTools,
        trustedTools,
        runningTools,
        offlineTools,
        activeHeart:           trustedRuntimeEntries[0] ? trustedRuntimeEntries[0].id || null : null,
        activeHeartAvailable,
        migrationState,
        warnings,
        lastScan:              new Date().toISOString(),
    };
}

module.exports = {
    triageFile,
    getChangedFilesSummary,
    generateStartupCheck,
    DETECT_SUPPORTED_EXTS,
    DETECT_IGNORE_FILES,
};
