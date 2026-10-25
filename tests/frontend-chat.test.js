'use strict';

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
    let resolve;
    const promise = new Promise(next => { resolve = next; });
    return { promise, resolve };
};

function boot(fetch) {
    class Element {
        constructor() {
            this.value = '';
            this.textContent = '';
            this.disabled = false;
            this.hidden = false;
            this.children = [];
            this.style = {};
        }
        append(...children) { this.children.push(...children); }
        appendChild(child) { this.children.push(child); return child; }
        replaceChildren(...children) { this.children = children; }
        setAttribute() {}
        addEventListener(_event, handler) { this.oninput = handler; }
    }
    const ids = [
        'save-status', 'draft', 'messages', 'chat-title', 'send', 'stop', 'retry', 'retry-target',
        'context-notice', 'conversation-list', 'conversation-status', 'new-chat', 'composer',
        'rename-chat', 'delete-chat', 'export-chat', 'toggle-sidebar', 'settings-button',
        'model-select', 'runtime-status', 'instructions-button', 'instructions', 'instruction-files',
        'sidebar', 'settings',
    ];
    const elements = Object.fromEntries(ids.map(id => [id, new Element()]));
    const storage = new Map();
    const context = {
        document: {
            getElementById: id => elements[id],
            createElement: () => new Element(),
        },
        Option: class Option extends Element {
            constructor(text, value) { super(); this.textContent = text; this.value = value; }
        },
        localStorage: {
            getItem: key => storage.has(key) ? storage.get(key) : null,
            setItem: (key, value) => storage.set(key, String(value)),
            removeItem: key => storage.delete(key),
        },
        fetch,
        crypto: { randomUUID: () => 'request-' + Math.random() },
        window: { confirm: () => true, location: {} },
        console,
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8'), context);
    return { elements, storage };
}

function response(body, ok = true) {
    return Promise.resolve({ ok, json: () => Promise.resolve(body) });
}

test('first-chat creation sends captured text once and retains newer writing', async () => {
    const create = deferred();
    const calls = [];
    const { elements, storage } = boot((url, options = {}) => {
        calls.push({ url, options });
        if (url === '/api/conversations' && options.method === 'POST') return create.promise;
        if (url.includes('/respond')) return response({ outcome: 'ai_failed' }, false);
        if (url === '/api/conversations') return response({ conversations: [] });
        if (url === '/api/status') return response({ ai: {} });
        if (url === '/api/ai/models') return response({ available: false, models: [] });
        throw new Error(url);
    });
    await flush();
    elements.draft.value = 'send this';
    elements.draft.oninput();
    const first = elements.composer.onsubmit({ preventDefault() {} });
    elements.composer.onsubmit({ preventDefault() {} });
    elements.draft.value = 'keep this newer draft';
    elements.draft.oninput();
    create.resolve(await response({ conversation: { id: 'one', title: 'New chat', messages: [] } }));
    await first;
    expect(calls.filter(call => call.url === '/api/conversations' && call.options.method === 'POST')).toHaveLength(1);
    expect(calls.find(call => call.url.includes('/respond')).options.body).toContain('send this');
    expect(storage.get('ember-node-draft:one')).toBe('keep this newer draft');
});

test('creation failure keeps text and reports the failure', async () => {
    const { elements } = boot((url, options = {}) => {
        if (url === '/api/conversations' && options.method === 'POST') return response({ error: 'disk full' }, false);
        if (url === '/api/conversations') return response({ conversations: [] });
        if (url === '/api/status') return response({ ai: {} });
        if (url === '/api/ai/models') return response({ available: false, models: [] });
        throw new Error(url);
    });
    await flush();
    elements.draft.value = 'do not lose me';
    elements.draft.oninput();
    await expect(elements.composer.onsubmit({ preventDefault() {} })).rejects.toThrow('disk full');
    expect(elements.draft.value).toBe('do not lose me');
    expect(elements['save-status'].textContent).toContain('Could not create chat');
});

test('background results, retries, cancellation, and context notices stay with their chat', async () => {
    const pending = deferred();
    const conversations = [
        { id: 'a', title: 'A', messages: [] },
        { id: 'b', title: 'B', messages: [] },
    ];
    const fetch = jest.fn((url, options = {}) => {
        if (url === '/api/conversations') return response({ conversations });
        if (url === '/api/status') return response({ ai: {} });
        if (url === '/api/ai/models') return response({ available: false, models: [] });
        if (url === '/api/conversations/a') return response({ conversation: conversations[0] });
        if (url === '/api/conversations/b') return response({ conversation: conversations[1] });
        if (url === '/api/conversations/a/respond' && options.method === 'POST') return pending.promise;
        if (url === '/api/conversations/a/respond/cancel') return response({ outcome: 'cancellation_unknown' });
        throw new Error(url);
    });
    const { elements, storage } = boot(fetch);
    await flush();
    await flush();
    elements['conversation-list'].children[0].onclick();
    await flush();
    elements.draft.value = 'request A';
    elements.draft.oninput();
    elements.composer.onsubmit({ preventDefault() {} });
    elements.draft.value = 'newer A draft';
    elements.draft.oninput();
    await elements.stop.onclick();
    await flush();
    expect(storage.get('ember-node-draft:a')).toBe('newer A draft');
    elements['conversation-list'].children[1].onclick();
    await flush();
    elements.draft.value = 'draft B';
    elements.draft.oninput();
    pending.resolve(await response({
        outcome: 'response_saved',
        conversation: { id: 'a', title: 'A', messages: [] },
        context: { notice: 'A context notice' },
    }));
    await flush();
    await flush();
    expect(elements['chat-title'].value).toBe('B');
    expect(elements.draft.value).toBe('draft B');
    expect(elements['context-notice'].hidden).toBe(true);

    storage.set('ember-node-draft:requests:b', JSON.stringify({
        one: { requestId: 'one', content: 'first unresolved' },
        two: { requestId: 'two', content: 'second unresolved' },
    }));
    await elements['conversation-list'].children.find(button => button.textContent === 'A').onclick();
    await elements['conversation-list'].children.find(button => button.textContent === 'B').onclick();
    await flush();
    await flush();
    expect(elements['chat-title'].value).toBe('B');
    await flush();
    expect(elements['retry-target'].hidden).toBe(false);
    expect(elements.retry.textContent).toContain('selected');
});
