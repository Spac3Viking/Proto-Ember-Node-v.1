'use strict';

let activeConversation = null;
const activeRequests = new Map();
const conversationUi = new Map();
let creatingConversation = null;
let loadVersion = 0;
const draftPrefix = 'ember-node-draft:';
const composerDraftKey = draftPrefix + 'composer';

const byId = id => document.getElementById(id);
const status = text => { byId('save-status').textContent = text; };
const uiState = id => {
    const key = id || 'composer';
    if (!conversationUi.has(key)) conversationUi.set(key, { status: '', contextNotice: '' });
    return conversationUi.get(key);
};
const setConversationStatus = (id, text) => {
    uiState(id).status = text;
    if ((activeConversation && activeConversation.id === id) || (!activeConversation && !id)) status(text);
};
const setContextNotice = (id, text) => {
    uiState(id).contextNotice = text || '';
    if (activeConversation && activeConversation.id === id) {
        byId('context-notice').textContent = text || '';
        byId('context-notice').hidden = !text;
    }
};
const draftKey = id => draftPrefix + (id || 'composer');
const getDraft = id => localStorage.getItem(draftKey(id)) || '';
const setDraft = (id, value) => localStorage.setItem(draftKey(id), value);
const clearDraft = id => localStorage.removeItem(draftKey(id));
const requestKey = id => draftPrefix + 'requests:' + id;
const getRequests = id => {
    try { return JSON.parse(localStorage.getItem(requestKey(id)) || '{}'); } catch { return {}; }
};
const setRequests = (id, requests) => localStorage.setItem(requestKey(id), JSON.stringify(requests));
const saveRequest = state => {
    const requests = getRequests(state.conversationId);
    requests[state.requestId] = { requestId: state.requestId, content: state.content };
    setRequests(state.conversationId, requests);
};
const removeRequest = state => {
    const requests = getRequests(state.conversationId);
    delete requests[state.requestId];
    setRequests(state.conversationId, requests);
};

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
    const activeRequest = activeRequests.get(conversation.id);
    byId('send').disabled = Boolean(activeRequest);
    byId('stop').disabled = !activeRequest;
    const unresolved = Object.values(getRequests(conversation.id));
    const retryTarget = byId('retry-target');
    retryTarget.replaceChildren();
    unresolved.forEach(requestState => {
        const option = new Option(requestState.content.slice(0, 80), requestState.requestId);
        retryTarget.append(option);
    });
    retryTarget.hidden = unresolved.length < 2;
    byId('retry').hidden = !unresolved.length;
    byId('retry').textContent = unresolved.length === 1
        ? 'Retry: ' + unresolved[0].content.slice(0, 48)
        : 'Retry selected unresolved request';
    const currentUi = uiState(conversation.id);
    status(currentUi.status || 'Saved locally.');
    setContextNotice(conversation.id, currentUi.contextNotice || conversation.contextNotice);
    if (conversation.recovery && conversation.recovery.recovered) {
        setConversationStatus(conversation.id, 'Recovered an earlier backup; newer work may be absent.');
    }
}

async function loadConversation(id) {
    persistVisibleDraft();
    const version = ++loadVersion;
    const data = await request('/api/conversations/' + encodeURIComponent(id));
    if (version !== loadVersion) return;
    applyConversation(data.conversation);
    refreshList().catch(() => {});
}

async function refreshList() {
    const { conversations } = await request('/api/conversations');
    const list = byId('conversation-list');
    list.replaceChildren();
    conversations.forEach(conversation => {
        const button = document.createElement('button');
        button.textContent = conversation.title + (conversation.recovery && conversation.recovery.recovered ? ' (recovered)' : '');
        button.className = conversation.id === (activeConversation && activeConversation.id) ? 'selected' : '';
        button.onclick = () => loadConversation(conversation.id).catch(error => status(error.message));
        list.append(button);
    });
    byId('conversation-status').textContent = conversations.length + ' saved chat' + (conversations.length === 1 ? '' : 's');
}

async function createChat() {
    const version = ++loadVersion;
    const { conversation } = await request('/api/conversations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
    });
    if (version === loadVersion) {
        applyConversation(conversation);
        refreshList().catch(() => {});
    }
    return conversation;
}

async function createConversationForFirstMessage(content) {
    if (creatingConversation) return null;
    const version = ++loadVersion;
    creatingConversation = { version, content };
    byId('send').disabled = true;
    setConversationStatus(null, 'Creating chat…');
    try {
        const { conversation } = await request('/api/conversations', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
        });
        const newerDraft = getDraft(null);
        setDraft(conversation.id, newerDraft);
        clearDraft(null);
        if (version === loadVersion && !activeConversation) applyConversation(conversation);
        refreshList().catch(() => {});
        return conversation;
    } catch (error) {
        setConversationStatus(null, 'Could not create chat: ' + error.message);
        throw error;
    } finally {
        creatingConversation = null;
        if (!activeConversation) byId('send').disabled = false;
    }
}

function clearSubmittedDraft(requestState) {
    if (getDraft(requestState.conversationId) !== requestState.content) return;
    clearDraft(requestState.conversationId);
    if (activeConversation && activeConversation.id === requestState.conversationId &&
        byId('draft').value === requestState.content) {
        byId('draft').value = '';
    }
}

