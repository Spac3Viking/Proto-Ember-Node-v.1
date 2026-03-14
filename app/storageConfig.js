/**
 * Ember Node v.ᚠ — Phase 5 Storage Configuration
 *
 * Separates app code from user data.
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
 *     cartridges/   — user-created cartridge metadata
 *     system/       — system state
 *     exports/      — outbound packages
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
    ensureDataRoot,
};
