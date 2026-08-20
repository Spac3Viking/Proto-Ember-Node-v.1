'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');

const DATA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-p21a2-'));
process.env.EMBER_NODE_DATA_ROOT = DATA_ROOT;

let app;
beforeAll(() => {
    jest.isolateModules(() => {
        ({ app } = require('../app/server'));
    });
    fs.mkdirSync(path.join(DATA_ROOT, 'archive', 'core'), { recursive: true });
    fs.writeFileSync(
        path.join(DATA_ROOT, 'archive', 'core', 'legacy-reader.md'),
        '# Legacy Reader Data\n\nStill readable.',
        'utf8',
    );
});

afterAll(() => {
    fs.rmSync(DATA_ROOT, { recursive: true, force: true });
    delete process.env.EMBER_NODE_DATA_ROOT;
});

describe('Phase 21A.2 manifest-driven archive reader bridge', () => {
    function readerEntryId(packageId, relativePath) {
        return Buffer.from(
            'archive-package/' + packageId + '|' + relativePath,
            'utf8',
        ).toString('base64url');
    }

    function sha256(file) {
        return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    }

    test('lists safe metadata for exactly the two trusted installed packages', async () => {
        const res = await request(app).get('/api/archive/packages/installed');

        expect(res.status).toBe(200);
        expect(res.body).toEqual({
            packages: [
                {
                    id: 'green-fire-core-cache',
                    title: 'Green Fire Core',
                    version: '1.0.0',
                    role: 'node-core',
                    indexByDefault: true,
                    documentCount: 7,
                    artifactCount: 3,
                    installed: true,
                },
                {
                    id: 'green-fire-library',
                    title: 'Green Fire Machine-Readable Library',
                    version: '2.0.0',
                    role: 'knowledge-library',
                    indexByDefault: true,
                    documentCount: 59,
                    artifactCount: 0,
                    installed: true,
                },
            ],
        });
        expect(JSON.stringify(res.body)).not.toContain(DATA_ROOT);
    });

    test('lists only manifest-declared Markdown documents from trusted installed packages', async () => {
        const res = await request(app).get('/api/archive/reader/catalog');

        expect(res.status).toBe(200);
        const packagesRoot = res.body.roots.find(root => root.id === 'archive-packages');
        expect(packagesRoot).toBeDefined();
        expect(packagesRoot.sourcePath).toBe('archive/packages');
        expect(packagesRoot.packages.map(pkg => pkg.packageId)).toEqual([
            'green-fire-core-cache',
            'green-fire-library',
        ]);

        const core = packagesRoot.packages.find(pkg => pkg.packageId === 'green-fire-core-cache');
        expect(core).toMatchObject({
            title: 'Green Fire Core',
            packageRole: 'node-core',
            sourcePath: 'archive/packages/green-fire-core-cache',
        });
        expect(core.files.some(file => file.relativePath === 'documents/packages-guide.md')).toBe(true);
        expect(core.files.some(file => file.relativePath === 'README.md')).toBe(false);
        expect(core.files).toHaveLength(7);

        const library = packagesRoot.packages.find(pkg => pkg.packageId === 'green-fire-library');
        expect(library.files).toHaveLength(59);
        expect(library.files.some(file => file.relativePath === 'content-index.json')).toBe(false);
        expect(library.files.some(file => file.relativePath === 'documents/reference/glossary.md')).toBe(true);
    });

    test('reads declared and legacy Reader documents', async () => {
        const catalog = await request(app).get('/api/archive/reader/catalog');
        const packagesRoot = catalog.body.roots.find(root => root.id === 'archive-packages');
        const core = packagesRoot.packages.find(pkg => pkg.packageId === 'green-fire-core-cache');
        const guide = core.files.find(file => file.relativePath === 'documents/packages-guide.md');

        const document = await request(app)
            .get('/api/archive/reader/document/' + encodeURIComponent(guide.entryId));
        expect(document.status).toBe(200);
        expect(document.body).toMatchObject({
            success: true,
            entryId: guide.entryId,
            sourcePath: 'archive/packages/green-fire-core-cache/documents/packages-guide.md',
            sourceLabel: 'Green Fire Core',
            contentType: 'text/markdown',
        });
        expect(document.body.content).toContain('Package');

        const legacyRoot = catalog.body.roots.find(root => root.id === 'archive-core');
        const legacy = legacyRoot.files.find(file => file.relativePath === 'legacy-reader.md');
        expect(legacy).toBeDefined();
        const legacyDocument = await request(app)
            .get('/api/archive/reader/document/' + encodeURIComponent(legacy.entryId));
        expect(legacyDocument.status).toBe(200);
        expect(legacyDocument.body.content).toContain('Still readable.');
    });

    test('rejects artifacts, undeclared paths, forged package IDs, and unsafe paths', async () => {
        const rejectedPaths = [
            readerEntryId('green-fire-core-cache', 'artifacts/level-1-what-is-green-fire.pdf'),
            readerEntryId('green-fire-library', 'README.md'),
            readerEntryId('forged-package', 'documents/packages-guide.md'),
            readerEntryId('green-fire-core-cache', '../documents/packages-guide.md'),
            readerEntryId('green-fire-core-cache', '/documents/packages-guide.md'),
            readerEntryId('green-fire-core-cache', '\\documents\\packages-guide.md'),
            readerEntryId('green-fire-core-cache', 'C:\\documents\\packages-guide.md'),
            readerEntryId('green-fire-core-cache', ''),
        ];

        for (const entryId of rejectedPaths) {
            const rejected = await request(app)
                .get('/api/archive/reader/document/' + encodeURIComponent(entryId));
            expect(rejected.status).toBe(400);
            expect(rejected.body.error).toBe('Invalid reader entry.');
        }
    });

    test('reads nested Library Markdown and manifest-declared plaintext documents', async () => {
        const nestedDocument = await request(app)
            .get('/api/archive/reader/document/' + encodeURIComponent(
                readerEntryId('green-fire-library', 'documents/reference/glossary.md'),
            ));
        expect(nestedDocument.status).toBe(200);
        expect(nestedDocument.body.contentType).toBe('text/markdown');

        const libraryDir = path.join(DATA_ROOT, 'archive', 'packages', 'green-fire-library');
        const manifestPath = path.join(libraryDir, 'manifest.json');
        const originalManifest = fs.readFileSync(manifestPath, 'utf8');
        const textPath = path.join(libraryDir, 'documents', 'reader-fixture.txt');
        try {
            const manifest = JSON.parse(originalManifest);
            manifest.documents.push('documents/reader-fixture.txt');
            fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
            fs.writeFileSync(textPath, 'Plain Reader text.', 'utf8');

            const catalog = await request(app).get('/api/archive/reader/catalog');
            const packagesRoot = catalog.body.roots.find(root => root.id === 'archive-packages');
            const library = packagesRoot.packages.find(pkg => pkg.packageId === 'green-fire-library');
            expect(library.files.some(file => file.relativePath === 'documents/reader-fixture.txt')).toBe(true);

            const textDocument = await request(app)
                .get('/api/archive/reader/document/' + encodeURIComponent(
                    readerEntryId('green-fire-library', 'documents/reader-fixture.txt'),
                ));
            expect(textDocument.status).toBe(200);
            expect(textDocument.body).toMatchObject({
                contentType: 'text/plain',
                content: 'Plain Reader text.',
            });
        } finally {
            fs.writeFileSync(manifestPath, originalManifest, 'utf8');
            fs.rmSync(textPath, { force: true });
        }
    });

    test('rejects directly constructed legacy plaintext Reader entries', async () => {
        const textPath = path.join(DATA_ROOT, 'archive', 'core', 'legacy-reader.txt');
        fs.writeFileSync(textPath, 'Legacy plaintext must not be directly readable.', 'utf8');
        try {
            const rejected = await request(app)
                .get('/api/archive/reader/document/' + encodeURIComponent(
                    Buffer.from('archive-core|legacy-reader.txt', 'utf8').toString('base64url'),
                ));
            expect(rejected.status).toBe(400);
            expect(rejected.body.error).toBe('Invalid reader entry.');
        } finally {
            fs.rmSync(textPath, { force: true });
        }
    });

    test('preserves both canonical ZIP hashes', () => {
        const root = path.resolve(__dirname, '..');
        expect(sha256(path.join(root, 'green-fire-core-cache.zip'))).toBe(
            'f8d2733050e10aa5385197d63b31eebd086a571b20e6948ec21408085958a24e',
        );
        expect(sha256(path.join(root, 'green-fire-library.zip'))).toBe(
            '8f940a20983b9451508f5df6208b17b473fb5aac6f82c10629101e6c1056b5f5',
        );
    });
});
