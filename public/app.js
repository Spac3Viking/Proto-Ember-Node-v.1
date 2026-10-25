'use strict';

let activeConversation = null;
const drafts = new Map();
let activeRequest = null;

const byId = id => document.getElementById(id);
const status = text => { byId('save-status').textContent = text; };

async function request(url, options) {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Request failed');
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

async function loadConversation(id) {
    if (activeConversation) drafts.set(activeConversation.id, byId('draft').value);
    const data = await request('/api/conversations/' + encodeURIComponent(id));
    activeConversation = data.conversation;
    byId('chat-title').value = activeConversation.title;
    byId('draft').value = drafts.get(id) || '';
    renderMessages(activeConversation.messages);
    status('Saved locally.');
    await refreshList();
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
}

async function sendMessage(event) {
    event.preventDefault();
    if (!activeConversation) return createChat();
    const content = byId('draft').value.trim();
    if (!content) return;
    status('Sending to local AI…');
    const requestId = crypto.randomUUID();
    activeRequest = { conversationId: activeConversation.id, requestId };
    byId('send').disabled = true;
    byId('stop').disabled = false;
    try {
        const result = await request('/api/conversations/' + encodeURIComponent(activeConversation.id) + '/respond', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ requestId, content }),
        });
        if (!activeConversation || activeConversation.id !== result.conversation.id) return;
        activeConversation = result.conversation;
        drafts.delete(activeConversation.id);
        byId('draft').value = '';
        renderMessages(activeConversation.messages);
        status(result.context.notice || 'Saved locally.');
        refreshList().catch(() => {});
    } catch (error) {
        if (activeConversation) {
            await loadConversation(activeConversation.id).catch(() => {});
            byId('draft').value = content;
            drafts.set(activeConversation.id, content);
        }
        status('Your message was saved. ' + error.message);
    } finally {
        activeRequest = null;
        byId('send').disabled = false;
        byId('stop').disabled = true;
    }
}

async function loadRuntime() {
    try {
        const [data, models] = await Promise.all([request('/api/status'), request('/api/ai/models')]);
        const ai = data.ai || {};
        byId('runtime-status').textContent = ai.runtimeReachable ? 'Available' : 'Unavailable — chats remain usable';
        const select = byId('model-select');
        select.replaceChildren(...(models.models || []).map(model => new Option(model, model)));
        select.value = models.selectedModel || data.model || ai.configuredModel || '';
    } catch {
        byId('runtime-status').textContent = 'Unavailable — chats remain usable';
    }
}

byId('new-chat').onclick = () => createChat().catch(error => status(error.message));
byId('composer').onsubmit = sendMessage;
byId('stop').onclick = async () => {
    if (!activeRequest) return;
    try {
        await request('/api/conversations/' + encodeURIComponent(activeRequest.conversationId) + '/respond/cancel', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ requestId: activeRequest.requestId }),
        });
        status('Stopping request…');
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
        activeConversation = null;
        renderMessages([]);
        byId('draft').value = '';
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
        await request('/api/ai/models/select', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: byId('model-select').value }),
        });
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
    if (activeConversation) drafts.set(activeConversation.id, byId('draft').value);
});

refreshList().then(async () => {
    const { conversations } = await request('/api/conversations');
    if (conversations[0]) await loadConversation(conversations[0].id);
}).catch(error => status(error.message));
loadRuntime();
