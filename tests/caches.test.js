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
    });

    test('returns 404 for an unknown cache', async () => {
        const { app } = require('../app/server');
        const res = await request(app).get('/caches/__unknown__');
        expect(res.status).toBe(404);
        expect(res.body.error).toMatch(/__unknown__/);
    });
});
