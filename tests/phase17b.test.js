'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const AdmZip = require('adm-zip');

jest.mock('axios');

describe('Phase 17B — Canonical Cache Package Structure', () => {
    let dataRoot;
    let axiosMock;

    beforeEach(() => {
        jest.resetModules();
        axiosMock = require('axios');
        axiosMock.get.mockReset();
        axiosMock.post.mockReset();
        axiosMock.post.mockRejectedValue(new Error('offline'));
        dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-phase17b-test-'));
        process.env.EMBER_NODE_DATA_ROOT = dataRoot;
        delete process.env.EMBER_DATA_ROOT;
    });

    afterEach(() => {
        delete process.env.EMBER_NODE_DATA_ROOT;
        delete process.env.EMBER_DATA_ROOT;
        try { fs.rmSync(dataRoot, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    test('non-core install enforces continuity and artifact cache layers', async () => {
        const { app } = require('../app/server');
        const sc = require('../app/storageConfig');
        const { ARCHIVE_ENDPOINTS } = require('../app/archiveCacheService');

        const cacheZip = new AdmZip();
        cacheZip.addFile('green-fire-codices-cache/manifest.json', Buffer.from(JSON.stringify({
            id: 'green-fire-codices-cache',
            version: '2.1.0',
            type: 'archive-cache',
        })));
        cacheZip.addFile('green-fire-codices-cache/README.md', Buffer.from('# Codices Continuity'));
        cacheZip.addFile('green-fire-codices-cache/documents/bootstrap.md', Buffer.from('# Bootstrap'));
        cacheZip.addFile('green-fire-codices-cache/scans/source.pdf', Buffer.from('pdf-bytes'));
        const zipBuffer = cacheZip.toBuffer();

        axiosMock.get.mockImplementation((url) => {
            if (url === ARCHIVE_ENDPOINTS.downloadsIndex) {
                return Promise.resolve({
                    data: {
                        packages: [
                            {
                                id: 'green-fire-codices-cache',
                                version: '2.1.0',
                                downloadUrl: 'https://greenfire-archive.replit.app/downloads/green-fire-codices-cache.zip',
                            },
                        ],
                    },
                });
            }
            if (url === 'https://greenfire-archive.replit.app/downloads/green-fire-codices-cache.zip') {
                return Promise.resolve({ data: zipBuffer });
            }
            return Promise.reject(new Error('unexpected url: ' + url));
        });

        const installRes = await request(app)
            .post('/api/archive/caches/install')
            .send({ packageId: 'green-fire-codices-cache' });

        expect(installRes.status).toBe(200);
        expect(fs.existsSync(path.join(sc.ARCHIVE_CACHES_DIR, 'green-fire-codices-cache', 'continuity'))).toBe(true);
        expect(fs.existsSync(path.join(sc.ARCHIVE_CACHES_DIR, 'green-fire-codices-cache', 'artifacts'))).toBe(true);
        expect(fs.existsSync(path.join(sc.ARCHIVE_CACHES_DIR, 'green-fire-codices-cache', 'continuity', 'README.md'))).toBe(true);
        expect(fs.existsSync(path.join(sc.ARCHIVE_CACHES_DIR, 'green-fire-codices-cache', 'continuity', 'bootstrap.md'))).toBe(true);
        expect(fs.existsSync(path.join(sc.ARCHIVE_CACHES_DIR, 'green-fire-codices-cache', 'artifacts', 'source.pdf'))).toBe(true);
    });

    test('archive cache detection is continuity-first by default', () => {
        const sc = require('../app/storageConfig');
        sc.ensureDataRoot();

        const cacheRoot = path.join(sc.ARCHIVE_CACHES_DIR, 'green-fire-gallery-cache');
        fs.mkdirSync(path.join(cacheRoot, 'continuity'), { recursive: true });
        fs.mkdirSync(path.join(cacheRoot, 'artifacts', 'reference'), { recursive: true });
        fs.writeFileSync(path.join(cacheRoot, 'manifest.json'), JSON.stringify({ id: 'green-fire-gallery-cache' }), 'utf8');
        fs.writeFileSync(path.join(cacheRoot, 'continuity', 'summary.md'), '# continuity', 'utf8');
        fs.writeFileSync(path.join(cacheRoot, 'artifacts', 'reference', 'reference.pdf'), 'pdf', 'utf8');

        const { detectArchiveFiles } = require('../app/archiveService');
        const defaultFiles = detectArchiveFiles();
        const withArtifacts = detectArchiveFiles({ includeArtifacts: true });

        const defaultPaths = defaultFiles
            .filter(row => row.shelf === 'green-fire-gallery-cache')
            .map(row => row.filePath);
        const artifactPaths = withArtifacts
            .filter(row => row.shelf === 'green-fire-gallery-cache')
            .map(row => row.filePath);

        expect(defaultPaths.some(p => p.endsWith(path.join('continuity', 'summary.md')))).toBe(true);
        expect(defaultPaths.some(p => p.endsWith(path.join('artifacts', 'reference', 'reference.pdf')))).toBe(false);
        expect(artifactPaths.some(p => p.endsWith(path.join('artifacts', 'reference', 'reference.pdf')))).toBe(true);
    });
});
