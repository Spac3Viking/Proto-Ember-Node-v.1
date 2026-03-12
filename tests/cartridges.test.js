const fs = require('fs');
const path = require('path');
const request = require('supertest');
const axios = require('axios');

jest.mock('axios');

describe('cartridgeLoader', () => {
    describe('listCartridges', () => {
        test('returns an array of cartridge names from the real cartridges directory', () => {
            const { listCartridges } = require('../app/cartridgeLoader');
            const names = listCartridges();
            expect(Array.isArray(names)).toBe(true);
            expect(names).toContain('green_fire');
            expect(names).toContain('philosophy');
            expect(names).toContain('survival');
            expect(names).toContain('journals');
        });

        test('only returns directories, not loose files', () => {
            const { listCartridges, CARTRIDGES_DIR } = require('../app/cartridgeLoader');
            const names = listCartridges();
            names.forEach(name => {
                const full = path.join(CARTRIDGES_DIR, name);
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

    test('returns 200 with an array of cartridge names', async () => {
        const { app } = require('../app/server');
        const res = await request(app).get('/cartridges');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.cartridges)).toBe(true);
        expect(res.body.cartridges).toContain('green_fire');
        expect(res.body.cartridges).toContain('philosophy');
        expect(res.body.cartridges).toContain('survival');
        expect(res.body.cartridges).toContain('journals');
    });
});

describe('GET /cartridges/:name', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('returns 200 with name and content for a known cartridge', async () => {
        const { app } = require('../app/server');
        const res = await request(app).get('/cartridges/survival');
        expect(res.status).toBe(200);
        expect(res.body.name).toBe('survival');
        expect(typeof res.body.content).toBe('string');
    });

    test('returns 404 for an unknown cartridge', async () => {
        const { app } = require('../app/server');
        const res = await request(app).get('/cartridges/__unknown__');
        expect(res.status).toBe(404);
        expect(res.body.error).toMatch(/__unknown__/);
    });
});
