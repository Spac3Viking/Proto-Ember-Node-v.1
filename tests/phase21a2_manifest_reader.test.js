'use strict';

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
});

afterAll(() => {
    fs.rmSync(DATA_ROOT, { recursive: true, force: true });
    delete process.env.EMBER_NODE_DATA_ROOT;
});

describe('Phase 21A.2 manifest-driven archive reader bridge', () => {
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

        const library = packagesRoot.packages.find(pkg => pkg.packageId === 'green-fire-library');
        expect(library.files.some(file => file.relativePath === 'content-index.json')).toBe(false);
        expect(library.files.some(file => file.relativePath === 'documents/reference/glossary.md')).toBe(true);
    });

    test('reads a declared package document and rejects undeclared package paths', async () => {
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

        const undeclaredEntryId = Buffer.from(
            'archive-package/green-fire-library|README.md',
            'utf8',
        ).toString('base64url');
        const rejected = await request(app)
            .get('/api/archive/reader/document/' + encodeURIComponent(undeclaredEntryId));
        expect(rejected.status).toBe(400);
        expect(rejected.body.error).toBe('Invalid reader entry.');
    });
});
