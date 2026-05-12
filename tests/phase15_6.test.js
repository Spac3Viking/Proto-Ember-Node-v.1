'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

describe('Phase 15.6 — concept index layer', () => {
    let originalDataRoot;
    const tempRoots = [];

    beforeAll(() => {
        originalDataRoot = process.env.EMBER_NODE_DATA_ROOT;
    });

    afterAll(() => {
        if (originalDataRoot === undefined) {
            delete process.env.EMBER_NODE_DATA_ROOT;
        } else {
            process.env.EMBER_NODE_DATA_ROOT = originalDataRoot;
        }
    });

    beforeEach(() => {
        jest.resetModules();
    });

    afterEach(() => {
        while (tempRoots.length > 0) {
            const dir = tempRoots.pop();
            if (!dir) continue;
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    test('ensureUserConceptIndex seeds user data index when missing', () => {
        const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ember-p15-6-'));
        tempRoots.push(tempRoot);
        process.env.EMBER_NODE_DATA_ROOT = tempRoot;

        const { ensureDataRoot } = require('../app/storageConfig');
        const {
            ensureUserConceptIndex,
            USER_CONCEPT_INDEX_PATH,
            loadConceptIndex,
        } = require('../app/conceptIndex');

        ensureDataRoot();
        expect(fs.existsSync(USER_CONCEPT_INDEX_PATH)).toBe(false);

        ensureUserConceptIndex();
        expect(fs.existsSync(USER_CONCEPT_INDEX_PATH)).toBe(true);

        const loaded = loadConceptIndex();
        expect(Array.isArray(loaded.domains)).toBe(true);
        expect(loaded.domains.length).toBeGreaterThan(0);
    });

    function setupRetrievalModule({ chunks, manifests, loadedLookup = { ids: new Set() } }) {
        jest.doMock('../app/indexStore', () => ({
            loadChunks: () => chunks,
            loadEmbeddings: () => ({ mockChunkId: [0.1, 0.2, 0.3] }),
            loadExcluded: () => [],
            loadManifests: () => manifests,
        }));

        jest.doMock('../app/embeddings', () => ({
            generateEmbedding: async () => null,
            cosineSimilarity: () => 0,
            keywordScore: (query, text) => {
                const qTerms = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
                if (qTerms.length === 0) return 0;
                const haystack = String(text || '').toLowerCase();
                let hits = 0;
                for (const term of qTerms) {
                    if (haystack.includes(term)) hits += 1;
                }
                return hits / qTerms.length;
            },
        }));

        jest.doMock('../app/archiveService', () => ({
            SOURCE_CLASS_ARCHIVE: 'trusted-archive',
            SOURCE_CLASS_ARCHIVE_CACHE: 'trusted-archive-cache',
        }));

        jest.doMock('../app/loadedCaches', () => ({
            getLoadedCacheLookup: () => loadedLookup,
        }));

        return require('../app/retrieval');
    }

    test('detectConceptDomains returns top domains and fallback general', () => {
        const retrieval = setupRetrievalModule({ chunks: [], manifests: {} });
        const routed = retrieval.detectConceptDomains(
            'Explain rune glyph archetype symbols with a minor myth-tech mention',
        );
        expect(routed.primary).toBe('symbolic_language');
        expect(routed.domains).toContain('symbolic_language');
        expect(routed.domains).toContain('myth_tech');
        expect(routed.domains.length).toBeLessThanOrEqual(3);
        expect(routed.scores.symbolic_language).toBeGreaterThan(0);

        const fallback = retrieval.detectConceptDomains('Tell me something unrelated');
        expect(fallback).toEqual({
            primary: 'general',
            domains: ['general'],
            scores: {},
        });
        expect(retrieval.detectConceptDomain('Tell me something unrelated')).toBe('general');
    });

    test('getPrioritySourcesForQuery combines and deduplicates multi-domain source priorities', () => {
        const retrieval = setupRetrievalModule({ chunks: [], manifests: {} });
        const routing = retrieval.getPrioritySourcesForQuery(
            'Map rune glyph archetype symbols through myth-tech',
        );

        expect(routing.primary).toBe('symbolic_language');
        expect(routing.domains).toEqual(expect.arrayContaining(['symbolic_language', 'myth_tech']));
        expect(Array.isArray(routing.priority_sources)).toBe(true);
        expect(routing.priority_sources.length).toBeGreaterThan(0);
        expect(routing.priority_sources[0]).toBe('runelore');
        expect(new Set(routing.priority_sources).size).toBe(routing.priority_sources.length);
    });

    test('retrieve applies concept bonus multiplicatively', async () => {
        const chunks = [
            {
                id: 'c1',
                sourceId: 'src-generic',
                room: 'hearth',
                shelf: 'archive',
                file: 'generic.md',
                text: 'glyph archetype language baseline',
            },
            {
                id: 'c2',
                sourceId: 'src-runelore',
                room: 'hearth',
                shelf: 'archive',
                file: 'runelore.md',
                text: 'glyph archetype language runic',
            },
        ];

        const manifests = {
            'src-generic': {
                id: 'src-generic',
                sourceClass: 'trusted-archive',
                title: 'General Notes',
                file: 'generic.md',
            },
            'src-runelore': {
                id: 'src-runelore',
                sourceClass: 'trusted-archive',
                title: 'Runelore',
                file: 'runelore.md',
            },
        };

        const retrieval = setupRetrievalModule({ chunks, manifests });
        const results = await retrieval.retrieve({
            query: 'glyph archetype language',
            rooms: ['hearth'],
            routeHint: 'general',
            topK: 2,
        });

        const boosted = results.find(r => r.chunk.sourceId === 'src-runelore');
        expect(boosted).toBeTruthy();
        expect(boosted.routeBonus).toBe(0);
        expect(boosted.titleBonus).toBe(0);
        expect(boosted.duplicatePenalty).toBe(0);
        const expected = boosted.textMatchScore * (1 + boosted.conceptBonus);
        expect(boosted.score).toBeCloseTo(expected, 6);
        expect(results[0].chunk.sourceId).toBe('src-runelore');
    });

    test('retrieve applies depth retrieval discipline to loaded cache preference', async () => {
        const chunks = [
            {
                id: 'c-loaded',
                sourceId: 'src-loaded',
                room: 'hearth',
                shelf: 'archive',
                file: 'loaded.md',
                cacheId: 'green-fire-core',
                text: 'green fire continuity mapping and practice',
            },
            {
                id: 'c-unloaded',
                sourceId: 'src-unloaded',
                room: 'hearth',
                shelf: 'archive',
                file: 'unloaded.md',
                text: 'green fire continuity mapping and practice',
            },
        ];
        const manifests = {
            'src-loaded': {
                id: 'src-loaded',
                sourceClass: 'trusted-archive',
                title: 'Loaded Source',
                file: 'loaded.md',
                cacheId: 'green-fire-core',
            },
            'src-unloaded': {
                id: 'src-unloaded',
                sourceClass: 'trusted-archive',
                title: 'Unloaded Source',
                file: 'unloaded.md',
            },
        };
        const retrieval = setupRetrievalModule({
            chunks,
            manifests,
            loadedLookup: { ids: new Set(['green-fire-core']) },
        });
        const results = await retrieval.retrieve({
            query: 'green fire continuity mapping',
            rooms: ['hearth'],
            routeHint: 'general',
            topK: 2,
            retrievalDiscipline: {
                loadedCacheBoost: 1.24,
                nonLoadedArchivePenalty: 0.86,
            },
        });

        expect(results.length).toBe(2);
        expect(results[0].chunk.sourceId).toBe('src-loaded');
        expect(results[0].loadedCacheMatch).toBe(true);
        expect(results[0].loadedCacheBoost).toBeCloseTo(1.24, 6);
        expect(results[1].loadedCacheMatch).toBe(false);
        expect(results[1].nonLoadedArchivePenalty).toBeCloseTo(0.86, 6);
    });

    test('retrieve enforces minimum distinct priority sources when available', async () => {
        const chunks = [
            { id: 'np1', sourceId: 'src-non-1', room: 'hearth', shelf: 'archive', file: 'n1.md', text: 'rune glyph archetype map meaning' },
            { id: 'np2', sourceId: 'src-non-2', room: 'hearth', shelf: 'archive', file: 'n2.md', text: 'rune glyph archetype map meaning' },
            { id: 'np3', sourceId: 'src-non-3', room: 'hearth', shelf: 'archive', file: 'n3.md', text: 'rune glyph archetype map meaning' },
            { id: 'np4', sourceId: 'src-non-4', room: 'hearth', shelf: 'archive', file: 'n4.md', text: 'rune glyph archetype map meaning' },
            { id: 'np5', sourceId: 'src-non-5', room: 'hearth', shelf: 'archive', file: 'n5.md', text: 'rune glyph archetype map meaning' },
            { id: 'p1', sourceId: 'src-runelore', room: 'hearth', shelf: 'archive', file: 'runelore.md', text: 'rune archetype language' },
            { id: 'p2', sourceId: 'src-symbol-index', room: 'hearth', shelf: 'archive', file: 'symbol-index.md', text: 'glyph language index' },
            { id: 'p3', sourceId: 'src-myth-tech', room: 'hearth', shelf: 'archive', file: 'myth-tech.md', text: 'archetype interfaces language' },
        ];

        const manifests = {
            'src-non-1': { id: 'src-non-1', sourceClass: 'trusted-archive', title: 'Other Source 1', file: 'n1.md' },
            'src-non-2': { id: 'src-non-2', sourceClass: 'trusted-archive', title: 'Other Source 2', file: 'n2.md' },
            'src-non-3': { id: 'src-non-3', sourceClass: 'trusted-archive', title: 'Other Source 3', file: 'n3.md' },
            'src-non-4': { id: 'src-non-4', sourceClass: 'trusted-archive', title: 'Other Source 4', file: 'n4.md' },
            'src-non-5': { id: 'src-non-5', sourceClass: 'trusted-archive', title: 'Other Source 5', file: 'n5.md' },
            'src-runelore': { id: 'src-runelore', sourceClass: 'trusted-archive', title: 'Runelore', file: 'runelore.md' },
            'src-symbol-index': { id: 'src-symbol-index', sourceClass: 'trusted-archive', title: 'Symbol Index', file: 'symbol-index.md' },
            'src-myth-tech': { id: 'src-myth-tech', sourceClass: 'trusted-archive', title: 'Myth-Tech', file: 'myth-tech.md' },
        };

        const retrieval = setupRetrievalModule({ chunks, manifests });
        const results = await retrieval.retrieve({
            query: 'rune glyph archetype map',
            rooms: ['hearth'],
            routeHint: 'general',
            topK: 6,
            maxChunksPerSource: 1,
            targetSources: 6,
        });

        const prioritySourceIds = new Set(['src-runelore', 'src-symbol-index', 'src-myth-tech']);
        const presentPrioritySources = new Set(
            results
                .map(r => r.chunk.sourceId)
                .filter(sourceId => prioritySourceIds.has(sourceId)),
        );

        expect(results.length).toBeLessThanOrEqual(6);
        expect(presentPrioritySources.size).toBeGreaterThanOrEqual(3);

        const perSource = {};
        for (const entry of results) {
            const sourceId = entry.chunk.sourceId;
            perSource[sourceId] = (perSource[sourceId] || 0) + 1;
        }
        expect(Math.max(...Object.values(perSource))).toBeLessThanOrEqual(1);
    });

    test('retrieve boosts sources aligned to concept-index priority sources and exposes routing metadata', async () => {
        const chunks = [
            {
                id: 'c1',
                sourceId: 'src-generic',
                room: 'hearth',
                shelf: 'archive',
                file: 'generic.md',
                text: 'ontology meaning perception reality study',
            },
            {
                id: 'c2',
                sourceId: 'src-ontological',
                room: 'hearth',
                shelf: 'archive',
                file: 'framework.md',
                text: 'ontology meaning perception reality study',
            },
        ];

        const manifests = {
            'src-generic': {
                id: 'src-generic',
                sourceClass: 'trusted-archive',
                title: 'General Notes',
                file: 'generic.md',
            },
            'src-ontological': {
                id: 'src-ontological',
                sourceClass: 'trusted-archive',
                title: 'Green Fire Ontological Framework',
                file: 'framework.md',
            },
        };

        const retrieval = setupRetrievalModule({ chunks, manifests });
        const results = await retrieval.retrieve({
            query: 'I want to understand the green fire framework and map',
            rooms: ['hearth'],
            routeHint: 'general',
            topK: 2,
        });

        expect(results.length).toBeGreaterThan(0);
        expect(results[0].chunk.sourceId).toBe('src-ontological');
        expect(results[0].conceptDomain).toBe('core_orientation');
        expect(results[0].conceptDomains).toContain('core_orientation');
        expect(Array.isArray(results[0].prioritySourcesConsidered)).toBe(true);
        expect(results[0].prioritySourcesConsidered.length).toBeGreaterThan(0);
        expect(results[0].conceptBonus).toBeGreaterThan(0);
    });

    test('retrieve applies court source and domain boosts conservatively', async () => {
        const chunks = [
            {
                id: 'c1',
                sourceId: 'src-general',
                room: 'hearth',
                shelf: 'archive',
                file: 'notes.md',
                text: 'symbol pattern continuity map',
            },
            {
                id: 'c2',
                sourceId: 'src-runelore',
                room: 'hearth',
                shelf: 'archive',
                file: 'runelore.md',
                text: 'symbol pattern continuity map',
            },
        ];

        const manifests = {
            'src-general': {
                id: 'src-general',
                sourceClass: 'trusted-archive',
                title: 'General Notes',
                file: 'notes.md',
            },
            'src-runelore': {
                id: 'src-runelore',
                sourceClass: 'trusted-archive',
                title: 'Runelore',
                file: 'runelore.md',
            },
        };

        const retrieval = setupRetrievalModule({ chunks, manifests });
        const results = await retrieval.retrieve({
            query: 'symbol pattern continuity map',
            rooms: ['hearth'],
            routeHint: 'general',
            topK: 2,
            courtMember: {
                id: 'mystic',
                name: 'Mystic',
                priorityDomains: ['symbolic_language'],
                prioritySources: ['runelore'],
            },
        });

        const boosted = results.find(r => r.chunk.sourceId === 'src-runelore');
        expect(boosted).toBeTruthy();
        expect(boosted.courtPrioritySourceMatch).toBe(true);
        expect(boosted.courtPriorityDomainMatch).toBe(true);
        expect(boosted.courtSourceBoost).toBeCloseTo(1.25, 6);
        expect(boosted.courtDomainBoost).toBeCloseTo(1.12, 6);
        const preConceptScore = boosted.textMatchScore + boosted.routeBonus + boosted.titleBonus - boosted.duplicatePenalty;
        const expected = preConceptScore * (1 + boosted.conceptBonus) * boosted.courtSourceBoost * boosted.courtDomainBoost;
        expect(boosted.score).toBeCloseTo(expected, 6);
        expect(results[0].chunk.sourceId).toBe('src-runelore');
    });
});
