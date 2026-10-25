'use strict';

let activeConversation = null;
let activeRequest = null;
let loadVersion = 0;
const draftPrefix = 'ember-node-draft:';
const composerDraftKey = draftPrefix + 'composer';

const byId = id => document.getElementById(id);
const status = text => { byId('save-status').textContent = text; };
const draftKey = id => draftPrefix + (id || 'composer');
const getDraft = id => localStorage.getItem(draftKey(id)) || '';
const setDraft = (id, value) => localStorage.setItem(draftKey(id), value);
const clearDraft = id => localStorage.removeItem(draftKey(id));
const requestKey = id => draftPrefix + 'request:' + id;

async function request(url, options) {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(data.error || 'Request failed');
        error.data = data;
        throw error;
    }
    return data;
}

function renderMessages(messages) {
    const host = byId('messages');
    host.replaceChildren();
    messages.forEach(message => {
        const article = document.createElement('article');
        article.className = 'message ' + message.role;
        const label = document.createElement('strong');
        label.textContent = message.role === 'assistant' ? 'Green Fire' : 'Sentinel';
        const content = document.createElement('p');
        content.textContent = message.content;
        article.append(label, content);
        host.append(article);
    });
    host.scrollTop = host.scrollHeight;
}

function persistVisibleDraft() {
    setDraft(activeConversation && activeConversation.id, byId('draft').value);
}

function applyConversation(conversation) {
    activeConversation = conversation;
    byId('chat-title').value = conversation.title;
    byId('draft').value = getDraft(conversation.id);
    renderMessages(conversation.messages);
    byId('send').disabled = Boolean(activeRequest && activeRequest.conversationId === conversation.id);
    byId('stop').disabled = !(activeRequest && activeRequest.conversationId === conversation.id);
}

async function loadConversation(id) {
    persistVisibleDraft();
    const version = ++loadVersion;
    const data = await request('/api/conversations/' + encodeURIComponent(id));
    if (version !== loadVersion) return;
    applyConversation(data.conversation);
    status('Saved locally.');
    refreshList().catch(() => {});
}

async function refreshList() {
    const { conversations } = await request('/api/conversations');
    const list = byId('conversation-list');
    list.replaceChildren();
    conversations.forEach(conversation => {
        const button = document.createElement('button');
        button.textContent = conversation.title;
        button.className = conversation.id === (activeConversation && activeConversation.id) ? 'selected' : '';
        button.onclick = () => loadConversation(conversation.id).catch(error => status(error.message));
        list.append(button);
    });
    byId('conversation-status').textContent = conversations.length + ' saved chat' + (conversations.length === 1 ? '' : 's');
}

async function createChat() {
    const { conversation } = await request('/api/conversations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
    });
    await loadConversation(conversation.id);
    return conversation;
}

function clearSubmittedDraft(requestState) {
    if (getDraft(requestState.conversationId) !== requestState.content) return;
    clearDraft(requestState.conversationId);
    if (activeConversation && activeConversation.id === requestState.conversationId &&
        byId('draft').value === requestState.content) {
        byId('draft').value = '';
    }
}

async function sendMessage(event) {
    event.preventDefault();
    const content = byId('draft').value.trim();
    if (!content) return;
    persistVisibleDraft();
    let conversation = activeConversation;
    if (!conversation) {
        conversation = await createChat();
        setDraft(conversation.id, content);
        if (activeConversation && activeConversation.id === conversation.id) byId('draft').value = content;
        clearDraft(null);
    }
    if (activeRequest && activeRequest.conversationId === conversation.id) {
        status('A response is already running for this chat.');
        return;
    }
    const requestState = {
        conversationId: conversation.id,
        requestId: localStorage.getItem(requestKey(conversation.id)) || crypto.randomUUID(),
        content,
    };
    localStorage.setItem(requestKey(conversation.id), requestState.requestId);
    activeRequest = requestState;
    if (activeConversation && activeConversation.id === conversation.id) {
        byId('send').disabled = true;
        byId('stop').disabled = false;
    }
    status('Saving your message and requesting local AI…');
    try {
        const result = await request('/api/conversations/' + encodeURIComponent(conversation.id) + '/respond', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ requestId: requestState.requestId, content }),
        });
        if (result.outcome === 'response_saved') {
            clearSubmittedDraft(requestState);
            localStorage.removeItem(requestKey(requestState.conversationId));
            if (activeConversation && activeConversation.id === conversation.id) {
                activeConversation = result.conversation;
                renderMessages(result.conversation.messages);
            }
            status('Message and response saved locally.');
            refreshList().catch(() => {});
        }
    } catch (error) {
        const outcome = error.data && error.data.outcome;
        if (outcome === 'cancelled') status('Cancellation confirmed. Your message remains saved.');
        else if (outcome === 'ai_failed') status('Your message was saved, but local AI failed. Retry will not duplicate it.');
        else if (outcome === 'save_failed') status('Message save failed or could not be confirmed. Your draft remains.');
        else status(error.message);
    } finally {
        if (activeRequest === requestState) activeRequest = null;
        if (activeConversation && activeConversation.id === conversation.id) {
            byId('send').disabled = false;
            byId('stop').disabled = true;
        }
    }
}

