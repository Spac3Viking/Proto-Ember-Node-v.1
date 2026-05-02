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

    function setupRetrievalModule({ chunks, manifests }) {
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
        }));

        return require('../app/retrieval');
    }

    test('detectConceptDomains returns top domains and fallback general', () => {
        const retrieval = setupRetrievalModule({ chunks: [], manifests: {} });
        const routed = retrieval.detectConceptDomains('Explain rune glyph archetype links to myth-tech interfaces');
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
            'Map rune glyph archetype language through myth-tech interfaces',
        );

        expect(routing.primary).toBe('symbolic_language');
        expect(routing.domains).toEqual(expect.arrayContaining(['symbolic_language', 'myth_tech']));
        expect(Array.isArray(routing.priority_sources)).toBe(true);
        expect(routing.priority_sources.length).toBeGreaterThan(0);
        expect(routing.priority_sources[0]).toBe('runelore');
        expect(new Set(routing.priority_sources).size).toBe(routing.priority_sources.length);
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
});
