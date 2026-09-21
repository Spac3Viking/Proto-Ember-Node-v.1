'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function element() {
    return {
        value: '',
        textContent: '',
        style: {},
        children: [],
        appendChild(child) { this.children.push(child); return child; },
        addEventListener() {},
    };
}

function loadHarness(fetch) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
    const remember = source.slice(source.indexOf('const _rememberDrafts = new Map();'),
        source.indexOf('function applyRememberEntrySelection()'));
    const hearth = source.slice(source.indexOf('let hearthActiveThreadId = null;'),
        source.indexOf('async function returnToCheckpointOrigin()'));
    const elements = new Map([
        ['signal-thread-remember-content', element()],
        ['signal-thread-remember-entry', element()],
        ['signal-thread-remember-status', element()],
        ['hearth-checkpoint-content', element()],
        ['hearth-checkpoint-save-status', element()],
        ['hearth-checkpoint-title', element()],
        ['hearth-checkpoint-meta', element()],
        ['hearth-checkpoint-empty', element()],
        ['hearth-checkpoint-detail', element()],
        ['hearth-checkpoint-list', element()],
    ]);
    const context = {
        fetch,
        document: {
            getElementById(id) { return elements.get(id) || null; },
            createElement: element,
        },
        _activeSignalThreadId: null,
        _activeSignalThread: null,
        renderSignalThreadRememberEntries() {},
        console,
    };
    vm.createContext(context);
    vm.runInContext(`${remember}\n${hearth}\nglobalThis.harness = {
        rememberDraft, loadRememberCheckpoint, rememberActiveSignalThreadInHearth,
        saveHearthCheckpointDraft, showHearthCheckpoint, saveHearthCheckpoint,
        syncCheckpointEditors, setRememberStatus,
        setActive(id) { _activeSignalThreadId = id; _activeSignalThread = { id, entries: [] }; },
        setLookup(id, value) { _rememberLookupStates.set(id, value); },
        rememberDrafts: _rememberDrafts, rememberStatuses: _rememberStatuses,
        hearthDrafts: _hearthCheckpointDrafts, hearthBaselines: _hearthCheckpointBaselines,
        rememberContent: document.getElementById('signal-thread-remember-content'),
        rememberStatus: document.getElementById('signal-thread-remember-status'),
        hearthContent: document.getElementById('hearth-checkpoint-content'),
        hearthStatus: document.getElementById('hearth-checkpoint-save-status'),
    };`, context);
    return context.harness;
}

const checkpoint = (id, content, threadId = 'thread-a') => ({
    id, title: id, content, origin: { threadId, selectedEntryIds: [] },
});

describe('Phase 22D.2 — consistent checkpoint editing', () => {
    test('viewing A, B, then A without editing remains saved', () => {
        const ui = loadHarness(async () => ({ ok: true, json: async () => ({ checkpoints: [] }) }));
        ui.showHearthCheckpoint(checkpoint('a', 'A'));
        ui.showHearthCheckpoint(checkpoint('b', 'B'));
        ui.showHearthCheckpoint(checkpoint('a', 'A'));

        expect(ui.hearthDrafts.size).toBe(0);
        expect(ui.hearthContent.value).toBe('A');
        expect(ui.hearthStatus.textContent).toBe('Saved');
    });

    test('untouched views refresh while real drafts survive and disclose newer saved content', () => {
        const ui = loadHarness(async () => ({ ok: true, json: async () => ({ checkpoints: [] }) }));
        ui.showHearthCheckpoint(checkpoint('a', 'old'));
        ui.syncCheckpointEditors(checkpoint('a', 'new'));
        expect(ui.hearthContent.value).toBe('new');

        ui.hearthContent.value = 'local draft';
        ui.saveHearthCheckpointDraft('a');
        ui.showHearthCheckpoint(checkpoint('b', 'B'));
        ui.showHearthCheckpoint(checkpoint('a', 'new'));
        ui.syncCheckpointEditors(checkpoint('a', 'newer'));
        expect(ui.hearthContent.value).toBe('local draft');
        expect(ui.hearthStatus.textContent).toMatch(/Newer saved content/);
    });

    test('Remember and Hearth share saved updates, and newer text survives a pending Hearth save', async () => {
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        const ui = loadHarness(async (url, options) => {
            if (url.includes('/hearth/checkpoints/a')) {
                await gate;
                return { ok: true, json: async () => ({ success: true, checkpoint: checkpoint('a', JSON.parse(options.body).content) }) };
            }
            return { ok: true, json: async () => ({ checkpoints: [checkpoint('a', 'saved')] }) };
        });
        ui.showHearthCheckpoint(checkpoint('a', 'saved'));
        ui.hearthContent.value = 'first save';
        ui.saveHearthCheckpointDraft('a');
        const save = ui.saveHearthCheckpoint();
        ui.hearthContent.value = 'newer text';
        ui.saveHearthCheckpointDraft('a');
        release();
        await save;

        expect(ui.hearthContent.value).toBe('newer text');
        expect(ui.hearthStatus.textContent).toBe('Unsaved changes');
        ui.syncCheckpointEditors(checkpoint('a', 'shared update'));
        expect(ui.hearthBaselines.get('a').content).toBe('shared update');
    });

    test.each([
        ['HTTP failure', async () => ({ ok: false, json: async () => ({ error: 'offline' }) })],
        ['network failure', async () => { throw new Error('offline'); }],
    ])('Remember %s affects only its originating thread', async (_name, fail) => {
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        const ui = loadHarness(async url => {
            if (url.includes('/remember')) {
                await gate;
                return fail();
            }
            return { ok: true, json: async () => ({ checkpoints: [] }) };
        });
        ui.setActive('thread-a');
        ui.setLookup('thread-a', 'ready');
        ui.rememberContent.value = 'A edit';
        ui.rememberDraft('thread-a');
        const save = ui.rememberActiveSignalThreadInHearth();
        ui.setActive('thread-b');
        ui.setRememberStatus('thread-b', 'Saved in Hearth.');
        release();
        await save;

        expect(ui.rememberStatuses.get('thread-a')).toMatch(/offline|Save failed/);
        expect(ui.rememberStatus.textContent).toBe('Saved in Hearth.');
    });

    test('pending or failed lookup cannot submit an unreviewed Remember replacement', async () => {
        let resolveLookup;
        const lookup = new Promise(resolve => { resolveLookup = resolve; });
        const requests = [];
        const ui = loadHarness(async (url, options) => {
            requests.push({ url, options });
            if (url.endsWith('/hearth/checkpoints')) return lookup;
            return { ok: true, json: async () => ({ success: true }) };
        });
        ui.setActive('thread-a');
        ui.rememberContent.value = 'do not replace';
        const loading = ui.loadRememberCheckpoint('thread-a');
        await ui.rememberActiveSignalThreadInHearth();
        expect(requests.filter(request => request.url.includes('/remember'))).toHaveLength(0);

        resolveLookup({ ok: false, json: async () => ({ error: 'offline' }) });
        await loading;
        await ui.rememberActiveSignalThreadInHearth();
        expect(requests.filter(request => request.url.includes('/remember'))).toHaveLength(0);
        expect(ui.rememberStatus.textContent).toMatch(/Review unavailable/);
    });
});
