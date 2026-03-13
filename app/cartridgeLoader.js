const fs = require('fs');
const path = require('path');

const CARTRIDGES_DIR = path.join(__dirname, '..', 'cartridges');

/**
 * Attempts to read and parse manifest.json from a cartridge directory.
 * Returns the parsed object or null when the file is absent or invalid.
 *
 * @param {string} cartridgeDir  Absolute path to the cartridge directory
 * @returns {object|null}
 */
function loadManifest(cartridgeDir) {
    const manifestPath = path.join(cartridgeDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) return null;
    try {
        return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch {
        return null;
    }
}

/**
 * Returns a list of cartridge summary objects found in the cartridges
 * directory.  Each entry includes the directory name and, when available,
 * the fields from manifest.json.  Returns an empty array when the
 * directory does not exist or is empty.
 *
 * @returns {Array<{ id: string, name: string, description: string, version: string, type: string }>}
 */
function listCartridges() {
    if (!fs.existsSync(CARTRIDGES_DIR)) return [];
    return fs.readdirSync(CARTRIDGES_DIR, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => {
            const manifest = loadManifest(path.join(CARTRIDGES_DIR, entry.name));
            return {
                id: entry.name,
                name: (manifest && manifest.name) || entry.name,
                description: (manifest && manifest.description) || '',
                version: (manifest && manifest.version) || '',
                type: (manifest && manifest.type) || '',
            };
        });
}

/**
 * Loads all readable text files (.md, .txt) inside a named cartridge
 * directory — including any files found inside a docs/ subdirectory —
 * and returns their combined content together with the cartridge name
 * and optional manifest metadata.  Returns null when the cartridge does
 * not exist.
 *
 * @param {string} name  Cartridge directory name
 * @returns {{ name: string, manifest: object|null, content: string } | null}
 */
function loadCartridge(name) {
    const cartridgeDir = path.join(CARTRIDGES_DIR, name);
    if (!fs.existsSync(cartridgeDir)) return null;

    const manifest = loadManifest(cartridgeDir);

    // Collect top-level text files
    const topFiles = fs.readdirSync(cartridgeDir)
        .filter(f => {
            if (!f.endsWith('.md') && !f.endsWith('.txt')) return false;
            return fs.statSync(path.join(cartridgeDir, f)).isFile();
        })
        .sort()
        .map(f => path.join(cartridgeDir, f));

    // Collect files from docs/ subdirectory if present
    const docsDir   = path.join(cartridgeDir, 'docs');
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

module.exports = { listCartridges, loadCartridge, CARTRIDGES_DIR };
