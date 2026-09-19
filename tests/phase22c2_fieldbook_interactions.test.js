'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createElement() {
    return {
        value: '',
        textContent: '',
        style: {},
        children: [],
        attributes: {},
        appendChild(child) { this.children.push(child); return child; },
        setAttribute(name, value) { this.attributes[name] = String(value); },
        addEventListener() {},
    };
}

function loadFieldbookHarness(fetch) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
    const start = source.indexOf('let _signalThreadsListSnapshot = [];');
    const end = source.indexOf('async function exportActiveSignalThread()');
    const elements = new Map([
        ['signal-thread-field-log-input', createElement()],
        ['signal-thread-save-status', createElement()],
        ['signal-thread-field-log', createElement()],
        ['signal-threads-list', createElement()],
        ['signal-thread-title-input', createElement()],
    ]);
    const stages = ['observe', 'reflect', 'act', 'refine', 'remember', 'relate'].map(stage => ({
        dataset: { threadStage: stage },
        attributes: {},
        setAttribute(name, value) { this.attributes[name] = String(value); },
    }));
    const context = {
        fetch,
        document: {
            getElementById(id) { return elements.get(id) || null; },
            querySelectorAll(selector) { return selector === '[data-thread-stage]' ? stages : []; },
            createElement,
        },
        window: { localStorage: { setItem() {}, removeItem() {} } },
        formatRelativeTime() { return 'now'; },
        showFlashMessage() {},
        setTimeout,
        console,
    };
    vm.createContext(context);
    vm.runInContext(source.slice(start, end) + `
        globalThis.fieldbook = {
            setActive(thread) {
                _activeSignalThreadId = thread.id;
                _activeSignalThread = thread;
                _signalThreadStages.set(thread.id, thread.currentStage);
            },
            stage: setActiveSignalThreadStage,
            note: addFieldLogEntryToActiveThread,
            saveDraft: saveSignalThreadDraft,
            restoreDraft: restoreSignalThreadDraft,
            input: document.getElementById('signal-thread-field-log-input'),
            status: document.getElementById('signal-thread-save-status'),
            stages: () => _signalThreadStages,
        };`, context);
    return context.fieldbook;
}

describe('Phase 22C.2 — simplified Fieldbook interactions', () => {
    test('stage buttons persist all six stages and Relate notes retain their stage', async () => {
        const thread = { id: 'thread-1', currentStage: 'observe', entries: [] };
        const updates = [];
        const harness = loadFieldbookHarness(async (url, options) => {
            const body = JSON.parse(options.body);
            updates.push({ url, body });
            if (url.endsWith('/entries')) return { ok: true, json: async () => ({ success: true, entry: body }) };
            thread.currentStage = body.currentStage;
            return { ok: true, json: async () => ({ success: true, thread: { ...thread } }) };
        });
        harness.setActive(thread);

        for (const stage of ['observe', 'reflect', 'act', 'refine', 'remember', 'relate']) {
            await harness.stage(stage);
        }
        harness.input.value = 'Connected the companion thread.';
        await harness.note();

        expect(updates.filter(update => update.body.currentStage).map(update => update.body.currentStage))
            .toEqual(['observe', 'reflect', 'act', 'refine', 'remember', 'relate']);
        expect(updates.at(-1).body).toEqual({
            stage: 'relate',
            content: 'Connected the companion thread.',
        });
    });

    test('serializes delayed notes and later stage changes without crossing thread state', async () => {
        const requests = [];
        let releaseNote;
        const noteGate = new Promise(resolve => { releaseNote = resolve; });
        const harness = loadFieldbookHarness(async (url, options) => {
            const body = JSON.parse(options.body);
            requests.push(body);
            if (url.endsWith('/entries')) {
                await noteGate;
                return { ok: true, json: async () => ({ success: true, entry: body }) };
            }
            return { ok: true, json: async () => ({ success: true, thread: { id: 'thread-1', currentStage: body.currentStage } }) };
        });
        harness.setActive({ id: 'thread-1', currentStage: 'observe', entries: [] });
        await harness.stage('relate');
        harness.input.value = 'Keep the relation.';
        const note = harness.note();
        const stage = harness.stage('observe');
        releaseNote();
        await Promise.all([note, stage]);

        expect(requests).toEqual([
            { currentStage: 'relate' },
            { stage: 'relate', content: 'Keep the relation.' },
            { currentStage: 'observe' },
        ]);
        expect(harness.stages().get('thread-1')).toBe('observe');
    });

    test('keeps failed work retryable and drafts isolated while another thread saves', async () => {
        let attempts = 0;
        const harness = loadFieldbookHarness(async (url, options) => {
            const body = JSON.parse(options.body);
            if (url.endsWith('/entries')) {
                attempts += 1;
                if (attempts === 1) return { ok: false, json: async () => ({ error: 'offline' }) };
                return { ok: true, json: async () => ({ success: true, entry: body }) };
            }
            return { ok: true, json: async () => ({ success: true, thread: {} }) };
        });
        harness.setActive({ id: 'thread-a', currentStage: 'act', entries: [] });
        harness.input.value = 'Retry this note.';
        harness.saveDraft();
        await harness.note();
        expect(harness.status.textContent).toBe('Save failed — retry');
        expect(harness.input.value).toBe('Retry this note.');

        harness.setActive({ id: 'thread-b', currentStage: 'observe', entries: [] });
        harness.input.value = 'Other draft.';
        harness.saveDraft();
        harness.setActive({ id: 'thread-a', currentStage: 'act', entries: [] });
        harness.restoreDraft();
        expect(harness.input.value).toBe('Retry this note.');
        await harness.note();
        expect(harness.status.textContent).toBe('Saved');
        harness.setActive({ id: 'thread-b', currentStage: 'observe', entries: [] });
        harness.restoreDraft();
        expect(harness.input.value).toBe('Other draft.');
    });
});