async function loadRuntime() {
    try {
        const [data, modelData] = await Promise.all([request('/api/status'), request('/api/ai/models')]);
        const ai = data.ai || {};
        const select = byId('model-select');
        const models = Array.isArray(modelData.models) ? modelData.models : [];
        select.replaceChildren();
        if (!modelData.available) {
            select.append(new Option('Runtime unavailable', ''));
            select.disabled = true;
            byId('runtime-status').textContent = 'Unavailable — chats remain usable';
            return;
        }
        if (!models.length) {
            select.append(new Option('No installed models', ''));
            select.disabled = true;
            byId('runtime-status').textContent = 'Available — no installed models';
            return;
        }
        select.disabled = false;
        select.append(...models.map(model => new Option(model.name, model.name)));
        select.value = modelData.selected_model || ai.configuredModel || '';
        byId('runtime-status').textContent = 'Available';
    } catch {
        byId('runtime-status').textContent = 'Unavailable — chats remain usable';
        byId('model-select').replaceChildren(new Option('Runtime unavailable', ''));
        byId('model-select').disabled = true;
    }
}

byId('new-chat').onclick = () => createChat().catch(error => status(error.message));
byId('composer').onsubmit = sendMessage;
byId('stop').onclick = async () => {
    const requestState = activeRequest;
    if (!requestState) return;
    try {
        const result = await request('/api/conversations/' + encodeURIComponent(requestState.conversationId) + '/respond/cancel', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ requestId: requestState.requestId }),
        });
        if (result.outcome === 'response_saved') status('Response was already saved.');
        else if (result.outcome === 'cancellation_unknown') status('Cancellation outcome is unknown; your draft remains.');
        else status('Cancellation requested…');
    } catch (error) { status(error.message); }
};
byId('rename-chat').onclick = async () => {
    if (!activeConversation) return;
    try {
        const data = await request('/api/conversations/' + encodeURIComponent(activeConversation.id), {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: byId('chat-title').value }),
        });
        activeConversation = data.conversation;
        status('Name saved locally.');
        refreshList();
    } catch (error) { status(error.message); }
};
byId('delete-chat').onclick = async () => {
    if (!activeConversation || !window.confirm('Delete this chat?')) return;
    try {
        await request('/api/conversations/' + encodeURIComponent(activeConversation.id), { method: 'DELETE' });
        clearDraft(activeConversation.id);
        activeConversation = null;
        byId('chat-title').value = 'New chat';
        byId('draft').value = getDraft(null);
        renderMessages([]);
        status('Chat deleted.');
        refreshList();
    } catch (error) { status(error.message); }
};
byId('export-chat').onclick = () => {
    if (activeConversation) window.location.href = '/api/conversations/' + encodeURIComponent(activeConversation.id) + '/export';
};
byId('toggle-sidebar').onclick = () => {
    const sidebar = byId('sidebar');
    sidebar.hidden = !sidebar.hidden;
    byId('toggle-sidebar').setAttribute('aria-expanded', String(!sidebar.hidden));
};
byId('settings-button').onclick = () => {
    const settings = byId('settings');
    settings.hidden = !settings.hidden;
    byId('settings-button').setAttribute('aria-expanded', String(!settings.hidden));
};
byId('model-select').onchange = async () => {
    try {
        const result = await request('/api/ai/models/select', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: byId('model-select').value }),
        });
        if (result.selected_model !== byId('model-select').value) throw new Error('Selected model was not confirmed');
        status('Installed model selected.');
    } catch (error) { status(error.message); }
};
byId('instructions-button').onclick = async () => {
    const panel = byId('instructions');
    panel.hidden = !panel.hidden;
    byId('instructions-button').setAttribute('aria-expanded', String(!panel.hidden));
    if (panel.hidden) return;
    try {
        const { files } = await request('/api/conversations/instructions');
        const host = byId('instruction-files');
        host.replaceChildren();
        files.forEach(file => {
            const heading = document.createElement('h3');
            heading.textContent = file.label;
            const content = document.createElement('pre');
            content.textContent = file.content;
            host.append(heading, content);
        });
    } catch (error) { status(error.message); }
};
byId('draft').addEventListener('input', () => {
    persistVisibleDraft();
    if (activeConversation) localStorage.removeItem(requestKey(activeConversation.id));
});

byId('draft').value = getDraft(null);
refreshList().then(async () => {
    const { conversations } = await request('/api/conversations');
    if (conversations[0] && !getDraft(null)) await loadConversation(conversations[0].id);
}).catch(error => status(error.message));
loadRuntime();
