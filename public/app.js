'use strict';

let activeConversation = null;
const drafts = new Map();

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
    status('Saving message…');
    try {
        const result = await request('/api/conversations/' + encodeURIComponent(activeConversation.id) + '/messages', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: 'user', content }),
        });
        activeConversation = result.conversation;
        drafts.delete(activeConversation.id);
        byId('draft').value = '';
        renderMessages(activeConversation.messages);
        status('Saved locally. Local AI sending will be enabled after the instruction pass.');
        refreshList().catch(() => {});
    } catch (error) {
        status('Not saved: ' + error.message);
    }
}

async function loadRuntime() {
    try {
        const data = await request('/api/status');
        const ai = data.ai || {};
        byId('runtime-status').textContent = ai.runtimeReachable ? 'Available' : 'Unavailable — chats remain usable';
        const select = byId('model-select');
        select.replaceChildren(new Option(data.model || ai.configuredModel || 'No model selected'));
    } catch {
        byId('runtime-status').textContent = 'Unavailable — chats remain usable';
    }
}

byId('new-chat').onclick = () => createChat().catch(error => status(error.message));
byId('composer').onsubmit = sendMessage;
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
byId('draft').addEventListener('input', () => {
    if (activeConversation) drafts.set(activeConversation.id, byId('draft').value);
});

refreshList().then(async () => {
    const { conversations } = await request('/api/conversations');
    if (conversations[0]) await loadConversation(conversations[0].id);
}).catch(error => status(error.message));
loadRuntime();
