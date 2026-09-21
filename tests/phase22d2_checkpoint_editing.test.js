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
        listeners: new Map(),
        appendChild(child) { this.children.push(child); return child; },
        addEventListener(type, listener) { this.listeners.set(type, listener); },
        dispatchEvent(event) {
            const listener = this.listeners.get(event.type);
            if (listener) listener(event);
        },
    };
}

function loadHarness(fetch) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
    const remember = source.slice(source.indexOf('function checkpointEditorValuesMatch(left, right)'),
        source.indexOf('function applyRememberEntrySelection()'));
    const rememberSelection = source.slice(source.indexOf('function applyRememberEntrySelection()'),
        source.indexOf('function setActiveCourtMemberId('));
    const hearth = source.slice(source.indexOf('let hearthActiveThreadId = null;'),
        source.indexOf('async function returnToCheckpointOrigin()'));
    const inputBindings = source.slice(source.indexOf('const rememberEntry = document.getElementById'),
        source.indexOf('const fieldLogInput = document.getElementById'));
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
    vm.runInContext(`${remember}\n${rememberSelection}\n${hearth}\n${inputBindings}\nglobalThis.harness = {
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
        input(element) { element.dispatchEvent({ type: 'input' }); },
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
        expect(ui.hearthBaselines.get('a').value.content).toBe('shared update');
    });

    test('Remember retains post-submit input and does not call it saved while delayed save completes', async () => {
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        const ui = loadHarness(async (url, options) => {
            if (url.includes('/remember')) {
                await gate;
                return { ok: true, json: async () => ({
                    success: true, checkpoint: checkpoint('a', JSON.parse(options.body).content),
                }) };
            }
            return { ok: true, json: async () => ({ checkpoints: [] }) };
        });
        ui.setActive('thread-a');
        ui.setLookup('thread-a', 'ready');
        ui.rememberContent.value = 'submitted';
        ui.input(ui.rememberContent);
        const save = ui.rememberActiveSignalThreadInHearth();
        ui.rememberContent.value = 'newer draft';
        ui.input(ui.rememberContent);

        expect(ui.rememberStatus.textContent).toMatch(/^Saving…/);
        release();
        await save;

        expect(ui.rememberContent.value).toBe('newer draft');
        expect(ui.rememberStatus.textContent).toBe('Unsaved changes');
    });

    test('Hearth preserves an edit back to the old baseline after delayed save completion', async () => {
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        const ui = loadHarness(async (url, options) => {
            if (url.includes('/hearth/checkpoints/a')) {
                await gate;
                return { ok: true, json: async () => ({
                    success: true, checkpoint: checkpoint('a', JSON.parse(options.body).content),
                }) };
            }
            return { ok: true, json: async () => ({ checkpoints: [] }) };
        });
        ui.showHearthCheckpoint(checkpoint('a', 'original'));
        ui.hearthContent.value = 'changed';
        ui.input(ui.hearthContent);
        const save = ui.saveHearthCheckpoint();
        ui.hearthContent.value = 'original';
        ui.input(ui.hearthContent);

        expect(ui.hearthStatus.textContent).toMatch(/^Saving…/);
        release();
        await save;

        expect(ui.hearthContent.value).toBe('original');
        expect(ui.hearthStatus.textContent).toBe('Unsaved changes');
    });

    test.each([
        ['Remember', 'remember'],
        ['Hearth', 'hearth'],
    ])('%s uses normalized saved content as the new baseline after retry', async (_name, editor) => {
        let attempts = 0;
        const ui = loadHarness(async (url, options) => {
            if (url.includes('/remember') || url.includes('/hearth/checkpoints/a')) {
                attempts += 1;
                if (attempts === 1) return { ok: false, json: async () => ({ error: 'offline' }) };
                return { ok: true, json: async () => ({
                    success: true, checkpoint: checkpoint('a', 'normalized', 'thread-a'),
                }) };
            }
            return { ok: true, json: async () => ({ checkpoints: [] }) };
        });

        if (editor === 'remember') {
            ui.setActive('thread-a');
            ui.setLookup('thread-a', 'ready');
            ui.rememberContent.value = 'submitted';
            ui.rememberDraft('thread-a');
            await ui.rememberActiveSignalThreadInHearth();
            expect(ui.rememberStatus.textContent).toMatch(/offline/);
            await ui.rememberActiveSignalThreadInHearth();
            expect(ui.rememberContent.value).toBe('submitted');
            expect(ui.rememberStatus.textContent).toBe('Unsaved changes');
            return;
        }

        ui.showHearthCheckpoint(checkpoint('a', 'original'));
        ui.hearthContent.value = 'submitted';
        ui.saveHearthCheckpointDraft('a');
        await ui.saveHearthCheckpoint();
        expect(ui.hearthStatus.textContent).toMatch(/offline/);
        await ui.saveHearthCheckpoint();
        expect(ui.hearthContent.value).toBe('submitted');
        expect(ui.hearthStatus.textContent).toBe('Unsaved changes');
    });

    test('switching records during a delayed Hearth save keeps the response scoped to its checkpoint', async () => {
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        const ui = loadHarness(async (url, options) => {
            if (url.includes('/hearth/checkpoints/a')) {
                await gate;
                return { ok: true, json: async () => ({
                    success: true, checkpoint: checkpoint('a', JSON.parse(options.body).content),
                }) };
            }
            return { ok: true, json: async () => ({ checkpoints: [] }) };
        });
        ui.showHearthCheckpoint(checkpoint('a', 'A'));
        ui.hearthContent.value = 'A changed';
        ui.saveHearthCheckpointDraft('a');
        const save = ui.saveHearthCheckpoint();
        ui.showHearthCheckpoint(checkpoint('b', 'B'));
        release();
        await save;

        expect(ui.hearthContent.value).toBe('B');
        expect(ui.hearthStatus.textContent).toBe('Saved');
    });

    test('Remember preserves a return to the old saved baseline while a replacement is pending', async () => {
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        const ui = loadHarness(async (url, options) => {
            if (url.includes('/remember')) {
                await gate;
                return { ok: true, json: async () => ({
                    success: true, checkpoint: checkpoint('a', JSON.parse(options.body).content, 'thread-a'),
                }) };
            }
            return { ok: true, json: async () => ({ checkpoints: [] }) };
        });
        ui.setActive('thread-a');
        ui.setLookup('thread-a', 'ready');
        ui.syncCheckpointEditors(checkpoint('a', 'original', 'thread-a'));
        ui.rememberContent.value = 'changed';
        ui.input(ui.rememberContent);
        const save = ui.rememberActiveSignalThreadInHearth();
        ui.rememberContent.value = 'original';
        ui.input(ui.rememberContent);
        release();
        await save;

        expect(ui.rememberContent.value).toBe('original');
        expect(ui.rememberStatus.textContent).toBe('Unsaved changes');
    });

    test('switching Signal Threads during a delayed Remember save does not update the new thread', async () => {
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        const ui = loadHarness(async (url, options) => {
            if (url.includes('/remember')) {
                await gate;
                return { ok: true, json: async () => ({
                    success: true, checkpoint: checkpoint('a', JSON.parse(options.body).content, 'thread-a'),
                }) };
            }
            return { ok: true, json: async () => ({ checkpoints: [] }) };
        });
        ui.setActive('thread-a');
        ui.setLookup('thread-a', 'ready');
        ui.rememberContent.value = 'A changed';
        ui.input(ui.rememberContent);
        const save = ui.rememberActiveSignalThreadInHearth();
        ui.setActive('thread-b');
        ui.setRememberStatus('thread-b', 'Unsaved changes');
        release();
        await save;

        expect(ui.rememberStatus.textContent).toBe('Unsaved changes');
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
