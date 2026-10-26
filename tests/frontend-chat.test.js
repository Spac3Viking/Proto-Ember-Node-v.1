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
            this.attributes = {};
            this.scrollTop = 0;
            this.scrollHeight = 0;
            this.clientHeight = 0;
            this.focused = false;
        }
        append(...children) { this.children.push(...children); }
        appendChild(child) { this.children.push(child); return child; }
        replaceChildren(...children) { this.children = children; }
        setAttribute(name, value) { this.attributes[name] = value; }
        addEventListener(event, handler) { this['on' + event] = handler; }
        focus() { this.focused = true; }
        isVisible() { return !this.hidden && (!this.parentDetails || this.parentDetails.open); }
    }
    const ids = [
        'save-status', 'draft', 'messages', 'chat-title', 'send', 'stop', 'retry', 'retry-target',
        'context-notice', 'conversation-list', 'conversation-status', 'new-chat', 'composer',
        'rename-chat', 'delete-chat', 'export-chat', 'toggle-sidebar', 'settings-button',
        'model-select', 'runtime-status', 'instructions-button', 'instructions', 'instruction-files',
        'instruction-status', 'instruction-defaults', 'adopt-defaults-confirm', 'adopt-defaults',
        'sidebar', 'settings', 'chat-tools', 'latest-message', 'close-settings', 'close-instructions',
    ];
    const elements = Object.fromEntries(ids.map(id => [id, new Element()]));
    elements['instructions-button'].parentDetails = elements['chat-tools'];
    const storage = new Map();
    const documentEvents = {};
    const context = {
        document: {
            getElementById: id => elements[id],
            createElement: () => new Element(),
            addEventListener: (event, handler) => { documentEvents[event] = handler; },
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
    return { elements, storage, documentEvents };
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
    await flush();
    expect(elements['context-notice'].textContent).toBe('A context notice');
    expect(elements['context-notice'].hidden).toBe(false);
    await elements['conversation-list'].children.find(button => button.textContent === 'B').onclick();
    await flush();
    await flush();
    expect(elements['chat-title'].value).toBe('B');
    await flush();
    expect(elements['retry-target'].hidden).toBe(false);
    expect(elements.retry.textContent).toContain('selected');
});

test('instructions panel reviews defaults, exposes file errors, and confirms adoption feedback', async () => {
    let adopted = false;
    const fetch = jest.fn((url, options = {}) => {
        if (url === '/api/conversations') return response({ conversations: [] });
        if (url === '/api/status') return response({ ai: {} });
        if (url === '/api/ai/models') return response({ available: false, models: [] });
        if (url === '/api/conversations/instructions') {
            if (adopted) {
                return response({
                    files: [{ label: 'Identity and principles', content: 'Updated identity.' }],
                    errors: [],
                    defaults: [{ label: 'Bundled identity and principles', content: 'Updated bundled identity.' }],
                });

            }
            return response({
                files: [{ label: 'Identity and principles', content: '', error: 'Could not read identity.' }],
                errors: ['Could not read identity.'],
                defaults: [{ label: 'Bundled identity and principles', content: 'Bundled identity.' }],
            });
        }
        if (url === '/api/conversations/instructions/adopt-defaults' && options.method === 'POST') {
            adopted = true;
            return response({ message: 'Default instructions replaced; prior defaults were saved with .previous.' });
        }
        throw new Error(url);
    });
    const { elements } = boot(fetch);
    await flush();
    elements.instructions.hidden = true;
    await elements['instructions-button'].onclick();
    expect(elements['instruction-files'].children[0].textContent).toContain('unavailable');
    expect(elements['instruction-files'].children[1].textContent).toContain('Could not read identity.');
    expect(elements['instruction-defaults'].children[1].textContent).toBe('Bundled identity.');
    expect(elements['instruction-status'].textContent).toContain('Could not read identity.');
    elements['adopt-defaults-confirm'].checked = true;
    elements['adopt-defaults-confirm'].onchange();
    expect(elements['adopt-defaults'].disabled).toBe(false);
    await elements['adopt-defaults'].onclick();
    expect(fetch).toHaveBeenCalledWith('/api/conversations/instructions/adopt-defaults', expect.objectContaining({ method: 'POST' }));
    expect(fetch.mock.calls.filter(([url]) => url === '/api/conversations/instructions')).toHaveLength(2);
    expect(elements['instruction-files'].children[0].textContent).toBe('Identity and principles');
    expect(elements['instruction-files'].children[1].textContent).toBe('Updated identity.');
    expect(elements['instruction-status'].textContent).toContain('prior defaults were saved');
});

