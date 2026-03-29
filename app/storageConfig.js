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
 *     hearth/                  — curated Hearth sources (remembered knowledge)
 *       remembered-threads/    — durable thread memory objects
 *       maps/                  — Hearth working & remembered context maps
 *     workshop/                — Workshop notes and active drafts
 *       maps/                  — Workshop context maps
 *     threshold/               — quarantined imports awaiting inspection
 *       maps/                  — Threshold context maps
 *     archive/                 — Trusted Archive (privileged curated path)
 *       core/                  — Default trusted archive (Green Fire Core)
 *         codices/             — Green Fire Codices
 *         grimoires/           — Green Fire Grimoires
 *         sagas/               — Green Fire Sagas
 *         reference/           — Reference materials
 *       caches/                — Future downloadable archive expansions
 *       cartridges/            — Future modular functional/content modules
 *       literature/            — curated literary sources (legacy shelf)
 *       history/               — curated historical sources (legacy shelf)
 *       science/               — curated scientific sources (legacy shelf)
 *       green-fire/            — Green Fire primary texts (legacy shelf)
 *     indexes/                 — local knowledge index (chunks, embeddings, manifests)
 *     projects/                — Workshop project files
 *     threads/                 — chat thread records
 *     cartridges/              — user-created cartridge metadata (NOT bundled cartridges)
 *     system/                  — system state
 *     exports/                 — outbound packages
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
const DOCUMENTS_DIR       = path.join(DATA_ROOT, 'documents');

// ── Phase 11: Context Architecture ───────────────────────────────────────────

/** Trusted Archive root — privileged curated path, bypasses Threshold workflow */
const ARCHIVE_DIR             = path.join(DATA_ROOT, 'archive');

// ── Phase 11.5: Forge + Bootstrap ────────────────────────────────────────────

/** Forge identity layer directory (system identity — not archive content) */
const FORGE_DIR               = path.join(SYSTEM_DIR, 'forge');

/** Archetype overlays directory (Ember Court) */
const ARCHETYPES_DIR          = path.join(FORGE_DIR, 'archetypes');

/** Active Bootstrap storage directory */
const BOOTSTRAP_DIR           = path.join(SYSTEM_DIR, 'bootstrap');

/** System config, prompts, and tools directories */
const SYSTEM_CONFIG_DIR       = path.join(SYSTEM_DIR, 'config');
const SYSTEM_PROMPTS_DIR      = path.join(SYSTEM_DIR, 'prompts');
const SYSTEM_TOOLS_DIR        = path.join(SYSTEM_DIR, 'tools');

// ── Phase 11.7: Core Archive + Cache Structure ────────────────────────────────

/**
 * Core trusted archive — default knowledge body for every new node.
 * Content here is trusted, archive-native, and bypasses Threshold by default.
 */
const ARCHIVE_CORE_DIR        = path.join(ARCHIVE_DIR, 'core');

/** Subdirectories within the Core Trusted Archive */
const ARCHIVE_CORE_DIRS = {
    codices:   path.join(ARCHIVE_CORE_DIR, 'codices'),
    grimoires: path.join(ARCHIVE_CORE_DIR, 'grimoires'),
    sagas:     path.join(ARCHIVE_CORE_DIR, 'sagas'),
    reference: path.join(ARCHIVE_CORE_DIR, 'reference'),
};

/**
 * Downloadable archive expansions (caches).
 * Each cache is a self-contained sub-directory with its own manifest.json.
 * Use the term "cache" / "caches" — not "pack" / "packs".
 */
const ARCHIVE_CACHES_DIR      = path.join(ARCHIVE_DIR, 'caches');

/**
 * Modular functional/content cartridges.
 * Distinct from caches — may contain documents, prompts, assets, or
 * specialized node modules.
 */
const ARCHIVE_CARTRIDGES_DIR  = path.join(ARCHIVE_DIR, 'cartridges');

/**
 * Subdirectories within the Trusted Archive (legacy flat shelf layout).
 * Kept for backward compatibility with Phase 11 routes and ingestion.
 * Core Green Fire content now lives under ARCHIVE_CORE_DIRS.
 */
