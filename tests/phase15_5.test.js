'use strict';

describe('Phase 15.5 — multi-source retrieval + context balancing', () => {
    beforeEach(() => {
        jest.resetModules();
    });

    function loadRetrieval({ chunks, manifests }) {
        jest.doMock('../app/indexStore', () => ({
            loadChunks: () => chunks,
            loadEmbeddings: () => ({}),
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

    test('detectRoute maps symbolic and fallback queries correctly', () => {
        const retrieval = loadRetrieval({ chunks: [], manifests: {} });
        expect(retrieval.detectRoute('What does this rune glyph symbolize?')).toBe('symbolic');
        expect(retrieval.detectRoute('Tell me anything interesting')).toBe('general');
    });

    test('retrieve balances across multiple sources and caps per-source chunk count', async () => {
        const chunks = [
            { id: 'd1', sourceId: 'src-dialogues', room: 'hearth', shelf: 'archive', file: 'dialogues.md', text: 'symbol node mirror dialogue one' },
            { id: 'd2', sourceId: 'src-dialogues', room: 'hearth', shelf: 'archive', file: 'dialogues.md', text: 'symbol node mirror dialogue two' },
            { id: 'd3', sourceId: 'src-dialogues', room: 'hearth', shelf: 'archive', file: 'dialogues.md', text: 'symbol node mirror dialogue three' },
            { id: 'd4', sourceId: 'src-dialogues', room: 'hearth', shelf: 'archive', file: 'dialogues.md', text: 'symbol node mirror dialogue four' },
            { id: 'r1', sourceId: 'src-runelore', room: 'hearth', shelf: 'archive', file: 'runelore.md', text: 'rune glyph archetype meaning and symbol language' },
            { id: 'r2', sourceId: 'src-runelore', room: 'hearth', shelf: 'archive', file: 'runelore.md', text: 'rune element archetype and glyph correspondence' },
            { id: 'm1', sourceId: 'src-myth-tech', room: 'hearth', shelf: 'archive', file: 'myth-tech.md', text: 'myth-tech symbol engines and rune interfaces' },
            { id: 's1', sourceId: 'src-symbol-index', room: 'hearth', shelf: 'archive', file: 'symbol-index.md', text: 'symbol index for glyph sets and element forms' },
        ];

        const manifests = {
            'src-dialogues': { id: 'src-dialogues', sourceClass: 'trusted-archive', title: 'Green Fire Dialogues', file: 'dialogues.md' },
            'src-runelore': { id: 'src-runelore', sourceClass: 'trusted-archive', title: 'Runelore', file: 'runelore.md' },
            'src-myth-tech': { id: 'src-myth-tech', sourceClass: 'trusted-archive', title: 'Myth-Tech', file: 'myth-tech.md' },
            'src-symbol-index': { id: 'src-symbol-index', sourceClass: 'trusted-archive', title: 'Symbol Index', file: 'symbol-index.md' },
        };

        const retrieval = loadRetrieval({ chunks, manifests });

        const results = await retrieval.retrieve({
            query: 'Help me understand rune glyph archetype symbols',
            rooms: ['hearth'],
            routeHint: 'symbolic',
            topK: 12,
        });

        expect(results.length).toBeGreaterThan(0);

        const perSource = {};
        for (const entry of results) {
            const sid = entry.chunk.sourceId;
            perSource[sid] = (perSource[sid] || 0) + 1;
        }

        const uniqueSources = Object.keys(perSource).length;
        expect(uniqueSources).toBeGreaterThanOrEqual(3);
        expect(Math.max(...Object.values(perSource))).toBeLessThanOrEqual(2);
        expect(perSource['src-runelore']).toBeGreaterThanOrEqual(1);
    });

    test('buildGroundedPrompt enforces chunk and history budgets', () => {
        const retrieval = loadRetrieval({ chunks: [], manifests: {} });

        const retrievedChunks = [
            { chunk: { room: 'hearth', shelf: 'archive', file: 'a.md', text: 'A'.repeat(3000) } },
            { chunk: { room: 'hearth', shelf: 'archive', file: 'b.md', text: 'B'.repeat(3000) } },
            { chunk: { room: 'hearth', shelf: 'archive', file: 'c.md', text: 'C'.repeat(3000) } },
        ];
        const recentHistory = [
            { role: 'user', content: 'u'.repeat(1200) },
            { role: 'assistant', content: 'a'.repeat(1200) },
            { role: 'user', content: 'u'.repeat(1200) },
        ];

        const prompt = retrieval.buildGroundedPrompt({
            query: 'What is the through-line?',
            retrievedChunks,
            recentHistory,
            maxContextChars: 1800,
            maxChunkChars: 400,
            maxHistoryChars: 350,
        });

        expect(prompt).toContain('User question: What is the through-line?');
        expect(prompt).toContain('=== Recent Chat Context ===');
        expect(prompt.length).toBeLessThan(3200);
    });
});