async function submitRequest(conversation, requestState) {
    activeRequests.set(conversation.id, requestState);
    saveRequest(requestState);
    if (activeConversation && activeConversation.id === conversation.id) {
        byId('send').disabled = true;
        byId('stop').disabled = false;
        byId('retry').hidden = true;
    }
    setConversationStatus(conversation.id, 'Saving your message and requesting local AI…');
    try {
        const result = await request('/api/conversations/' + encodeURIComponent(conversation.id) + '/respond', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ requestId: requestState.requestId, content: requestState.content }),
        });
        if (result.outcome === 'response_saved') {
            clearSubmittedDraft(requestState);
            removeRequest(requestState);
            const notice = result.context && result.context.notice;
            setContextNotice(conversation.id, notice);
            if (activeConversation && activeConversation.id === conversation.id) {
                activeConversation = result.conversation;
                renderMessages(result.conversation.messages);
            }
            setConversationStatus(conversation.id, 'Message and response saved locally.');
            refreshList().catch(() => {});
        }
    } catch (error) {
        const outcome = error.data && error.data.outcome;
        if (outcome === 'cancelled') setConversationStatus(conversation.id, 'Cancellation confirmed. Your message remains saved.');
        else if (outcome === 'ai_failed') setConversationStatus(conversation.id, 'Your message was saved, but local AI failed. Retry will not duplicate it.');
        else if (outcome === 'save_failed') setConversationStatus(conversation.id, 'Message save failed or could not be confirmed. Your draft remains.');
        else setConversationStatus(conversation.id, error.message);
    } finally {
        if (activeRequests.get(requestState.conversationId) === requestState) activeRequests.delete(requestState.conversationId);
        if (activeConversation && activeConversation.id === conversation.id) applyConversation(activeConversation);
    }
}

async function sendMessage(event) {
    event.preventDefault();
    const content = byId('draft').value.trim();
    if (!content) return;
    persistVisibleDraft();
    let conversation = activeConversation;
    if (!conversation) {
        if (creatingConversation) return;
        conversation = await createConversationForFirstMessage(content);
        if (!conversation) return;
    }
    if (activeRequests.has(conversation.id)) {
        status('A response is already running for this chat.');
        return;
    }
    return submitRequest(conversation, { conversationId: conversation.id, requestId: crypto.randomUUID(), content });
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
byId('retry').onclick = () => {
    if (!activeConversation || activeRequests.has(activeConversation.id)) return;
    const unresolved = Object.values(getRequests(activeConversation.id));
    const selectedId = byId('retry-target').value;
    const request = unresolved.length === 1
        ? unresolved[0]
        : unresolved.find(candidate => candidate.requestId === selectedId);
    if (unresolved.length > 1 && !request) {
        setConversationStatus(activeConversation.id, 'Select the unresolved message to retry.');
        return;
    }
    if (request) submitRequest(activeConversation, { ...request, conversationId: activeConversation.id });
};
async function reconcileConversation(conversationId) {
    try {
        const data = await request('/api/conversations/' + encodeURIComponent(conversationId));
        if (activeConversation && activeConversation.id === conversationId) {
            persistVisibleDraft();
            applyConversation(data.conversation);
        }
        refreshList().catch(() => {});
    } catch (error) {
        setConversationStatus(conversationId, error.message);
    }
}
byId('stop').onclick = async () => {
    const requestState = activeConversation && activeRequests.get(activeConversation.id);
    if (!requestState) return;
    try {
        const result = await request('/api/conversations/' + encodeURIComponent(requestState.conversationId) + '/respond/cancel', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ requestId: requestState.requestId }),
        });
        if (result.outcome === 'response_saved') {
            setConversationStatus(requestState.conversationId, 'Response was already saved.');
            reconcileConversation(requestState.conversationId);
        } else if (result.outcome === 'cancellation_unknown') {
            setConversationStatus(requestState.conversationId, 'Cancellation outcome is unknown; your draft remains.');
            reconcileConversation(requestState.conversationId);
        } else setConversationStatus(requestState.conversationId, 'Cancellation requested…');
    } catch (error) { setConversationStatus(requestState.conversationId, error.message); }
};
byId('rename-chat').onclick = async () => {
    if (!activeConversation) return;
    const conversationId = activeConversation.id;
    try {
        const data = await request('/api/conversations/' + encodeURIComponent(activeConversation.id), {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: byId('chat-title').value }),
        });
        if (activeConversation && activeConversation.id === conversationId) activeConversation = data.conversation;
        status('Name saved locally.');
        refreshList();
    } catch (error) { status(error.message); }
};
byId('delete-chat').onclick = async () => {
    if (!activeConversation || !window.confirm('Delete this chat?')) return;
    const conversationId = activeConversation.id;
    try {
        await request('/api/conversations/' + encodeURIComponent(conversationId), { method: 'DELETE' });
        clearDraft(conversationId);
        localStorage.removeItem(requestKey(conversationId));
        activeRequests.delete(conversationId);
        if (!activeConversation || activeConversation.id !== conversationId) {
            refreshList();
            return;
        }
        activeConversation = null;
        byId('chat-title').value = 'New chat';
        byId('draft').value = getDraft(null);
        renderMessages([]);
        byId('context-notice').textContent = '';
        byId('context-notice').hidden = true;
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
});

byId('draft').value = getDraft(null);
refreshList().then(async () => {
    const { conversations } = await request('/api/conversations');
    if (conversations[0] && !getDraft(null)) await loadConversation(conversations[0].id);
}).catch(error => status(error.message));
loadRuntime();