test('message scrolling stays put until the reader asks for the latest message', async () => {
    const conversations = [
        { id: 'a', title: 'A', messages: [{ role: 'assistant', content: 'Older message' }] },
        { id: 'b', title: 'B', messages: [] },
    ];
    const { elements } = boot(url => {
        if (url === '/api/conversations') return response({ conversations });
        if (url === '/api/status') return response({ ai: {} });
        if (url === '/api/ai/models') return response({ available: false, models: [] });
        if (url === '/api/conversations/a') return response({ conversation: conversations[0] });
        if (url === '/api/conversations/b') return response({ conversation: conversations[1] });
        throw new Error(url);
    });
    await flush();
    await flush();
    elements.messages.scrollHeight = 1000;
    elements.messages.clientHeight = 100;
    elements.messages.scrollTop = 100;
    elements.messages.onscroll();
    expect(elements['latest-message'].hidden).toBe(false);
    await elements['conversation-list'].children.find(button => button.textContent === 'B').onclick();
    await flush();
    await elements['conversation-list'].children.find(button => button.textContent === 'A').onclick();
    await flush();
    expect(elements.messages.scrollTop).toBe(100);
    elements['latest-message'].onclick();
    expect(elements.messages.scrollTop).toBe(1000);
    expect(elements['latest-message'].hidden).toBe(true);
});

test('delayed responses preserve older reading positions or follow the latest reply', async () => {
    const pending = deferred();
    const conversations = [{ id: 'a', title: 'A', messages: [{ role: 'assistant', content: 'Earlier reply' }] }];
    const fetch = jest.fn((url, options = {}) => {
        if (url === '/api/conversations') return response({ conversations });
        if (url === '/api/status') return response({ ai: {} });
        if (url === '/api/ai/models') return response({ available: false, models: [] });
        if (url === '/api/conversations/a') return response({ conversation: conversations[0] });
        if (url === '/api/conversations/a/respond' && options.method === 'POST') return pending.promise;
        throw new Error(url);
    });
    const { elements } = boot(fetch);
    await flush();
    await flush();
    elements.messages.scrollHeight = 1000;
    elements.messages.clientHeight = 100;
    elements.messages.scrollTop = 250;
    elements.draft.value = 'Question';
    const olderReader = elements.composer.onsubmit({ preventDefault() {} });
    pending.resolve(await response({
        outcome: 'response_saved',
        conversation: { id: 'a', title: 'A', messages: [{ role: 'assistant', content: 'Earlier reply' }, { role: 'assistant', content: 'New reply' }] },
    }));
    await olderReader;
    expect(elements.messages.scrollTop).toBe(250);

    const latestPending = deferred();
    fetch.mockImplementation((url, options = {}) => {
        if (url === '/api/conversations') return response({ conversations });
        if (url === '/api/status') return response({ ai: {} });
        if (url === '/api/ai/models') return response({ available: false, models: [] });
        if (url === '/api/conversations/a') return response({ conversation: conversations[0] });
        if (url === '/api/conversations/a/respond' && options.method === 'POST') return latestPending.promise;
        throw new Error(url);
    });
    elements.messages.scrollTop = 900;
    elements.draft.value = 'Another question';
    const latestReader = elements.composer.onsubmit({ preventDefault() {} });
    latestPending.resolve(await response({
        outcome: 'response_saved',
        conversation: { id: 'a', title: 'A', messages: [{ role: 'assistant', content: 'Earlier reply' }, { role: 'assistant', content: 'Newest reply' }] },
    }));
    await latestReader;
    expect(elements.messages.scrollTop).toBe(1000);
    expect(elements['latest-message'].hidden).toBe(true);
});

test('panels close with their controls or Escape and return focus to their opener', async () => {
    const { elements, documentEvents } = boot(url => {
        if (url === '/api/conversations') return response({ conversations: [] });
        if (url === '/api/status') return response({ ai: {} });
        if (url === '/api/ai/models') return response({ available: false, models: [] });
        if (url === '/api/conversations/instructions') return response({ files: [], errors: [], defaults: [] });
        throw new Error(url);
    });
    await flush();
    elements.settings.hidden = true;
    elements.instructions.hidden = true;
    elements['settings-button'].onclick();
    expect(elements.settings.hidden).toBe(false);
    elements['close-settings'].onclick();
    expect(elements.settings.hidden).toBe(true);
    expect(elements['settings-button'].focused).toBe(true);
    elements['chat-tools'].open = true;
    await elements['instructions-button'].onclick();
    expect(elements.instructions.hidden).toBe(false);
    expect(elements['chat-tools'].open).toBe(false);
    documentEvents.keydown({ key: 'Escape' });
    expect(elements.instructions.hidden).toBe(true);
    expect(elements['chat-tools'].open).toBe(true);
    expect(elements['instructions-button'].isVisible()).toBe(true);
    expect(elements['instructions-button'].focused).toBe(true);
});
