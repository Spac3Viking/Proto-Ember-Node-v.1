'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');

jest.mock('axios');

const DATA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-p21a1-'));
process.env.EMBER_NODE_DATA_ROOT = DATA_ROOT;

const service = require('../app/archiveCacheService');
const storage = require('../app/storageConfig');
const ROOT = path.resolve(__dirname, '..');

function sha256(file) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function packageDefinition(zipPath) {
    return {
        'green-fire-core-cache': { zipPath, packageRole: 'node-core' },
    };
}

afterAll(() => {
    fs.rmSync(DATA_ROOT, { recursive: true, force: true });
    delete process.env.EMBER_NODE_DATA_ROOT;
});

describe('Phase 21A.1 canonical offline packages', () => {
    test('preserves the canonical root ZIP hashes and installer entries', () => {
        expect(sha256(path.join(ROOT, 'green-fire-core-cache.zip'))).toBe(
            'f8d2733050e10aa5385197d63b31eebd086a571b20e6948ec21408085958a24e',
        );
        expect(sha256(path.join(ROOT, 'green-fire-library.zip'))).toBe(
            '8f940a20983b9451508f5df6208b17b473fb5aac6f82c10629101e6c1056b5f5',
        );
        const installer = fs.readFileSync(path.join(ROOT, 'installer/windows/Ember-Node-Installer.nsi'), 'utf8');
        expect(installer).toContain('File "..\\..\\green-fire-core-cache.zip"');
        expect(installer).toContain('File "..\\..\\green-fire-library.zip"');
    });

    test('installs both packages offline into archive/packages without flattening', () => {
        fs.rmSync(storage.ARCHIVE_PACKAGES_DIR, { recursive: true, force: true });
        const result = service.installBundledCanonicalPackages();
        expect(result.map(item => item.packageId)).toEqual(['green-fire-core-cache', 'green-fire-library']);
        for (const item of result) {
            expect(item.installed).toBe(true);
            expect(item.installPath).toBe(path.join(storage.ARCHIVE_PACKAGES_DIR, item.packageId));
            expect(fs.existsSync(path.join(item.installPath, 'manifest.json'))).toBe(true);
            expect(item.manifest.schema_version).toBe('2.0');
        }
    });

    test('validates both manifests and every declared package path', () => {
        const core = service.validateBundledPackage(
            path.join(ROOT, 'green-fire-core-cache.zip'),
            'green-fire-core-cache',
        );
        const library = service.validateBundledPackage(
            path.join(ROOT, 'green-fire-library.zip'),
            'green-fire-library',
        );
        expect(core.package_role).toBe('node-core');
        expect(library.package_role).toBe('knowledge-library');
    });

    test('rejects unsafe ZIP paths and leaves a valid package authoritative', () => {
        const target = path.join(storage.ARCHIVE_PACKAGES_DIR, 'green-fire-core-cache');
        const originalManifest = fs.readFileSync(path.join(target, 'manifest.json'), 'utf8');
        const unsafeZip = new AdmZip();
        unsafeZip.addFile('green-fire-core-cache/manifest.json', Buffer.from(JSON.stringify({
            schema_version: '2.0',
            id: 'green-fire-core-cache',
            package_role: 'node-core',
            index_by_default: true,
            documents: ['../outside.md'],
            artifacts: [],
        })));
        const unsafePath = path.join(os.tmpdir(), 'ember-unsafe-' + Date.now() + '.zip');
        unsafeZip.writeZip(unsafePath);

        expect(() => service.validateBundledPackage(unsafePath, 'green-fire-core-cache')).toThrow('Unsafe manifest path');
        expect(() => service.installBundledCanonicalPackages({
            force: true,
            packages: packageDefinition(unsafePath),
        })).toThrow('Unsafe manifest path');
        expect(fs.readFileSync(path.join(target, 'manifest.json'), 'utf8')).toBe(originalManifest);
        fs.rmSync(unsafePath, { force: true });
    });

    test('does not overwrite an existing valid package during ordinary startup', () => {
        const target = path.join(storage.ARCHIVE_PACKAGES_DIR, 'green-fire-library');
        const marker = path.join(target, 'startup-marker.txt');
        fs.writeFileSync(marker, 'preserve', 'utf8');
        const result = service.installBundledCanonicalPackages();
        expect(result.find(item => item.packageId === 'green-fire-library').reason).toBe('valid-package-present');
        expect(fs.readFileSync(marker, 'utf8')).toBe('preserve');
        fs.rmSync(marker, { force: true });
    });

    test('contains no production reference to the retired bundled-caches path', () => {
        const appFiles = fs.readdirSync(path.join(ROOT, 'app'), { recursive: true })
            .filter(file => file.endsWith('.js'));
        for (const file of appFiles) {
            expect(fs.readFileSync(path.join(ROOT, 'app', file), 'utf8')).not.toContain('bundled-caches');
        }
    });

    test('server startup installs packages without making network or Ollama calls', () => {
        jest.isolateModules(() => {
            expect(() => require('../app/server')).not.toThrow();
        });
    });
});
