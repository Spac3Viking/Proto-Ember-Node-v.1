const fs = require('fs');
const path = require('path');
const { normalizeCacheManifestMetadata } = require('./loadedCaches');
const CACHE_ID_PATTERN = /^[a-zA-Z0-9._-]+$/;

/**
 * Bundled caches — shipped with the app code.
 *
 * These are starter reference packs, example modules, and built-in seeds.
 * They live inside the app folder and may change when the app is updated.
 * They are NOT user-owned and should not be treated as part of the user archive.
 *
 * Contrast with user caches, which live under USER_CACHES_DIR in the
 * external data root and travel with the archive across machines.
 */
const BUNDLED_CACHES_DIR = path.join(__dirname, '..', 'caches');

function isPathInside(baseDir, targetPath) {
    const normalize = (value) => {
        const resolved = path.resolve(value);
        return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    };
    const root = normalize(baseDir);
    const target = normalize(targetPath);
    if (target === root) return true;
    const rel = path.relative(root, target);
    return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function safeJoinInside(baseDir, ...parts) {
    const candidate = path.resolve(baseDir, ...parts);
    if (!isPathInside(baseDir, candidate)) return null;
    return candidate;
}

/**
 * Attempts to read and parse manifest.json from a cache directory.
 * Returns the parsed object or null when the file is absent or invalid.
 *
 * @param {string} cacheDir  Absolute path to the cache directory
 * @returns {object|null}
 */
function loadManifest(cacheDir) {
    if (!cacheDir || !isPathInside(BUNDLED_CACHES_DIR, cacheDir)) return null;
    const manifestPath = safeJoinInside(cacheDir, 'manifest.json');
    if (!manifestPath) return null;
    if (!fs.existsSync(manifestPath)) return null;
    try {
        return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch {
        return null;
    }
}

function resolveBundledCacheDir(name) {
    const cacheName = typeof name === 'string' ? name.trim() : '';
    if (!cacheName || !CACHE_ID_PATTERN.test(cacheName)) return null;
    const cacheDirById = buildCacheDirectoryIndex();
    return cacheDirById[cacheName] || null;
}

function buildCacheDirectoryIndex() {
    if (!fs.existsSync(BUNDLED_CACHES_DIR)) return {};
    return fs.readdirSync(BUNDLED_CACHES_DIR, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && CACHE_ID_PATTERN.test(entry.name))
        .reduce((acc, entry) => {
            const abs = safeJoinInside(BUNDLED_CACHES_DIR, entry.name);
            if (abs) acc[entry.name] = abs;
            return acc;
        }, {});
}

/**
 * Returns a list of cache summary objects found in the bundled caches
 * directory.  Each entry includes the directory name and, when available,
 * the fields from manifest.json.  Returns an empty array when the
 * directory does not exist or is empty.
 *
 * All entries carry `ownership: 'bundled'` to distinguish them from
 * user-created caches that live in the external data root.
 *
 * @returns {Array<{ id: string, name: string, description: string, version: string, type: string, ownership: string }>}
 */
function listCaches() {
    const cacheDirById = buildCacheDirectoryIndex();
    return Object.entries(cacheDirById)
        .map(([cacheId, cacheDir]) => {
            if (!cacheDir) return null;
            const manifest = loadManifest(cacheDir);
            const cacheMeta = normalizeCacheManifestMetadata(manifest || {});
            return {
                id:          cacheId,
                name:        (manifest && manifest.name)        || cacheId,
                description: (manifest && manifest.description) || '',
                version:     (manifest && manifest.version)     || '',
                type:        (manifest && manifest.type)        || '',
                level:       cacheMeta.level,
                status:      cacheMeta.status,
                scope:       cacheMeta.scope,
                derived_from: cacheMeta.derived_from,
                distilled_into: cacheMeta.distilled_into,
                continuity_themes: cacheMeta.continuity_themes,
                signal_density: cacheMeta.signal_density,
                loaded:      cacheMeta.loaded,
                // Explicit ownership tag — these caches are bundled with the app,
                // not created or owned by the user.
                ownership:   'bundled',
            };
        })
        .filter(Boolean);
}

/**
 * Loads all readable text files (.md, .txt) inside a named cache
 * directory — including any files found inside a documents/ subdirectory —
 * and returns their combined content together with the cache name
 * and optional manifest metadata.  Returns null when the cache does
 * not exist.
 *
 * @param {string} name  Cache directory name
 * @returns {{ name: string, manifest: object|null, content: string } | null}
 */
function loadCache(name) {
    const cacheDir = resolveBundledCacheDir(name);
    if (!cacheDir || !fs.existsSync(cacheDir)) return null;

    const manifest = loadManifest(cacheDir);

    // Collect top-level text files
    const topFiles = fs.readdirSync(cacheDir)
        .filter(f => {
            if (!CACHE_ID_PATTERN.test(f.replace(/\.(md|txt)$/i, ''))) return false;
            if (!f.endsWith('.md') && !f.endsWith('.txt')) return false;
            const abs = safeJoinInside(cacheDir, f);
            if (!abs) return false;
            return fs.statSync(abs).isFile();
        })
        .sort()
        .map(f => safeJoinInside(cacheDir, f))
        .filter(Boolean);

    // Collect files from documents/ subdirectory if present
    const documentsDir   = safeJoinInside(cacheDir, 'documents');
    const documentsFiles = documentsDir && fs.existsSync(documentsDir) && fs.statSync(documentsDir).isDirectory()
        ? fs.readdirSync(documentsDir)
              .filter(f => (f.endsWith('.md') || f.endsWith('.txt')) &&
                  CACHE_ID_PATTERN.test(f.replace(/\.(md|txt)$/i, '')))
              .sort()
              .map(f => safeJoinInside(documentsDir, f))
              .filter(Boolean)
        : [];

    const content = [...topFiles, ...documentsFiles]
        .map(filePath => {
            if (!isPathInside(cacheDir, filePath)) return '';
            return fs.readFileSync(filePath, 'utf8');
        })
        .join('\n\n');

    return { name, manifest, content };
}

module.exports = {
    listCaches,
    loadCache,
    BUNDLED_CACHES_DIR,
    resolveBundledCacheDir,
};
