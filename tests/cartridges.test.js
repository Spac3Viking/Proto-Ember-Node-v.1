const fs = require('fs');
const path = require('path');
const request = require('supertest');
const axios = require('axios');

jest.mock('axios');

describe('cartridgeLoader', () => {
    describe('listCartridges', () => {
        test('returns an array of cartridge summaries from the real cartridges directory', () => {
            const { listCartridges } = require('../app/cartridgeLoader');
            const cartridges = listCartridges();
            expect(Array.isArray(cartridges)).toBe(true);
            const ids = cartridges.map(c => c.id);
            expect(ids).toContain('green_fire');
            expect(ids).toContain('philosophy');
            expect(ids).toContain('survival');
            expect(ids).toContain('journals');
        });

        test('each entry has id, name, description, version, and type fields', () => {
            const { listCartridges } = require('../app/cartridgeLoader');
            const cartridges = listCartridges();
            cartridges.forEach(c => {
                expect(typeof c.id).toBe('string');
                expect(typeof c.name).toBe('string');
                expect(typeof c.description).toBe('string');
                expect(typeof c.version).toBe('string');
                expect(typeof c.type).toBe('string');
            });
        });

        test('entries with a manifest.json include manifest metadata', () => {
            const { listCartridges } = require('../app/cartridgeLoader');
            const cartridges = listCartridges();
            const gf = cartridges.find(c => c.id === 'green_fire');
            expect(gf).toBeDefined();
            expect(gf.name).toBe('Green Fire Archive');
            expect(gf.description.length).toBeGreaterThan(0);
        });

        test('only returns directories, not loose files', () => {
            const { listCartridges, CARTRIDGES_DIR } = require('../app/cartridgeLoader');
            const cartridges = listCartridges();
            cartridges.forEach(c => {
                const full = path.join(CARTRIDGES_DIR, c.id);
                expect(fs.statSync(full).isDirectory()).toBe(true);
            });
        });

        test('returns empty array when cartridges directory does not exist', () => {
            const fsSpy = jest.spyOn(fs, 'existsSync').mockReturnValueOnce(false);
            const { listCartridges } = require('../app/cartridgeLoader');
            expect(listCartridges()).toEqual([]);
            fsSpy.mockRestore();
        });
    });

    describe('loadCartridge', () => {
        test('returns null for a non-existent cartridge', () => {
            const { loadCartridge } = require('../app/cartridgeLoader');
            expect(loadCartridge('__nonexistent__')).toBeNull();
        });

        test('returns name and content for an existing cartridge', () => {
            const { loadCartridge } = require('../app/cartridgeLoader');
            const result = loadCartridge('green_fire');
            expect(result).not.toBeNull();
            expect(result.name).toBe('green_fire');
            expect(typeof result.content).toBe('string');
            expect(result.content.length).toBeGreaterThan(0);
        });

        test('includes manifest metadata when manifest.json is present', () => {
            const { loadCartridge } = require('../app/cartridgeLoader');
            const result = loadCartridge('green_fire');
            expect(result.manifest).not.toBeNull();
            expect(result.manifest.name).toBe('Green Fire Archive');
            expect(result.manifest.permissions.writeHearth).toBe(false);
        });

        test('content includes text from README.md', () => {
            const { loadCartridge } = require('../app/cartridgeLoader');
            const result = loadCartridge('philosophy');
            expect(result.content).toContain('Philosophy');
        });
    });
});

describe('GET /cartridges', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('returns 200 with an array of cartridge summaries', async () => {
        const { app } = require('../app/server');
        const res = await request(app).get('/cartridges');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.cartridges)).toBe(true);
        const ids = res.body.cartridges.map(c => c.id);
        expect(ids).toContain('green_fire');
        expect(ids).toContain('philosophy');
        expect(ids).toContain('survival');
        expect(ids).toContain('journals');
    });

    test('each cartridge summary has required fields', async () => {
        const { app } = require('../app/server');
        const res = await request(app).get('/cartridges');
        res.body.cartridges.forEach(c => {
            expect(typeof c.id).toBe('string');
            expect(typeof c.name).toBe('string');
        });
    });
});

describe('GET /cartridges/:name', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('returns 200 with name, manifest, and content for a known cartridge', async () => {
        const { app } = require('../app/server');
        const res = await request(app).get('/cartridges/survival');
        expect(res.status).toBe(200);
        expect(res.body.name).toBe('survival');
        expect(typeof res.body.content).toBe('string');
        expect(res.body.manifest).not.toBeNull();
        expect(res.body.manifest.name).toBe('Survival');
    });

    test('returns 404 for an unknown cartridge', async () => {
        const { app } = require('../app/server');
        const res = await request(app).get('/cartridges/__unknown__');
        expect(res.status).toBe(404);
        expect(res.body.error).toMatch(/__unknown__/);
    });
});
