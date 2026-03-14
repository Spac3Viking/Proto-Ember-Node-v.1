/**
 * Ember Node v.ᚠ — Phase 5 Storage Configuration
 *
 * Separates app code from user data.
 *
 * Portability model
 * -----------------
 * All user-owned content lives under DATA_ROOT — a single directory the user
 * controls.  The app code is entirely separate.  To move an archive between
 * machines:
 *   1. Copy the DATA_ROOT directory tree to the new machine.
 *   2. Install (or update) Ember Node there.
 *   3. Point EMBER_DATA_ROOT at the copied directory and start the server.
 * No app code or bundled assets need to travel with the archive.
 *
 * The data root is resolved in this priority order:
 *   1. EMBER_DATA_ROOT environment variable (set by user or wrapper script)
 *   2. OS-appropriate default in the user's home directory
 *
 * Default locations:
 *   Linux / macOS   →  ~/.ember-node
 *   Windows         →  C:\Users\<username>\.ember-node
 *
 * Data root layout:
 *   <data-root>/
 *     hearth/       — curated Hearth sources (remembered knowledge)
 *     workshop/     — Workshop notes and active drafts
 *     threshold/    — quarantined imports awaiting inspection
 *     indexes/      — local knowledge index (chunks, embeddings, manifests)
 *     projects/     — Workshop project files
 *     threads/      — chat thread records
 *     cartridges/   — user-created cartridge metadata (NOT bundled cartridges)
 *     system/       — system state
 *     exports/      — outbound packages
 *
 * Legacy migration
 * ----------------
 * Older Ember Node versions stored data in a data/ subdirectory inside the app
 * folder.  On startup, migrateLegacyData() detects that layout and copies the
 * contents into the external data root so users do not lose their archive when
 * updating.  Migration is copy-based, non-destructive, and idempotent.
 */

'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

// ── Resolve data root ─────────────────────────────────────────────────────────

/**
 * Absolute path to the active data root.
 * Override with the EMBER_DATA_ROOT environment variable.
 */
const DATA_ROOT = process.env.EMBER_DATA_ROOT
    ? path.resolve(process.env.EMBER_DATA_ROOT)
    : path.join(os.homedir(), '.ember-node');

// ── Subdirectory paths ────────────────────────────────────────────────────────

const ROOM_DIRS = {
    hearth:    path.join(DATA_ROOT, 'hearth'),
    workshop:  path.join(DATA_ROOT, 'workshop'),
    threshold: path.join(DATA_ROOT, 'threshold'),
};

const INDEXES_DIR         = path.join(DATA_ROOT, 'indexes');
const PROJECTS_DIR        = path.join(DATA_ROOT, 'projects');
const THREADS_DIR         = path.join(DATA_ROOT, 'threads');
const USER_CARTRIDGES_DIR = path.join(DATA_ROOT, 'cartridges');
const SYSTEM_DIR          = path.join(DATA_ROOT, 'system');
const EXPORTS_DIR         = path.join(DATA_ROOT, 'exports');

// Placeholder files that should not be treated as real user content
const IGNORE_FILES = new Set(['.gitkeep', '.DS_Store']);

/**
 * Path to the in-project data/ folder used by older Ember Node versions.
 * This directory co-located user data with app code, which the current
 * architecture deliberately separates.
 */
const LEGACY_DATA_DIR = path.join(__dirname, '..', 'data');

// ── First-run initialisation ──────────────────────────────────────────────────

/**
 * Ensure the full data root directory tree exists.
 * Safe to call multiple times — only creates directories that are missing.
 * Called automatically at server startup.
 */
function ensureDataRoot() {
    const dirs = [
        DATA_ROOT,
        ROOM_DIRS.hearth,
        ROOM_DIRS.workshop,
        ROOM_DIRS.threshold,
        INDEXES_DIR,
        PROJECTS_DIR,
        THREADS_DIR,
        USER_CARTRIDGES_DIR,
        SYSTEM_DIR,
        EXPORTS_DIR,
    ];
    for (const dir of dirs) {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }
}

// ── Legacy migration ──────────────────────────────────────────────────────────

/**
 * Recursively copy a directory tree from src to dest.
 * - Creates missing destination directories.
 * - Skips .gitkeep and .DS_Store placeholders.
 * - Never overwrites existing files (non-destructive).
 *
 * @param {string} src
 * @param {string} dest
 */
function copyDirSafe(src, dest) {
    if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
    }
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
        if (IGNORE_FILES.has(entry.name)) continue;
        const srcPath  = path.join(src,  entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDirSafe(srcPath, destPath);
        } else if (entry.isFile() && !fs.existsSync(destPath)) {
            // Non-destructive: do not overwrite files already in the data root
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

/**
 * Check whether a directory contains any real user content
 * (ignores .gitkeep, .DS_Store, and empty subdirectories).
 *
 * @param {string} dir
 * @returns {boolean}
 */
function dirHasContent(dir) {
    if (!fs.existsSync(dir)) return false;
    let entries;
    try {
        entries = fs.readdirSync(dir).filter(f => !IGNORE_FILES.has(f));
    } catch {
        return false;
    }
    for (const entry of entries) {
        const full = path.join(dir, entry);
        try {
            const stat = fs.statSync(full);
            if (stat.isFile()) return true;
            if (stat.isDirectory() && dirHasContent(full)) return true;
        } catch { /* ignore stat errors */ }
    }
    return false;
}

/**
 * Safe, idempotent, copy-based migration from the legacy in-project data/
 * folder to the current external storage root.
 *
 * Migration is skipped when:
 *   - The legacy data/ directory does not exist
 *   - The legacy directory contains only placeholder files (.gitkeep)
 *   - The data root already has real content (avoids destructive overwrites)
 *
 * @param {string} [legacyDir]  Override the legacy source directory (for tests)
 * @returns {{ detected: boolean, performed: boolean, mode: string, errors: string[] }}
 */
function migrateLegacyData(legacyDir) {
    const srcDir = legacyDir || LEGACY_DATA_DIR;
    const result = { detected: false, performed: false, mode: 'skipped', errors: [] };

    // Step 1: Does the legacy data/ folder exist with real content?
    if (!dirHasContent(srcDir)) return result;

    result.detected = true;

    // Step 2: Does the data root already have content? If so, skip to avoid overwrites.
    if (dirHasContent(DATA_ROOT)) {
        console.log('[migration] Data root already has content — skipping legacy migration.');
        return result;
    }

    // Step 3: Copy legacy data into the data root (non-destructive).
    result.mode = 'copy';
    console.log('[migration] Legacy data/ detected. Copying to ' + DATA_ROOT + ' ...');

    try {
        copyDirSafe(srcDir, DATA_ROOT);
        result.performed = true;
        console.log('[migration] Legacy data migration complete.');
    } catch (e) {
        result.errors.push('Migration failed: ' + e.message);
        console.error('[migration] Error during migration:', e.message);
    }

    return result;
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
    DATA_ROOT,
    ROOM_DIRS,
    INDEXES_DIR,
    PROJECTS_DIR,
    THREADS_DIR,
    USER_CARTRIDGES_DIR,
    SYSTEM_DIR,
    EXPORTS_DIR,
    LEGACY_DATA_DIR,
    ensureDataRoot,
    migrateLegacyData,
};
