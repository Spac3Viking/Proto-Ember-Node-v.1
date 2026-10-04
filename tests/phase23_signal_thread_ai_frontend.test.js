'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createElement() {
    return {
        value: '',
        textContent: '',
        style: {},
        disabled: false,
        dataset: {},
        selectedOptions: [],
        children: [],
        appendChild(child) { this.children.push(child); return child; },
        addEventListener() {},
        setAttribute() {},
    };
}

function loadAiHarness(fetch) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
    const start = source.indexOf('let _signalThreadsListSnapshot = [];');
    const end = source.indexOf('async function exportActiveSignalThread()');
    const elements = new Map([
        ['signal-thread-ai-question', createElement()],
        ['signal-thread-ai-context', createElement()],
        ['signal-thread-ai-status', createElement()],
        ['signal-thread-ask-ai-btn', createElement()],
        ['signal-thread-cancel-ai-btn', createElement()],
        ['signal-thread-field-log', createElement()],
        ['signal-thread-remember-entry', createElement()],
    ]);
    const context = {
        fetch,
        AbortController,
        setTimeout,
        console,
        document: {
            getElementById(id) { return elements.get(id) || null; },
            querySelectorAll() { return []; },
            createElement,
        },
        window: {
            crypto: { randomUUID: () => 'request-id' },
            localStorage: { setItem() {}, getItem() { return null; } },
        },
        formatRelativeTime() { return 'now'; },
    };
    vm.createContext(context);
    vm.runInContext(source.slice(start, end) + `
        globalThis.aiHarness = {
            activate(thread) { _activeSignalThreadId = thread.id; _activeSignalThread = thread; },
            ask: askAiAboutActiveSignalThread,
            cancel: cancelActiveSignalThreadAiRequest,
            render: renderSignalThreadAiContext,
            saveDraft: saveSignalThreadAiDraft,
            question: document.getElementById('signal-thread-ai-question'),
            context: document.getElementById('signal-thread-ai-context'),
            askButton: document.getElementById('signal-thread-ask-ai-btn'),
            cancelButton: document.getElementById('signal-thread-cancel-ai-btn'),
            status: document.getElementById('signal-thread-ai-status'),
            drafts: () => _signalThreadAiDrafts,
            requests: () => _signalThreadAiRequests,
        };`, context);
    return context.aiHarness;
}

describe('Phase 23 — Signal Thread AI frontend interactions', () => {
    test('submits captured question and context to the request endpoint', async () => {
        const calls = [];
        const harness = loadAiHarness(async (url, options) => {
            calls.push({ url, body: JSON.parse(options.body) });
            return { ok: true, json: async () => ({ success: true, entry: { id: 'ai-1', kind: 'ai', content: 'Answer' } }) };
        });
        harness.activate({ id: 'thread-a', entries: [], currentStage: 'reflect' });
        harness.question.value = 'What now?';
        harness.context.selectedOptions = [{ value: 'entry-1' }];

        await harness.ask();

        expect(calls).toEqual([expect.objectContaining({
            url: '/api/signal-threads/thread-a/ask-ai',
            body: expect.objectContaining({ question: 'What now?', selectedEntryIds: ['entry-1'], requestId: 'request-id' }),
        })]);
    });

    test('derives pending controls from the active thread after switching', async () => {
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        const harness = loadAiHarness(async () => {
            await gate;
            return { ok: true, json: async () => ({ success: true, entry: { id: 'ai-1', kind: 'ai', content: 'Answer' } }) };
        });
        harness.activate({ id: 'thread-a', entries: [], currentStage: 'reflect' });
        harness.question.value = 'Question A';
        const asking = harness.ask();
        expect(harness.askButton.disabled).toBe(true);
        expect(harness.cancelButton.style.display).toBe('');

        harness.activate({ id: 'thread-b', entries: [], currentStage: 'act' });
        harness.render({ id: 'thread-b', entries: [] });
        expect(harness.askButton.disabled).toBe(false);
        expect(harness.cancelButton.style.display).toBe('none');

        release();
        await asking;
        expect(harness.requests().size).toBe(0);
    });

    test('keeps newer edits after server-confirmed cancellation', async () => {
        let rejectRequest;
        const harness = loadAiHarness((url, options) => {
            if (url.endsWith('/cancel')) return Promise.resolve({ ok: true, json: async () => ({ cancelled: true }) });
            return new Promise((_resolve, reject) => {
                rejectRequest = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
                options.signal.addEventListener('abort', rejectRequest);
            });
        });
        harness.activate({ id: 'thread-a', entries: [], currentStage: 'reflect' });
        harness.question.value = 'Original question';
        const asking = harness.ask();
        harness.question.value = 'Newer question';
        harness.context.selectedOptions = [{ value: 'new-entry' }];
        harness.saveDraft();
        await harness.cancel();
        await asking;

        expect(harness.drafts().get('thread-a')).toBe('Newer question');
        expect(harness.status.textContent).toMatch(/cancellation confirmed/i);
    });

    test('reconciles a completed request when the server reports cancellation was too late', async () => {
        let rejectRequest;
        const harness = loadAiHarness((url, options) => {
            if (url.endsWith('/cancel')) return Promise.resolve({ ok: true, json: async () => ({ cancelled: false }) });
            if (url.endsWith('/thread-a')) {
                return Promise.resolve({
                    ok: true,
                    json: async () => ({ thread: { id: 'thread-a', entries: [{ id: 'ai-1', kind: 'ai', content: 'Saved answer' }] } }),
                });
            }
            return new Promise((_resolve, reject) => {
                rejectRequest = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
                options.signal.addEventListener('abort', rejectRequest);
            });
        });
        harness.activate({ id: 'thread-a', entries: [], currentStage: 'reflect' });
        harness.question.value = 'Original question';
        const asking = harness.ask();
        harness.question.value = 'Newer question';
        harness.context.selectedOptions = [{ value: 'new-entry' }];
        harness.saveDraft();

        await harness.cancel();
        await asking;

        expect(harness.drafts().get('thread-a')).toBe('Newer question');
        expect(harness.status.textContent).toMatch(/already completed.*refreshed/i);
    });

    test('reports an unconfirmed cancellation after attempting to reconcile', async () => {
        let rejectRequest;
        const harness = loadAiHarness((url, options) => {
            if (url.endsWith('/cancel')) return Promise.reject(new Error('offline'));
            if (url.endsWith('/thread-a')) return Promise.reject(new Error('offline'));
            return new Promise((_resolve, reject) => {
                rejectRequest = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
                options.signal.addEventListener('abort', rejectRequest);
            });
        });
        harness.activate({ id: 'thread-a', entries: [], currentStage: 'reflect' });
        harness.question.value = 'Question';
        const asking = harness.ask();

        await harness.cancel();
        await asking;

        expect(harness.status.textContent).toMatch(/could not confirm whether ai stopped/i);
    });
});
