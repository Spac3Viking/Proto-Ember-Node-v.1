const fs = require('fs');
const path = require('path');

const CARTRIDGES_DIR = path.join(__dirname, '..', 'cartridges');

/**
 * Returns a list of cartridge names (subdirectory names) found in the
 * cartridges directory.  Returns an empty array when the directory does
 * not exist or is empty.
 */
function listCartridges() {
    if (!fs.existsSync(CARTRIDGES_DIR)) return [];
    return fs.readdirSync(CARTRIDGES_DIR, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name);
}

/**
 * Loads all readable text files (.md, .txt) inside a named cartridge
 * directory and returns their combined content together with the
 * cartridge name.  Returns null when the cartridge does not exist.
 *
 * @param {string} name  Cartridge directory name
 * @returns {{ name: string, content: string } | null}
 */
function loadCartridge(name) {
    const cartridgeDir = path.join(CARTRIDGES_DIR, name);
    if (!fs.existsSync(cartridgeDir)) return null;

    const files = fs.readdirSync(cartridgeDir)
        .filter(f => f.endsWith('.md') || f.endsWith('.txt'))
        .sort();

    const content = files
        .map(file => fs.readFileSync(path.join(cartridgeDir, file), 'utf8'))
        .join('\n\n');

    return { name, content };
}

module.exports = { listCartridges, loadCartridge, CARTRIDGES_DIR };
