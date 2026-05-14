'use strict';

const request = require('supertest');
const fs      = require('fs');
const path    = require('path');
const os      = require('os');
const axios   = require('axios');
const AdmZip  = require('adm-zip');

jest.mock('axios');

const DATA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-p12-'));
process.env.EMBER_NODE_DATA_ROOT = DATA_ROOT;
delete process.env.EMBER_DATA_ROOT;

const { app } = require('../app/server');
const sc      = require('../app/storageConfig');
const {
    ARCHIVE_ENDPOINTS,
    ARCHIVE_CACHE_INDEX_FILE,
    ARCHIVE_CACHE_REGISTRY_FILE,
    BUNDLED_CORE_CACHE_FILE,
    installBundledCoreCache,
} = require('../app/archiveCacheService');

const BUNDLED_CORE_CACHE_DIR = path.dirname(BUNDLED_CORE_CACHE_FILE);
let originalBundledCoreCache = null;

afterAll(() => {
    delete process.env.EMBER_NODE_DATA_ROOT;
    delete process.env.EMBER_DATA_ROOT;
    try { fs.rmSync(DATA_ROOT, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
    axios.get.mockReset();
    axios.post.mockReset();
    axios.post.mockRejectedValue(new Error('offline'));
    fs.mkdirSync(BUNDLED_CORE_CACHE_DIR, { recursive: true });
    if (originalBundledCoreCache === null && fs.existsSync(BUNDLED_CORE_CACHE_FILE)) {
        originalBundledCoreCache = fs.readFileSync(BUNDLED_CORE_CACHE_FILE);
    }
});

afterEach(() => {
    if (originalBundledCoreCache) {
        fs.writeFileSync(BUNDLED_CORE_CACHE_FILE, originalBundledCoreCache);
        return;
    }
    try { fs.rmSync(BUNDLED_CORE_CACHE_FILE, { force: true }); } catch { /* File may not exist */ }
});

describe('Phase 12 — Green Fire Archive cache integration', () => {
    test('GET /api/archive/caches/available returns canonical packages from downloads index', async () => {
        axios.get.mockResolvedValue({
            data: {
                packages: [
                    { id: 'green-fire-core', version: '1.1.0', downloadUrl: '/downloads/green-fire-core.zip' },
                    { id: 'green-fire-codices-cache', version: '1.2.0', download_url: '/downloads/green-fire-codices-cache.zip' },
                    { id: 'not-canonical', version: '99.0.0', downloadUrl: '/downloads/not-canonical.zip' },
                ],
            },
        });

        const res = await request(app).get('/api/archive/caches/available');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.source).toBe('upstream');
        expect(Array.isArray(res.body.packages)).toBe(true);
        expect(res.body.packages.map(p => p.packageId)).toEqual([
            'green-fire-core',
            'green-fire-codices-cache',
        ]);
        expect(res.body.endpoints.downloadsIndex).toBe(ARCHIVE_ENDPOINTS.downloadsIndex);
    });

    test('POST /api/archive/caches/install installs green-fire-core into archive/core and parses manifest', async () => {
        const coreZip = new AdmZip();
        coreZip.addFile('archive/core/manifest.json', Buffer.from(JSON.stringify({
            id: 'green-fire-core',
            version: '2.0.0',
            type: 'core-archive',
        })));
        coreZip.addFile('archive/core/codices/forge.md', Buffer.from('# Loadout Forge Core'));
        const coreZipBuffer = coreZip.toBuffer();

        axios.get.mockImplementation((url, options) => {
            if (url === ARCHIVE_ENDPOINTS.downloadsIndex) {
                return Promise.resolve({
                    data: {
                        packages: [
                            { id: 'green-fire-core', version: '2.0.0', downloadUrl: 'https://greenfire-archive.replit.app/downloads/green-fire-core.zip' },
                        ],
                    },
                });
            }
            if (url === 'https://greenfire-archive.replit.app/downloads/green-fire-core.zip') {
                expect(options.responseType).toBe('arraybuffer');
                return Promise.resolve({ data: coreZipBuffer });
            }
            return Promise.reject(new Error('unexpected url: ' + url));
        });

        const res = await request(app)
            .post('/api/archive/caches/install')
            .send({ packageId: 'green-fire-core' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.installed.packageId).toBe('green-fire-core');
        expect(res.body.installed.installPath).toBe(sc.ARCHIVE_CORE_DIR);
        expect(res.body.installed.manifest.id).toBe('green-fire-core');
        expect(res.body.installed.manifest.version).toBe('2.0.0');
        expect(fs.existsSync(path.join(sc.ARCHIVE_CORE_DIR, 'codices', 'forge.md'))).toBe(true);
    });

    test('POST /api/archive/caches/install installs non-core cache into archive/caches/<id>', async () => {
        const cacheZip = new AdmZip();
        cacheZip.addFile('green-fire-codices-cache/manifest.json', Buffer.from(JSON.stringify({
            id: 'green-fire-codices-cache',
            version: '1.5.0',
            type: 'archive-cache',
        })));
        cacheZip.addFile('green-fire-codices-cache/documents/codex.md', Buffer.from('# Codex Cache'));
        cacheZip.addFile('green-fire-codices-cache/assets/original.pdf', Buffer.from('PDF bytes'));
        const cacheZipBuffer = cacheZip.toBuffer();

        axios.get.mockImplementation((url, options) => {
            if (url === ARCHIVE_ENDPOINTS.downloadsIndex) {
                return Promise.resolve({
                    data: {
                        packages: [
                            {
                                id: 'green-fire-codices-cache',
                                version: '1.5.0',
                                downloadUrl: 'https://greenfire-archive.replit.app/downloads/green-fire-codices-cache.zip',
                            },
                        ],
                    },
                });
            }
            if (url === 'https://greenfire-archive.replit.app/downloads/green-fire-codices-cache.zip') {
                expect(options.responseType).toBe('arraybuffer');
                return Promise.resolve({ data: cacheZipBuffer });
            }
            return Promise.reject(new Error('unexpected url: ' + url));
        });

        const installRes = await request(app)
            .post('/api/archive/caches/install')
            .send({ packageId: 'green-fire-codices-cache' });

        expect(installRes.status).toBe(200);
        expect(installRes.body.installed.packageId).toBe('green-fire-codices-cache');
        expect(installRes.body.installed.manifest.version).toBe('1.5.0');

        const continuityFile = path.join(sc.ARCHIVE_CACHES_DIR, 'green-fire-codices-cache', 'continuity', 'codex.md');
        const artifactFile = path.join(sc.ARCHIVE_CACHES_DIR, 'green-fire-codices-cache', 'artifacts', 'original.pdf');
        expect(fs.existsSync(continuityFile)).toBe(true);
        expect(fs.existsSync(artifactFile)).toBe(true);

        const listRes = await request(app).get('/api/archive/caches/installed');
        expect(listRes.status).toBe(200);
        const codices = listRes.body.caches.find(c => c.packageId === 'green-fire-codices-cache');
        expect(codices).toBeDefined();
        expect(codices.installed).toBe(true);
        expect(codices.version).toBe('1.5.0');
    });

    test('GET /api/archive/caches/updates compares local and upstream versions', async () => {
        const localCacheDir = path.join(sc.ARCHIVE_CACHES_DIR, 'green-fire-codices-cache');
        fs.mkdirSync(localCacheDir, { recursive: true });
        fs.writeFileSync(
            path.join(localCacheDir, 'manifest.json'),
            JSON.stringify({ id: 'green-fire-codices-cache', version: '1.0.0' }, null, 2),
            'utf8',
        );

        axios.get.mockResolvedValue({
            data: {
                packages: [
                    { id: 'green-fire-codices-cache', version: '1.2.0', downloadUrl: '/downloads/green-fire-codices-cache.zip' },
                    { id: 'green-fire-core', version: '1.0.0', downloadUrl: '/downloads/green-fire-core.zip' },
                ],
            },
        });

        const res = await request(app).get('/api/archive/caches/updates');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);

        const codices = res.body.comparison.find(c => c.packageId === 'green-fire-codices-cache');
        expect(codices.installed).toBe(true);
        expect(codices.localVersion).toBe('1.0.0');
        expect(codices.upstreamVersion).toBe('1.2.0');
        expect(codices.status).toBe('update-available');
    });

    test('available index falls back to local cached metadata when upstream is offline', async () => {
        axios.get.mockResolvedValueOnce({
            data: {
                packages: [
                    { id: 'green-fire-gallery-cache', version: '1.0.0', downloadUrl: '/downloads/green-fire-gallery-cache.zip' },
                ],
            },
        });

        const first = await request(app).get('/api/archive/caches/available');
        expect(first.status).toBe(200);
        expect(first.body.source).toBe('upstream');
        expect(fs.existsSync(ARCHIVE_CACHE_INDEX_FILE)).toBe(true);

        axios.get.mockRejectedValueOnce(new Error('network offline'));
        const second = await request(app).get('/api/archive/caches/available');
        expect(second.status).toBe(200);
        expect(second.body.source).toBe('local-cache');
        expect(second.body.offline).toBe(true);
        expect(second.body.packages[0].packageId).toBe('green-fire-gallery-cache');
    });

    test('cache install updates persistent cache registry and registry API', async () => {
        const cacheZip = new AdmZip();
        cacheZip.addFile('green-fire-gallery-cache/manifest.json', Buffer.from(JSON.stringify({
            id: 'green-fire-gallery-cache',
            version: '3.1.0',
            type: 'archive-cache',
        })));
        cacheZip.addFile('green-fire-gallery-cache/documents/gallery.md', Buffer.from('# Gallery Cache'));
        const cacheZipBuffer = cacheZip.toBuffer();

        axios.get.mockImplementation((url) => {
            if (url === ARCHIVE_ENDPOINTS.downloadsIndex) {
                return Promise.resolve({
                    data: {
                        packages: [
                            {
                                id: 'green-fire-gallery-cache',
                                title: 'Green Fire Gallery Cache',
                                version: '3.1.0',
                                downloadUrl: 'https://greenfire-archive.replit.app/downloads/green-fire-gallery-cache.zip',
                            },
                        ],
                    },
                });
            }
            if (url === 'https://greenfire-archive.replit.app/downloads/green-fire-gallery-cache.zip') {
                return Promise.resolve({ data: cacheZipBuffer });
            }
            return Promise.reject(new Error('unexpected url: ' + url));
        });

        const installRes = await request(app)
            .post('/api/archive/caches/install')
            .send({ packageId: 'green-fire-gallery-cache' });

        expect(installRes.status).toBe(200);
        expect(installRes.body.installed.registry).toBeDefined();
        expect(fs.existsSync(ARCHIVE_CACHE_REGISTRY_FILE)).toBe(true);

        const regRes = await request(app).get('/api/archive/caches/registry');
        expect(regRes.status).toBe(200);
        expect(regRes.body.success).toBe(true);
        expect(regRes.body.registry.caches['green-fire-gallery-cache']).toBeDefined();
        expect(regRes.body.registry.caches['green-fire-gallery-cache'].installedVersion).toBe('3.1.0');
    });

    test('archive signal and resources endpoints return expected payload', async () => {
        axios.get.mockImplementation((url) => {
            if (url === ARCHIVE_ENDPOINTS.signal) {
                return Promise.resolve({
                    data: {
                        dispatch: 'Attend to the ember.',
                        question: 'What are you forging today?',
                    },
                });
            }
            return Promise.reject(new Error('unexpected url: ' + url));
        });

        const signalRes = await request(app).get('/api/archive/signal');
        expect(signalRes.status).toBe(200);
        expect(signalRes.body.success).toBe(true);
        expect(signalRes.body.payload.dispatch).toBe('Attend to the ember.');
        expect(signalRes.body.payload.question).toBe('What are you forging today?');
        expect(signalRes.body.endpoint).toBe(ARCHIVE_ENDPOINTS.signal);

        const resourceRes = await request(app).get('/api/archive/resources');
        expect(resourceRes.status).toBe(200);
        expect(resourceRes.body.success).toBe(true);
        expect(resourceRes.body.endpoints.forgeMd).toBe(ARCHIVE_ENDPOINTS.forgeMd);
        expect(resourceRes.body.endpoints.mythicSeedMd).toBe(ARCHIVE_ENDPOINTS.mythicSeedMd);
    });

    test('installBundledCoreCache installs local bundled core zip without network', () => {
        fs.rmSync(sc.ARCHIVE_CORE_DIR, { recursive: true, force: true });

        const bundledZip = new AdmZip();
        bundledZip.addFile('archive/core/manifest.json', Buffer.from(JSON.stringify({
            id: 'green-fire-core',
            version: '1.2.0',
            type: 'core-archive',
            title: 'Green Fire Core Archive',
        })));
        bundledZip.addFile('archive/core/codices/first-flame.md', Buffer.from('# First Flame'));
        fs.writeFileSync(BUNDLED_CORE_CACHE_FILE, bundledZip.toBuffer());

        const result = installBundledCoreCache();
        expect(result.installed).toBe(true);
        expect(result.source).toBe('bundled');
        expect(result.installedVersion).toBe('1.2.0');
        expect(fs.existsSync(path.join(sc.ARCHIVE_CORE_DIR, 'codices', 'first-flame.md'))).toBe(true);
        expect(axios.get).not.toHaveBeenCalled();
    });

    test('installBundledCoreCache skips install when archive/core has user content', () => {
        fs.rmSync(sc.ARCHIVE_CORE_DIR, { recursive: true, force: true });

        const bundledZip = new AdmZip();
        bundledZip.addFile('archive/core/manifest.json', Buffer.from(JSON.stringify({
            id: 'green-fire-core',
            version: '1.2.0',
            type: 'core-archive',
        })));
        bundledZip.addFile('archive/core/codices/bundled.md', Buffer.from('# Bundled'));
        fs.writeFileSync(BUNDLED_CORE_CACHE_FILE, bundledZip.toBuffer());

        fs.mkdirSync(sc.ARCHIVE_CORE_DIR, { recursive: true });
        const userFile = path.join(sc.ARCHIVE_CORE_DIR, 'codices', 'user-note.md');
        fs.mkdirSync(path.dirname(userFile), { recursive: true });
        fs.writeFileSync(userFile, '# User content', 'utf8');

        const result = installBundledCoreCache();
        expect(result.installed).toBe(false);
        expect(result.skipped).toBe(true);
        expect(result.reason).toBe('core-has-user-content');
        expect(fs.readFileSync(userFile, 'utf8')).toBe('# User content');
    });
});
