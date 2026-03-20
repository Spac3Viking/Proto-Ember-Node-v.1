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
const { loadToolRegistry } = require('./toolRegistry');

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
    const byPath = {};
    Object.values(manifests).forEach(m => {
        if (m.path) byPath[m.path.replace(/\\/g, '/')] = m;
    });

    const changed = [];

    for (const room of ['threshold', 'workshop', 'hearth']) {
        const roomDir = path.join(DATA_ROOT, room);
        if (!fs.existsSync(roomDir)) continue;

        let entries;
        try { entries = fs.readdirSync(roomDir, { withFileTypes: true }); }
        catch { continue; }

        for (const entry of entries) {
            if (!entry.isFile()) continue;
            if (DETECT_IGNORE_FILES.has(entry.name)) continue;
            const ext = path.extname(entry.name).toLowerCase();
            if (!DETECT_SUPPORTED_EXTS.has(ext)) continue;

            const relPath = room + '/' + entry.name;
            const absPath = path.join(roomDir, entry.name);
            let stats;
            try { stats = fs.statSync(absPath); }
            catch { continue; }

            const manifest = byPath[relPath];
            if (!manifest || !manifest.ingestTimestamp) continue;

            const ingestMs = new Date(manifest.ingestTimestamp).getTime();
            const mtimeMs  = stats.mtime.getTime();
            if (mtimeMs > ingestMs + 2000) {
                changed.push({ filename: entry.name, path: relPath, room, sourceId: manifest.id });
            }
        }
    }

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
    const registry  = loadToolRegistry();

    // File counts — Threshold intake states
    const allSources   = Object.values(manifests);
    const thFiles      = allSources.filter(m => m.room === 'threshold');
    const waitingFiles = thFiles.filter(m => !m.status || m.status === 'waiting').length;
    const flaggedFiles = thFiles.filter(m => m.status === 'flagged').length;

    // Changed files
    const { changed } = getChangedFilesSummary(manifests);
    const changedFiles = changed.length;

    // Tool counts
    const tools        = registry.tools || [];
    const trustedTools = tools.filter(t => t.trusted).length;
    const runningTools = tools.filter(t => t.running === true).length;
    const offlineTools = tools.filter(t => t.trusted && t.running === false).length;
    const newTools     = tools.filter(t => t.status === 'detected' && !t.trusted).length;

    // Active Heart
    const heartId              = registry.active && registry.active.heart;
    const heartTool            = heartId ? tools.find(t => t.id === heartId) : null;
    const activeHeartAvailable = heartTool ? (heartTool.running === true) : false;

    // Migration state
    const migrationState = (migrationResult && migrationResult.performed) ? 'migrated' : 'none';

    // Warnings
    const warnings = [];
    if (heartId && heartTool && !activeHeartAvailable) {
        warnings.push('Active Heart "' + (heartTool.name || heartId) + '" is offline');
    }
    if (tools.length > 0 && runningTools === 0) {
        warnings.push('No running tools detected');
    }

    return {
        waitingFiles,
        changedFiles,
        flaggedFiles,
        newTools,
        trustedTools,
        runningTools,
        offlineTools,
        activeHeart:           heartId || null,
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
