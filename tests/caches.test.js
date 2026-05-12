const fs = require('fs');
const path = require('path');
const request = require('supertest');
const axios = require('axios');

jest.mock('axios');

describe('cacheLoader', () => {
    describe('listCaches', () => {
        test('returns an array of cache summaries from the real caches directory', () => {
            const { listCaches } = require('../app/cacheLoader');
            const caches = listCaches();
            expect(Array.isArray(caches)).toBe(true);
            const ids = caches.map(c => c.id);
            expect(ids).toContain('green_fire');
            expect(ids).toContain('philosophy');
            expect(ids).toContain('survival');
            expect(ids).toContain('journals');
        });

        test('each entry has id, name, description, version, and type fields', () => {
            const { listCaches } = require('../app/cacheLoader');
            const caches = listCaches();
            caches.forEach(c => {
                expect(typeof c.id).toBe('string');
                expect(typeof c.name).toBe('string');
                expect(typeof c.description).toBe('string');
                expect(typeof c.version).toBe('string');
                expect(typeof c.type).toBe('string');
                expect(typeof c.level).toBe('string');
                expect(typeof c.status).toBe('string');
                expect(Array.isArray(c.scope)).toBe(true);
                expect(Array.isArray(c.derived_from)).toBe(true);
                expect(Array.isArray(c.distilled_into)).toBe(true);
                expect(Array.isArray(c.continuity_themes)).toBe(true);
                expect(typeof c.signal_density).toBe('string');
            });
        });

        test('entries with a manifest.json include manifest metadata', () => {
            const { listCaches } = require('../app/cacheLoader');
            const caches = listCaches();
            const gf = caches.find(c => c.id === 'green_fire');
            expect(gf).toBeDefined();
            expect(gf.name).toBe('Green Fire Archive');
            expect(gf.description.length).toBeGreaterThan(0);
        });

        test('only returns directories, not loose files', () => {
            const { listCaches, CACHES_DIR } = require('../app/cacheLoader');
            const caches = listCaches();
            caches.forEach(c => {
                const full = path.join(CACHES_DIR, c.id);
                expect(fs.statSync(full).isDirectory()).toBe(true);
            });
        });

        test('returns empty array when caches directory does not exist', () => {
            const fsSpy = jest.spyOn(fs, 'existsSync').mockReturnValueOnce(false);
            const { listCaches } = require('../app/cacheLoader');
            expect(listCaches()).toEqual([]);
            fsSpy.mockRestore();
        });
    });

    describe('loadCache', () => {
        test('returns null for a non-existent cache', () => {
            const { loadCache } = require('../app/cacheLoader');
            expect(loadCache('__nonexistent__')).toBeNull();
        });

        test('returns name and content for an existing cache', () => {
            const { loadCache } = require('../app/cacheLoader');
            const result = loadCache('green_fire');
            expect(result).not.toBeNull();
            expect(result.name).toBe('green_fire');
            expect(typeof result.content).toBe('string');
            expect(result.content.length).toBeGreaterThan(0);
        });

        test('includes manifest metadata when manifest.json is present', () => {
            const { loadCache } = require('../app/cacheLoader');
            const result = loadCache('green_fire');
            expect(result.manifest).not.toBeNull();
            expect(result.manifest.name).toBe('Green Fire Archive');
            expect(result.manifest.permissions.writeHearth).toBe(false);
        });

        test('content includes text from README.md', () => {
            const { loadCache } = require('../app/cacheLoader');
            const result = loadCache('philosophy');
            expect(result.content).toContain('Philosophy');
        });
    });
});

describe('GET /caches', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('returns 200 with an array of cache summaries', async () => {
        const { app } = require('../app/server');
        const res = await request(app).get('/caches');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.caches)).toBe(true);
        const ids = res.body.caches.map(c => c.id);
        expect(ids).toContain('green_fire');
        expect(ids).toContain('philosophy');
        expect(ids).toContain('survival');
        expect(ids).toContain('journals');
    });

    test('each cache summary has required fields', async () => {
        const { app } = require('../app/server');
        const res = await request(app).get('/caches');
        res.body.caches.forEach(c => {
            expect(typeof c.id).toBe('string');
            expect(typeof c.name).toBe('string');
        });
    });
});

describe('GET /caches/:name', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('returns 200 with name, manifest, and content for a known cache', async () => {
        const { app } = require('../app/server');
        const res = await request(app).get('/caches/survival');
        expect(res.status).toBe(200);
        expect(res.body.name).toBe('survival');
        expect(typeof res.body.content).toBe('string');
        expect(res.body.manifest).not.toBeNull();
        expect(res.body.manifest.name).toBe('Survival');
        expect(Array.isArray(res.body.manifest.derived_from)).toBe(true);
        expect(Array.isArray(res.body.manifest.distilled_into)).toBe(true);
        expect(Array.isArray(res.body.manifest.continuity_themes)).toBe(true);
        expect(typeof res.body.manifest.signal_density).toBe('string');
    });

    test('returns 404 for an unknown cache', async () => {
        const { app } = require('../app/server');
        const res = await request(app).get('/caches/__unknown__');
        expect(res.status).toBe(404);
        expect(res.body.error).toMatch(/__unknown__/);
    });
});

describe('Loaded cache routes', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('lists installed caches with metadata and loaded state', async () => {
        const { app } = require('../app/server');
        const res = await request(app).get('/api/caches/installed');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.caches)).toBe(true);
        expect(res.body.caches.length).toBeGreaterThan(0);
        const first = res.body.caches[0];
        expect(typeof first.id).toBe('string');
        expect(typeof first.level).toBe('string');
        expect(typeof first.status).toBe('string');
        expect(Array.isArray(first.scope)).toBe(true);
        expect(Array.isArray(first.derived_from)).toBe(true);
        expect(Array.isArray(first.distilled_into)).toBe(true);
        expect(Array.isArray(first.continuity_themes)).toBe(true);
        expect(typeof first.signal_density).toBe('string');
        expect(typeof first.documentCount).toBe('number');
        expect(typeof first.loaded).toBe('boolean');
    });

    test('load + unload updates loaded state without duplicates', async () => {
        const { app } = require('../app/server');
        const installed = await request(app).get('/api/caches/installed');
        const target = installed.body.caches.find(cache => cache && cache.id) || null;
        expect(target).toBeTruthy();
        await request(app).post('/api/caches/unload').send({ cacheId: target.id });

        const load = await request(app).post('/api/caches/load').send({ cacheId: target.id });
        expect(load.status).toBe(200);
        expect(load.body.success).toBe(true);
        expect(load.body.changed).toBe(true);

        const loadAgain = await request(app).post('/api/caches/load').send({ cacheId: target.id });
        expect(loadAgain.status).toBe(200);
        expect(loadAgain.body.success).toBe(true);
        expect(loadAgain.body.changed).toBe(false);

        const loaded = await request(app).get('/api/caches/loaded');
        expect(loaded.status).toBe(200);
        const found = (loaded.body.loaded || []).filter(entry => entry.id === target.id);
        expect(found.length).toBe(1);

        const unload = await request(app).post('/api/caches/unload').send({ cacheId: target.id });
        expect(unload.status).toBe(200);
        expect(unload.body.success).toBe(true);
    });
});
