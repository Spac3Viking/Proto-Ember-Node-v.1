const fs = require('fs');
const path = require('path');

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

// Backward-compatible alias kept for existing call sites.
// TODO(phase-15-9c): remove deprecated CACHES_DIR alias after downstream migrations.
const CACHES_DIR = BUNDLED_CACHES_DIR;

/**
 * Attempts to read and parse manifest.json from a cache directory.
 * Returns the parsed object or null when the file is absent or invalid.
 *
 * @param {string} cacheDir  Absolute path to the cache directory
 * @returns {object|null}
 */
function loadManifest(cacheDir) {
    const manifestPath = path.join(cacheDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) return null;
    try {
        return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch {
        return null;
    }
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
    if (!fs.existsSync(BUNDLED_CACHES_DIR)) return [];
    return fs.readdirSync(BUNDLED_CACHES_DIR, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => {
            const manifest = loadManifest(path.join(BUNDLED_CACHES_DIR, entry.name));
            return {
                id:          entry.name,
                name:        (manifest && manifest.name)        || entry.name,
                description: (manifest && manifest.description) || '',
                version:     (manifest && manifest.version)     || '',
                type:        (manifest && manifest.type)        || '',
                // Explicit ownership tag — these caches are bundled with the app,
                // not created or owned by the user.
                ownership:   'bundled',
            };
        });
}

/**
 * Loads all readable text files (.md, .txt) inside a named cache
 * directory — including any files found inside a docs/ subdirectory —
 * and returns their combined content together with the cache name
 * and optional manifest metadata.  Returns null when the cache does
 * not exist.
 *
 * @param {string} name  Cache directory name
 * @returns {{ name: string, manifest: object|null, content: string } | null}
 */
function loadCache(name) {
    const cacheDir = path.join(BUNDLED_CACHES_DIR, name);
    if (!fs.existsSync(cacheDir)) return null;

    const manifest = loadManifest(cacheDir);

    // Collect top-level text files
    const topFiles = fs.readdirSync(cacheDir)
        .filter(f => {
            if (!f.endsWith('.md') && !f.endsWith('.txt')) return false;
            return fs.statSync(path.join(cacheDir, f)).isFile();
        })
        .sort()
        .map(f => path.join(cacheDir, f));

    // Collect files from docs/ subdirectory if present
    const docsDir   = path.join(cacheDir, 'docs');
    const docsFiles = fs.existsSync(docsDir) && fs.statSync(docsDir).isDirectory()
        ? fs.readdirSync(docsDir)
              .filter(f => f.endsWith('.md') || f.endsWith('.txt'))
              .sort()
              .map(f => path.join(docsDir, f))
        : [];

    const content = [...topFiles, ...docsFiles]
        .map(filePath => fs.readFileSync(filePath, 'utf8'))
        .join('\n\n');

    return { name, manifest, content };
}

// Deprecated compatibility aliases.
// TODO(phase-15-9c): remove after external integrations migrate to cache naming.
const listCartridges = listCaches;
const loadCartridge = loadCache;
const BUNDLED_CARTRIDGES_DIR = BUNDLED_CACHES_DIR;
const CARTRIDGES_DIR = CACHES_DIR;

module.exports = {
    listCaches,
    loadCache,
    BUNDLED_CACHES_DIR,
    CACHES_DIR,
    listCartridges,
    loadCartridge,
    BUNDLED_CARTRIDGES_DIR,
    CARTRIDGES_DIR,
};