const ARCHIVE_DIRS = {
    codices:      ARCHIVE_CORE_DIRS.codices,
    grimoires:    ARCHIVE_CORE_DIRS.grimoires,
    sagas:        ARCHIVE_CORE_DIRS.sagas,
    reference:    ARCHIVE_CORE_DIRS.reference,
    literature:   path.join(ARCHIVE_DIR, 'literature'),
    history:      path.join(ARCHIVE_DIR, 'history'),
    science:      path.join(ARCHIVE_DIR, 'science'),
    'green-fire': path.join(ARCHIVE_DIR, 'green-fire'),
};

/** Room-partitioned thread sub-directories */
const THREADS_ROOM_DIRS = {
    hearth:    path.join(DATA_ROOT, 'threads', 'hearth'),
    workshop:  path.join(DATA_ROOT, 'threads', 'workshop'),
    threshold: path.join(DATA_ROOT, 'threads', 'threshold'),
};

/** Hearth sub-directories for Phase 11 features */
const HEARTH_REMEMBERED_THREADS_DIR = path.join(ROOM_DIRS.hearth, 'remembered-threads');
const HEARTH_MAPS_DIR               = path.join(ROOM_DIRS.hearth, 'maps');

/** Context map directories for each room */
const MAPS_DIRS = {
    hearth:    HEARTH_MAPS_DIR,
    workshop:  path.join(ROOM_DIRS.workshop, 'maps'),
    threshold: path.join(ROOM_DIRS.threshold, 'maps'),
};

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
        DOCUMENTS_DIR,
        // Phase 11: Trusted Archive
        ARCHIVE_DIR,
        ...Object.values(ARCHIVE_DIRS),
        // Phase 11: Hearth memory dirs
        HEARTH_REMEMBERED_THREADS_DIR,
        // Phase 11: Context map dirs
        MAPS_DIRS.hearth,
        MAPS_DIRS.workshop,
        MAPS_DIRS.threshold,
        // Phase 11.5: Forge + Bootstrap
        FORGE_DIR,
        ARCHETYPES_DIR,
        BOOTSTRAP_DIR,
        // Phase 11.7: Core Archive + Cache Structure
        ARCHIVE_CORE_DIR,
        ARCHIVE_CACHES_DIR,
        ARCHIVE_CARTRIDGES_DIR,
        SYSTEM_CONFIG_DIR,
        SYSTEM_PROMPTS_DIR,
        SYSTEM_TOOLS_DIR,
        THREADS_ROOM_DIRS.hearth,
        THREADS_ROOM_DIRS.workshop,
        THREADS_ROOM_DIRS.threshold,
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

// ── Path resolution helper ────────────────────────────────────────────────────

/**
 * Resolve a stored source path to an absolute filesystem path.
 *
 * Handles two formats:
 *   New (storage-root-relative): 'workshop/file.md'  → <DATA_ROOT>/workshop/file.md
 *   Legacy (app-root-relative):  'data/workshop/file.md' → <DATA_ROOT>/workshop/file.md
 *
 * The legacy format was used by older Ember Node versions that stored data
 * inside the app folder.  The data/ prefix is stripped so both formats
 * resolve correctly against the external data root after migration.
 *
 * @param {string} storedPath
 * @returns {string|null}
 */
function resolveSourcePath(storedPath) {
    if (!storedPath) return null;
    const normalized = storedPath.replace(/^data[\\/]/, '');
    return path.join(DATA_ROOT, normalized);
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
    DOCUMENTS_DIR,
    LEGACY_DATA_DIR,
    // Phase 11
    ARCHIVE_DIR,
    ARCHIVE_DIRS,
    HEARTH_REMEMBERED_THREADS_DIR,
    HEARTH_MAPS_DIR,
    MAPS_DIRS,
    // Phase 11.5
    FORGE_DIR,
    ARCHETYPES_DIR,
    BOOTSTRAP_DIR,
    // Phase 11.7: Core Archive + Cache Structure
    ARCHIVE_CORE_DIR,
    ARCHIVE_CORE_DIRS,
    ARCHIVE_CACHES_DIR,
    ARCHIVE_CARTRIDGES_DIR,
    SYSTEM_CONFIG_DIR,
    SYSTEM_PROMPTS_DIR,
    SYSTEM_TOOLS_DIR,
    THREADS_ROOM_DIRS,
    ensureDataRoot,
    migrateLegacyData,
    resolveSourcePath,
};
