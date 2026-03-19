/**
 * Ember Node v.ᚠ — Phase 4 app shell
 *
 * Phase 4: Sub-tab navigation, file lifecycle (Waiting/Indexed/Remembered),
 * multiple chat threads, file tagging, PDF/DOCX support, Projects, user Cartridges.
 */

/** Model name — kept in sync with app/server.js MODEL constant. */
const MODEL_LABEL = 'gemma3:4b';

/* ================================================================
   Utility
   ================================================================ */

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/* ================================================================
   Room Tab Switching  (3 rooms only)
   ================================================================ */

(function initRoomTabs() {
    const tabs   = document.querySelectorAll('.room-tab');
    const panels = document.querySelectorAll('.room-panel');

    function activateRoom(roomId) {
        tabs.forEach(t => {
            const isActive = t.dataset.room === roomId;
            t.classList.toggle('active', isActive);
            t.setAttribute('aria-selected', String(isActive));
        });
        panels.forEach(p => {
            p.classList.toggle('active', p.id === 'room-' + roomId);
        });

        if (roomId === 'workshop' && !window._workshopLoaded) {
            loadWorkshopPanel();
        }
        if (roomId === 'threshold') {
            loadThresholdList();
            checkDetectedFiles();
        }
        if (roomId === 'hearth') {
            loadHearthThreads();
            loadHearthArchive();
            refreshSystemStatus();
        }
    }

    tabs.forEach(tab => {
        tab.addEventListener('click', () => activateRoom(tab.dataset.room));
    });
})();

/* ================================================================
   Sub-Tab Switching
   ================================================================ */

(function initSubTabs() {
    document.querySelectorAll('.sub-tabs').forEach(nav => {
        const parentPanel = nav.closest('.room-panel-inner') || nav.closest('.room-panel');
        const tabs        = nav.querySelectorAll('.sub-tab');

        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                tabs.forEach(t => {
                    t.classList.toggle('active', t === tab);
                    t.setAttribute('aria-selected', String(t === tab));
                });

                const panelId = tab.dataset.subtab;

                // Search within the same room panel inner
                const root = nav.closest('.room-panel');
                root.querySelectorAll('.sub-panel').forEach(sp => {
                    sp.classList.toggle('active', sp.id === panelId);
                });

                // Lazy-load on sub-tab activation
                if (panelId === 'ws-index') {
                    loadWorkshopSources();
                    loadWorkshopNotes();
                }
                if (panelId === 'ws-cartridges' && !window._cartridgesLoaded) {
                    loadCartridgeShelf();
                }
                if (panelId === 'ws-projects') {
                    loadProjects();
                }
                if (panelId === 'ws-tools') {
                    loadWorkshopTools();
                }
                if (panelId === 'hearth-archive') {
                    loadHearthArchive();
                }
                if (panelId === 'hearth-system') {
                    refreshSystemStatus();
                    loadHearthToolRegistry();
                }
                if (panelId === 'th-ai') {
                    loadThresholdTools();
                }
            });
        });
    });
})();

/* ================================================================
   Hearth — Chat Threads
   ================================================================ */

let hearthActiveThreadId = null;

(function initHearth() {
    const sendButton   = document.getElementById('send-button');
    const messageInput = document.getElementById('message-input');
    const newThreadBtn = document.getElementById('hearth-new-thread-btn');

    if (newThreadBtn) {
        newThreadBtn.addEventListener('click', async () => {
            const title = prompt('Thread name (leave blank for default):') || 'New Thread';
            try {
                const res  = await fetch('/api/threads', {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify({ title, room: 'hearth' }),
                });
                const data = await res.json();
                if (data.success) {
                    hearthActiveThreadId = data.thread.id;
                    loadHearthThreads();
                    openThread(data.thread.id, data.thread.title);
                }
            } catch { /* ignore */ }
        });
    }

    if (sendButton) {
        sendButton.addEventListener('click', sendMessage);
    }
    if (messageInput) {
        messageInput.addEventListener('keypress', e => {
            if (e.key === 'Enter') sendMessage();
        });
    }
})();

async function loadHearthThreads() {
    const listEl = document.getElementById('hearth-thread-list');
    if (!listEl) return;

    try {
        const res  = await fetch('/api/threads?room=hearth');
        const data = await res.json();
        const threads = data.threads || [];

        if (threads.length === 0) {
            listEl.innerHTML = '<span class="message-system">No threads yet.</span>';
            return;
        }

        listEl.innerHTML = '';
        threads.forEach(t => {
            const item = document.createElement('div');
            item.className = 'thread-item' + (t.id === hearthActiveThreadId ? ' active' : '');
            item.textContent = t.title;
            item.dataset.threadId    = t.id;
            item.dataset.threadTitle = t.title;
            item.addEventListener('click', () => {
                hearthActiveThreadId = t.id;
                document.querySelectorAll('#hearth-thread-list .thread-item').forEach(el => {
                    el.classList.toggle('active', el.dataset.threadId === t.id);
                });
                openThread(t.id, t.title);
            });
            listEl.appendChild(item);
        });

        // Auto-open first thread if none active
        if (!hearthActiveThreadId && threads.length > 0) {
            hearthActiveThreadId = threads[0].id;
            openThread(threads[0].id, threads[0].title);
        }
    } catch {
        listEl.innerHTML = '<span class="message-system">Could not load threads.</span>';
    }
}

async function openThread(threadId, title) {
    const chatContainer = document.getElementById('messages');
    const titleEl       = document.getElementById('hearth-active-thread-title');

    if (titleEl) titleEl.textContent = title || 'Thread';
    if (chatContainer) chatContainer.innerHTML = '';

    try {
        const res  = await fetch('/api/threads/' + encodeURIComponent(threadId));
        const data = await res.json();
        if (data.thread && chatContainer) {
            (data.thread.messages || []).forEach(m => {
                displayMessage(chatContainer, m.content, m.role === 'user' ? 'message-user' : 'message-heart');
            });
            chatContainer.scrollTop = chatContainer.scrollHeight;
        }
    } catch { /* ignore */ }
}

function displayMessage(container, text, className) {
    const el = document.createElement('div');
    el.className = className;
    el.textContent = text;
    container.appendChild(el);
}

/* ================================================================
   Heart Loading Animation — JS-driven 29-symbol cycle
   24 Elder Futhark runes + 5 elemental symbols
   ================================================================ */

const HEART_SYMBOLS = [
    'ᚠ','ᚢ','ᚦ','ᚨ','ᚱ','ᚲ','ᚷ','ᚹ','ᚺ','ᚾ',
    'ᛁ','ᛃ','ᛈ','ᛇ','ᛉ','ᛋ','ᛏ','ᛒ','ᛖ','ᛗ',
    'ᛚ','ᛜ','ᛞ','ᛟ',
    '🜂','🜄','🜁','🜃','Æ',
];

/**
 * Start a JS-driven symbol cycle on the given element's text content.
 * Cycles through all 29 symbols at 120 ms per frame:
 *   - 24 Elder Futhark runes (ᚠ through ᛟ)
 *   - 5 elemental symbols (🜂 🜄 🜁 🜃 Æ)
 * Returns a cancel function — call it to stop the animation and avoid leaks.
 *
 * @param {HTMLElement} el  Element whose textContent will be cycled
 * @returns {() => void}    Cancel function — clears the interval
 */
function startRuneAnimation(el) {
    let idx = 0;
    el.textContent = HEART_SYMBOLS[0];
    const id = setInterval(() => {
        idx = (idx + 1) % HEART_SYMBOLS.length;
        el.textContent = HEART_SYMBOLS[idx];
    }, 120);
    return () => clearInterval(id);
}


function setTraceStatus(text) {
    const el = document.getElementById('signal-trace-status');
    if (el) el.textContent = text;
}

function renderSignalTrace(sources) {
    const traceSources = document.getElementById('signal-trace-sources');
    if (!traceSources) return;
    traceSources.innerHTML = '';

    if (!sources || sources.length === 0) {
        setTraceStatus('base model — no local sources');
        return;
    }

    const count = sources.length;
    setTraceStatus(count + ' source' + (count === 1 ? '' : 's'));

    sources.forEach(s => {
        const item = document.createElement('div');
        item.className = 'signal-trace-item';

        // Build display name from metadata if available
        const displayName = s.title || s.file;
        const shelfBadge  = s.shelf ? [{ label: 'shelf', val: s.shelf }] : [];

        const badges = [
            { label: 'room',  val: s.room },
            s.cartridgeId ? { label: 'cartridge', val: s.cartridgeId } : null,
            ...shelfBadge,
            { label: 'file',  val: displayName },
            { label: 'score', val: String(s.score) },
        ].filter(Boolean);

        item.innerHTML = badges
            .map(b =>
                '<span class="trace-badge"><span class="trace-key">' +
                escapeHtml(b.label) + '</span> ' +
                escapeHtml(b.val) + '</span>'
            )
            .join('');

        traceSources.appendChild(item);
    });

    // Auto-expand when there are sources so user can see them
    const panel  = document.getElementById('signal-trace-panel');
    const toggle = document.getElementById('signal-trace-toggle');
    if (panel && count > 0) {
        panel.classList.remove('collapsed');
        if (toggle) {
            toggle.textContent = '▾';
            toggle.setAttribute('aria-expanded', 'true');
        }
    }
}

/* Signal Trace collapse / expand toggle */
(function initSignalTraceToggle() {
    const toggle = document.getElementById('signal-trace-toggle');
    const panel  = document.getElementById('signal-trace-panel');
    if (!toggle || !panel) return;

    toggle.addEventListener('click', () => {
        const isCollapsed = panel.classList.toggle('collapsed');
        toggle.textContent = isCollapsed ? '▸' : '▾';
        toggle.setAttribute('aria-expanded', String(!isCollapsed));
    });
})();

async function sendMessage() {
    const chatContainer = document.getElementById('messages');
    const messageInput  = document.getElementById('message-input');
    const sendButton    = document.getElementById('send-button');
    if (!chatContainer || !messageInput) return;

    const message = messageInput.value.trim();
    if (!message) return;

    displayMessage(chatContainer, message, 'message-user');
    messageInput.value = '';
    chatContainer.scrollTop = chatContainer.scrollHeight;

    // Rune loading indicator — JS-driven symbol cycle
    const thinking = document.createElement('div');
    thinking.className = 'message-heart loading-rune';
    const runeSpan = document.createElement('span');
    runeSpan.className = 'rune-symbol';
    thinking.appendChild(runeSpan);
    const cancelAnim = startRuneAnimation(runeSpan);
    chatContainer.appendChild(thinking);
    chatContainer.scrollTop = chatContainer.scrollHeight;

    setTraceStatus('retrieving…');
    const traceSources = document.getElementById('signal-trace-sources');
    if (traceSources) traceSources.innerHTML = '';
    if (sendButton) sendButton.disabled = true;

    try {
        const response = await fetch('/api/chat', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
                query:     message,
                sourceIds: _chatRefs.length > 0 ? _chatRefs.map(r => r.sourceId) : undefined,
            }),
        });

        chatContainer.removeChild(thinking);
        cancelAnim();

        const data = await response.json();

        if (data && typeof data.answer === 'string') {
            displayMessage(chatContainer, data.answer, 'message-heart');
            renderSignalTrace(data.sources || []);

            // Persist to thread if active
            if (hearthActiveThreadId) {
                await saveMessageToThread(hearthActiveThreadId, 'user', message);
                await saveMessageToThread(hearthActiveThreadId, 'assistant', data.answer);
            }
        } else if (data && data.error) {
            displayMessage(chatContainer, 'The Heart returned an error: ' + data.error, 'message-heart');
            setTraceStatus('error');
        } else {
            displayMessage(chatContainer, 'The Heart returned an unreadable signal.', 'message-heart');
            setTraceStatus('unexpected response');
        }
    } catch {
        if (chatContainer.contains(thinking)) {
            chatContainer.removeChild(thinking);
            cancelAnim();
        }
        displayMessage(chatContainer, 'Error: could not reach the Heart.', 'message-heart');
        setTraceStatus('connection lost');
    } finally {
        if (sendButton) sendButton.disabled = false;
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }
}

async function saveMessageToThread(threadId, role, content) {
    try {
        await fetch('/api/threads/' + encodeURIComponent(threadId) + '/messages', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ role, content }),
        });
    } catch { /* ignore */ }
}

/* ================================================================
   Hearth — Archive (Remembered sources)
   ================================================================ */

async function loadHearthArchive() {
    const listEl = document.getElementById('hearth-archive-list');
    if (!listEl) return;

    try {
        const res  = await fetch('/api/sources?room=hearth');
        const data = await res.json();
        const sources = data.sources || [];

        if (sources.length === 0) {
            listEl.innerHTML = '<span class="message-system">No remembered sources.</span>';
            return;
        }

        listEl.innerHTML = '';
        sources.forEach(s => {
            listEl.appendChild(buildSourceCard(s));
        });
    } catch {
        listEl.innerHTML = '<span class="message-system">Could not load archive.</span>';
    }
}

/* ================================================================
   Workshop — Draft / Notepad
   ================================================================ */

(function initWorkshop() {
    const saveNoteBtn = document.getElementById('save-note-btn');
    const clearBtn    = document.getElementById('clear-draft-btn');
    const draftArea   = document.getElementById('workshop-draft');
    const statusEl    = document.getElementById('workshop-status');

    function setStatus(msg, duration) {
        if (!statusEl) return;
        statusEl.textContent = msg;
        if (duration) setTimeout(() => { statusEl.textContent = ''; }, duration);
    }

    if (saveNoteBtn) {
        saveNoteBtn.addEventListener('click', async () => {
            const text = draftArea ? draftArea.value.trim() : '';
            if (!text) { setStatus('Nothing to save.', 2000); return; }
            setStatus('Saving…');
            try {
                const res  = await fetch('/api/notes', {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify({ content: text }),
                });
                const data = await res.json();
                if (data.success) {
                    setStatus('Saved: ' + data.filename, 3500);
                } else {
                    setStatus('Save failed.', 3000);
                }
            } catch {
                setStatus('Save failed — server unreachable.', 3000);
            }
        });
    }

    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            if (draftArea) { draftArea.value = ''; }
        });
    }
})();

function loadWorkshopPanel() {
    window._workshopLoaded = true;
    // Nothing to eagerly load — panels load on sub-tab activation
}

/* ================================================================
   Workshop — Index sub-tab
   ================================================================ */

async function loadWorkshopSources() {
    const listEl = document.getElementById('ws-sources-list');
    if (!listEl) return;

    try {
        const res  = await fetch('/api/sources');
        const data = await res.json();
        const sources = data.sources || [];

        if (sources.length === 0) {
            listEl.innerHTML = '<span class="message-system">No sources indexed.</span>';
            return;
        }

        listEl.innerHTML = '';
        sources.slice(0, 30).forEach(s => {
            listEl.appendChild(buildSourceCard(s));
        });

        if (sources.length > 30) {
            const more = document.createElement('div');
            more.className = 'message-system';
            more.textContent = '…and ' + (sources.length - 30) + ' more';
            listEl.appendChild(more);
        }
    } catch {
        listEl.innerHTML = '<span class="message-system">Could not load sources.</span>';
    }
}

async function loadWorkshopNotes() {
    const listEl = document.getElementById('ws-notes-list');
    if (!listEl) return;

    try {
        const res  = await fetch('/api/notes');
        const data = await res.json();
        const notes = data.notes || [];

        if (notes.length === 0) {
            listEl.innerHTML = '<span class="message-system">No notes saved.</span>';
            return;
        }

        listEl.innerHTML = '';
        notes.slice(0, 10).forEach(n => {
            const row = document.createElement('div');
            row.className = 'ws-note-row';
            row.innerHTML =
                '<span class="ws-note-name">' + escapeHtml(n.filename) + '</span>' +
                '<span class="ws-note-size message-system">' + n.size + 'B</span>';
            listEl.appendChild(row);
        });
    } catch {
        listEl.innerHTML = '<span class="message-system">Could not load notes.</span>';
    }
}

/** Build a source card element using Phase 4 metadata fields, with action row. */
function buildSourceCard(s) {
    const card = document.createElement('div');
    card.className = 'source-card';

    const title       = s.title || s.file || '(untitled)';
    const statusClass = s.status || (s.room === 'hearth' ? 'remembered' : s.room === 'workshop' ? 'indexed' : 'waiting');
    const statusLabel = statusClass.charAt(0).toUpperCase() + statusClass.slice(1);

    let html = '<div class="source-card-title">' + escapeHtml(title) + '</div>';
    html += '<div class="source-card-meta">';
    if (s.shelf)  html += '<span class="trace-badge"><span class="trace-key">shelf</span> ' + escapeHtml(s.shelf) + '</span>';
    html += '<span class="status-badge ' + escapeHtml(statusClass) + '">' + escapeHtml(statusLabel) + '</span>';
    if (s.room)   html += '<span class="trace-badge"><span class="trace-key">room</span> ' + escapeHtml(s.room) + '</span>';
    html += '</div>';
    if (s.description) {
        html += '<div class="source-card-description">' + escapeHtml(s.description) + '</div>';
    }
    if (s.file && s.file !== title) {
        html += '<div class="source-card-filename">' + escapeHtml(s.file) + '</div>';
    }

    card.innerHTML = html;

    // Action row — only for sources with a real server-side ID
    if (s.id) {
        const actionRow = document.createElement('div');
        actionRow.className = 'source-card-actions';

        // Inspect button
        const inspBtn = document.createElement('button');
        inspBtn.className = 'secondary source-action-btn';
        inspBtn.textContent = 'Inspect';
        inspBtn.addEventListener('click', () => inspectSource(s.id));
        actionRow.appendChild(inspBtn);

        // Actions dropdown
        const dropdown = document.createElement('div');
        dropdown.className = 'source-action-dropdown';

        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'secondary source-action-btn source-dropdown-toggle';
        toggleBtn.textContent = '▾ Actions';
        dropdown.appendChild(toggleBtn);

        const menu = document.createElement('div');
        menu.className = 'source-action-menu';

        const menuItems = [];
        if (s.room !== 'hearth') {
            menuItems.push({ label: 'Remember to Hearth', fn: () => rememberSource(s.id) });
        }
        menuItems.push({ label: '→ Hearth Chat',  fn: () => sendSourceToChat(s) });
        menuItems.push({ label: '→ Notepad',       fn: () => sendSourceToNotepad(s) });
        menuItems.push({ label: '→ Project',       fn: () => attachSourceToProject(s.id, s.title || s.file) });

        menuItems.forEach(item => {
            const btn = document.createElement('button');
            btn.textContent = item.label;
            btn.addEventListener('click', () => {
                menu.classList.remove('open');
                item.fn();
            });
            menu.appendChild(btn);
        });

        dropdown.appendChild(menu);

        toggleBtn.addEventListener('click', e => {
            e.stopPropagation();
            const isOpen = menu.classList.contains('open');
            // Close all other open menus
            document.querySelectorAll('.source-action-menu.open').forEach(m => m.classList.remove('open'));
            if (!isOpen) menu.classList.add('open');
        });

        actionRow.appendChild(dropdown);
        card.appendChild(actionRow);
    }

    return card;
}

/* ================================================================
   Workshop — Cartridges sub-tab
   ================================================================ */

async function loadCartridgeShelf() {
    window._cartridgesLoaded = true;

    const listEl    = document.getElementById('cartridge-list');
    const loadingEl = document.getElementById('cartridge-loading');

    try {
        const res  = await fetch('/cartridges');
        const data = await res.json();
        const cartridges = data.cartridges || [];

        if (loadingEl) loadingEl.remove();

        if (cartridges.length === 0) {
            listEl.innerHTML = '<div class="message-system">No cartridges found.</div>';
            updateSystemCartridgeCount(0);
            return;
        }

        listEl.innerHTML = '';
        cartridges.forEach(c => {
            const item = document.createElement('div');
            item.className = 'cartridge-item';
            item.dataset.cartridgeId = c.id;
            item.innerHTML =
                '<div class="cartridge-item-name">' + escapeHtml(c.name) + '</div>' +
                '<div class="cartridge-item-type">' + escapeHtml(c.type || 'cartridge') + '</div>';
            item.addEventListener('click', () => inspectCartridge(c.id, item));
            listEl.appendChild(item);
        });

        updateSystemCartridgeCount(cartridges.length);
    } catch {
        if (loadingEl) loadingEl.remove();
        if (listEl) listEl.innerHTML = '<div class="message-system">Could not load cartridges.</div>';
    }

    // Also load user cartridges
    loadUserCartridges();
}

async function loadUserCartridges() {
    const listEl = document.getElementById('user-cartridge-list');
    if (!listEl) return;

    try {
        const res  = await fetch('/api/user-cartridges');
        const data = await res.json();
        const cartridges = data.cartridges || [];

        if (cartridges.length === 0) {
            listEl.innerHTML = '<span class="message-system">None created yet.</span>';
            return;
        }

        listEl.innerHTML = '';
        cartridges.forEach(c => {
            const item = document.createElement('div');
            item.className = 'cartridge-item';
            item.innerHTML =
                '<div class="cartridge-item-name">' + escapeHtml(c.title) + '</div>' +
                '<div class="cartridge-item-type">user cartridge</div>';
            item.addEventListener('click', () => inspectUserCartridge(c));
            listEl.appendChild(item);
        });
    } catch {
        listEl.innerHTML = '<span class="message-system">Could not load.</span>';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const newCartridgeBtn = document.getElementById('new-cartridge-btn');
    if (newCartridgeBtn) {
        newCartridgeBtn.addEventListener('click', async () => {
            const title = prompt('Cartridge title:');
            if (!title) return;
            const description = prompt('Short description (optional):') || '';
            try {
                const res  = await fetch('/api/user-cartridges', {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify({ title, description }),
                });
                const data = await res.json();
                if (data.success) loadUserCartridges();
            } catch { /* ignore */ }
        });
    }
});

function inspectUserCartridge(c) {
    const emptyEl     = document.getElementById('inspector-empty');
    const contentArea = document.getElementById('inspector-content-area');
    const nameEl      = document.getElementById('inspector-name');
    const descEl      = document.getElementById('inspector-description');
    const metaEl      = document.getElementById('inspector-meta');
    const permsEl     = document.getElementById('inspector-perms');
    const contentEl   = document.getElementById('inspector-content');

    if (emptyEl) emptyEl.style.display = 'none';
    if (contentArea) contentArea.style.display = 'flex';
    if (nameEl) nameEl.textContent = c.title;
    if (descEl) descEl.textContent = c.description || '';
    if (metaEl) metaEl.innerHTML = '<span class="meta-badge"><strong>user</strong>&nbsp;cartridge</span>';
    if (permsEl) permsEl.innerHTML = '';
    if (contentEl) contentEl.textContent = c.notes || '(no notes)';
}

async function inspectCartridge(id, itemEl) {
    document.querySelectorAll('.cartridge-item').forEach(el => {
        el.classList.toggle('active', el === itemEl);
    });

    const emptyEl     = document.getElementById('inspector-empty');
    const contentArea = document.getElementById('inspector-content-area');
    const nameEl      = document.getElementById('inspector-name');
    const descEl      = document.getElementById('inspector-description');
    const metaEl      = document.getElementById('inspector-meta');
    const permsEl     = document.getElementById('inspector-perms');
    const contentEl   = document.getElementById('inspector-content');

    if (emptyEl) emptyEl.style.display = 'none';
    if (contentArea) contentArea.style.display = 'flex';
    if (nameEl) nameEl.textContent = '';
    if (descEl) descEl.textContent = '';
    if (metaEl) metaEl.innerHTML = '';
    if (permsEl) permsEl.innerHTML = '';
    if (contentEl) {
        contentEl.textContent = '';
        const loading = document.createElement('span');
        loading.className = 'loading-rune';
        loading.textContent = 'Loading';
        contentEl.appendChild(loading);
    }

    try {
        const res  = await fetch('/cartridges/' + encodeURIComponent(id));
        const data = await res.json();
        const m    = data.manifest || {};

        if (nameEl) nameEl.textContent = m.name || data.name || id;
        if (descEl) descEl.textContent = m.description || '';

        if (metaEl) {
            const badges = [];
            if (m.version) badges.push({ label: 'version', val: m.version });
            if (m.type)    badges.push({ label: 'type',    val: m.type });
            if (m.id)      badges.push({ label: 'id',      val: m.id });
            metaEl.innerHTML = badges
                .map(b =>
                    '<span class="meta-badge"><strong>' + escapeHtml(b.val) + '</strong>&nbsp;' +
                    escapeHtml(b.label) + '</span>'
                )
                .join('');
        }

        if (permsEl && m.permissions) {
            const perms = m.permissions;
            const items = [];
            if (perms.writeHearth === false)  items.push({ label: 'no Hearth write', denied: true });
            if (perms.networkAccess === false) items.push({ label: 'no network access', denied: true });
            if (perms.writeHearth === true)    items.push({ label: 'Hearth write allowed', denied: false });
            if (perms.networkAccess === true)  items.push({ label: 'network access allowed', denied: false });
            permsEl.innerHTML = items
                .map(p =>
                    '<span class="perm-badge ' + (p.denied ? 'denied' : '') + '">' +
                    escapeHtml(p.label) + '</span>'
                )
                .join('');
        }

        if (contentEl) {
            contentEl.textContent = data.content || '(no readable documents in this cartridge)';
        }
    } catch {
        if (contentEl) contentEl.textContent = 'Error loading cartridge content.';
    }
}

/* ================================================================
   Workshop — Projects sub-tab
   ================================================================ */

let activeProjectId = null;

(function initProjects() {
    document.addEventListener('DOMContentLoaded', () => {
        const newProjectBtn = document.getElementById('new-project-btn');
        const saveBtn       = document.getElementById('save-project-btn');

        if (newProjectBtn) {
            newProjectBtn.addEventListener('click', async () => {
                const title = prompt('Project title:');
                if (!title) return;
                try {
                    const res  = await fetch('/api/projects', {
                        method:  'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body:    JSON.stringify({ title }),
                    });
                    const data = await res.json();
                    if (data.success) {
                        activeProjectId = data.project.id;
                        loadProjects();
                        openProject(data.project);
                    }
                } catch { /* ignore */ }
            });
        }

        if (saveBtn) {
            saveBtn.addEventListener('click', async () => {
                if (!activeProjectId) return;
                const titleInput = document.getElementById('project-title-input');
                const notesInput = document.getElementById('project-notes-input');
                const statusEl   = document.getElementById('project-status');
                const title      = titleInput ? titleInput.value.trim() : '';
                const notes      = notesInput ? notesInput.value : '';

                function setProjectStatus(msg, duration) {
                    if (!statusEl) return;
                    statusEl.textContent = msg;
                    if (duration) setTimeout(() => { statusEl.textContent = ''; }, duration);
                }

                if (!title) {
                    setProjectStatus('Title required.', 2000);
                    return;
                }

                try {
                    await fetch('/api/projects/' + encodeURIComponent(activeProjectId), {
                        method:  'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body:    JSON.stringify({ title, notes }),
                    });
                    setProjectStatus('Saved.', 2000);
                    loadProjects();
                } catch {
                    setProjectStatus('Save failed.', 2000);
                }
            });
        }
    });
})();

async function loadProjects() {
    const listEl = document.getElementById('project-list');
    if (!listEl) return;

    try {
        const res  = await fetch('/api/projects');
        const data = await res.json();
        const projects = data.projects || [];

        if (projects.length === 0) {
            listEl.innerHTML = '<span class="message-system">No projects yet.</span>';
            return;
        }

        listEl.innerHTML = '';
        projects.forEach(p => {
            const item = document.createElement('div');
            item.className = 'project-item' + (p.id === activeProjectId ? ' active' : '');
            item.textContent = p.title;
            item.dataset.projectId = p.id;
            item.addEventListener('click', () => {
                activeProjectId = p.id;
                document.querySelectorAll('.project-item').forEach(el => {
                    el.classList.toggle('active', el.dataset.projectId === p.id);
                });
                openProject(p);
            });
            listEl.appendChild(item);
        });
    } catch {
        listEl.innerHTML = '<span class="message-system">Could not load projects.</span>';
    }
}

function openProject(project) {
    const emptyEl      = document.getElementById('project-empty');
    const editorEl     = document.getElementById('project-editor');
    const titleInput   = document.getElementById('project-title-input');
    const notesInput   = document.getElementById('project-notes-input');

    if (emptyEl)    emptyEl.style.display = 'none';
    if (editorEl)   editorEl.style.display = 'flex';
    if (titleInput) titleInput.value = project.title || '';
    if (notesInput) notesInput.value = project.notes || '';

    activeProjectId = project.id;
    loadProjectSources(project.id);
}

/* ================================================================
   Threshold — Multi-file Intake Queue
   ================================================================ */

/**
 * In-memory intake queue.  Each entry:
 *   { file, name, status, error, title, description, shelf }
 * status: 'pending' | 'importing' | 'imported' | 'failed'
 */
let _intakeQueue = [];
let _importingAll = false;

const INTAKE_SUPPORTED = new Set(['.txt', '.md', '.pdf', '.docx']);

/** Derive a readable title from a filename. */
function fileBaseName(name) {
    const parts = name.split('.');
    const base  = parts.length > 1 && parts[0] !== '' ? parts.slice(0, -1).join('.') : name;
    return base.replace(/[_-]+/g, ' ').trim();
}

/** Read a File into a base64 or UTF-8 string suitable for /api/ingest. */
function readFileForIngest(file) {
    return new Promise((resolve) => {
        const ext      = file.name.split('.').pop().toLowerCase();
        const isBinary = ext === 'pdf' || ext === 'docx';
        const reader   = new FileReader();

        reader.onload = (e) => {
            if (isBinary) {
                const bytes  = new Uint8Array(e.target.result);
                const binary = Array.from(bytes, b => String.fromCharCode(b)).join('');
                resolve({ content: btoa(binary), encoding: 'base64' });
            } else {
                resolve({ content: e.target.result, encoding: 'utf8' });
            }
        };
        reader.onerror = () => resolve(null);

        if (isBinary) {
            reader.readAsArrayBuffer(file);
        } else {
            reader.readAsText(file);
        }
    });
}

/** POST a single queue entry to /api/ingest.  Updates entry.status in place. */
async function ingestQueueEntry(entry) {
    entry.status = 'importing';
    renderIntakeQueue();

    const read = await readFileForIngest(entry.file);
    if (!read) {
        entry.status = 'failed';
        entry.error  = 'Could not read file';
        renderIntakeQueue();
        return;
    }

    try {
        const res  = await fetch('/api/ingest', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
                filename:    entry.file.name,
                content:     read.content,
                room:        'threshold',
                title:       entry.title,
                description: entry.description,
                shelf:       entry.shelf,
                encoding:    read.encoding,
            }),
        });
        const data = await res.json();
        if (data.success) {
            entry.status = 'imported';
            entry.error  = null;
        } else {
            entry.status = 'failed';
            entry.error  = data.error || 'Ingestion failed';
        }
    } catch {
        entry.status = 'failed';
        entry.error  = 'Server unreachable';
    }
    renderIntakeQueue();
}

/** Render the intake queue UI from _intakeQueue state. Handles all entry statuses. */
function renderIntakeQueue() {
    const queueSection  = document.getElementById('threshold-queue-section');
    const queueEl       = document.getElementById('threshold-intake-queue');
    const progressEl    = document.getElementById('threshold-batch-progress');
    const importAllBtn  = document.getElementById('threshold-import-all-btn');
    const clearQueueBtn = document.getElementById('threshold-clear-queue-btn');

    if (!queueEl) return;

    if (_intakeQueue.length === 0) {
        if (queueSection) queueSection.style.display = 'none';
        return;
    }

    if (queueSection) queueSection.style.display = '';

    // Batch progress (only count file-upload entries, not server-detected ones)
    const uploadEntries = _intakeQueue.filter(e => e.file !== null);
    const total    = uploadEntries.length;
    const imported = _intakeQueue.filter(e => e.status === 'imported').length;
    const failed   = _intakeQueue.filter(e => e.status === 'failed').length;
    const active   = _intakeQueue.filter(e => e.status === 'importing').length;
    const allTotal = _intakeQueue.length;

    if (progressEl) {
        if (active > 0) {
            progressEl.textContent = (imported + failed) + ' of ' + allTotal + ' processing…';
        } else if (total > 0 && imported + failed === allTotal) {
            const msg = failed > 0
                ? imported + ' imported, ' + failed + ' failed'
                : imported + ' imported';
            progressEl.textContent = msg;
        } else {
            progressEl.textContent = allTotal + ' file' + (allTotal === 1 ? '' : 's') + ' queued';
        }
    }

    // Disable controls while importing
    if (importAllBtn)  importAllBtn.disabled  = _importingAll;
    if (clearQueueBtn) clearQueueBtn.disabled = _importingAll;

    const BADGE_LABELS = {
        pending:   'Pending',
        importing: 'Importing…',
        imported:  'Imported',
        failed:    'Failed',
        detected:  'Detected',
        changed:   'Changed',
    };

    // Render rows
    queueEl.innerHTML = '';
    _intakeQueue.forEach((entry, idx) => {
        const row = document.createElement('div');
        row.className = 'threshold-queue-entry status-' + entry.status;

        // Left: filename + note + editable fields
        const meta = document.createElement('div');
        meta.className = 'tq-meta';

        const fname = document.createElement('div');
        fname.className = 'tq-filename';
        fname.textContent = entry.name;
        if (entry.room && entry.room !== 'threshold') {
            const roomBadge = document.createElement('span');
            roomBadge.className   = 'trace-badge';
            roomBadge.textContent = entry.room;
            fname.appendChild(document.createTextNode(' '));
            fname.appendChild(roomBadge);
        }
        meta.appendChild(fname);

        if (entry.status === 'changed') {
            const note = document.createElement('div');
            note.className   = 'tq-changed-note';
            note.textContent = 'Changed since last import';
            meta.appendChild(note);
        }

        // Show editable fields for pending and detected entries
        if (entry.status === 'pending' || entry.status === 'detected') {
            const fields = document.createElement('div');
            fields.className = 'tq-fields';

            const titleInput = document.createElement('input');
            titleInput.type        = 'text';
            titleInput.className   = 'tq-input';
            titleInput.placeholder = 'Title';
            titleInput.value       = entry.title;
            titleInput.setAttribute('aria-label', 'Title for ' + entry.name);
            titleInput.addEventListener('input', () => { entry.title = titleInput.value; });

            const descInput = document.createElement('input');
            descInput.type        = 'text';
            descInput.className   = 'tq-input';
            descInput.placeholder = 'Description (optional)';
            descInput.value       = entry.description;
            descInput.setAttribute('aria-label', 'Description for ' + entry.name);
            descInput.addEventListener('input', () => { entry.description = descInput.value; });

            const shelfInput = document.createElement('input');
            shelfInput.type        = 'text';
            shelfInput.className   = 'tq-input tq-input-shelf';
            shelfInput.placeholder = 'Shelf / Category (optional)';
            shelfInput.value       = entry.shelf;
            shelfInput.setAttribute('aria-label', 'Shelf for ' + entry.name);
            shelfInput.addEventListener('input', () => { entry.shelf = shelfInput.value; });

            fields.appendChild(titleInput);
            fields.appendChild(descInput);
            fields.appendChild(shelfInput);
            meta.appendChild(fields);
        }

        if (entry.error) {
            const errEl = document.createElement('div');
            errEl.className   = 'tq-error';
            errEl.textContent = entry.error;
            meta.appendChild(errEl);
        }

        // Right: status badge + action buttons
        const aside = document.createElement('div');
        aside.className = 'tq-aside';

        const badge = document.createElement('span');
        badge.className   = 'status-badge ' + entry.status;
        badge.textContent = BADGE_LABELS[entry.status] || entry.status;
        aside.appendChild(badge);

        // Action: import a single pending (from file drop)
        if (entry.status === 'pending' && entry.file && !_importingAll) {
            const importOneBtn = document.createElement('button');
            importOneBtn.className   = 'secondary tq-action-btn';
            importOneBtn.textContent = 'Import';
            importOneBtn.addEventListener('click', async () => {
                await ingestQueueEntry(entry);
                loadThresholdList();
            });
            aside.appendChild(importOneBtn);
        }

        // Action: import a detected (server-side) file
        if (entry.status === 'detected' && !_importingAll) {
            const importBtn = document.createElement('button');
            importBtn.className   = 'secondary tq-action-btn';
            importBtn.textContent = 'Import';
            importBtn.addEventListener('click', async () => {
                entry.status = 'importing';
                renderIntakeQueue();
                try {
                    const r = await fetch('/api/detected-files/import', {
                        method:  'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body:    JSON.stringify({
                            filename:    entry.name,
                            room:        entry.room,
                            title:       entry.title,
                            description: entry.description,
                            shelf:       entry.shelf,
                        }),
                    });
                    const d = await r.json();
                    entry.status = d.success ? 'imported' : 'failed';
                    entry.error  = d.success ? null : (d.error || 'Import failed');
                } catch {
                    entry.status = 'failed';
                    entry.error  = 'Server unreachable';
                }
                renderIntakeQueue();
                loadThresholdList();
            });
            aside.appendChild(importBtn);
        }

        // Actions: re-import or keep current for changed files
        if (entry.status === 'changed' && !_importingAll) {
            const reImportBtn = document.createElement('button');
            reImportBtn.className   = 'secondary tq-action-btn';
            reImportBtn.textContent = 'Re-import';
            reImportBtn.title       = 'Re-index with updated file content';
            reImportBtn.addEventListener('click', async () => {
                if (!entry.sourceId) return;
                reImportBtn.disabled = true;
                entry.status = 'importing';
                renderIntakeQueue();
                try {
                    const r = await fetch('/api/index/file', {
                        method:  'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body:    JSON.stringify({ sourceId: entry.sourceId }),
                    });
                    const d = await r.json();
                    entry.status = d.success ? 'imported' : 'failed';
                    entry.error  = d.success ? null : (d.error || 'Re-import failed');
                } catch {
                    entry.status = 'failed';
                    entry.error  = 'Server unreachable';
                }
                renderIntakeQueue();
                loadThresholdList();
            });

            const keepBtn = document.createElement('button');
            keepBtn.className   = 'secondary tq-action-btn';
            keepBtn.textContent = 'Keep current';
            keepBtn.title       = 'Mark as reviewed — keep existing indexed version';
            keepBtn.addEventListener('click', async () => {
                keepBtn.disabled = true;
                try {
                    await fetch('/api/detected-files/acknowledge', {
                        method:  'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body:    JSON.stringify({ sourceId: entry.sourceId }),
                    });
                } catch { /* ignore */ }
                _intakeQueue = _intakeQueue.filter(e => e !== entry);
                renderIntakeQueue();
            });

            aside.appendChild(reImportBtn);
            aside.appendChild(keepBtn);
        }

        // Action: retry failed entries
        if (entry.status === 'failed' && !_importingAll) {
            const retryBtn = document.createElement('button');
            retryBtn.className   = 'secondary tq-action-btn';
            retryBtn.textContent = 'Retry';
            retryBtn.addEventListener('click', () => {
                entry.status = 'pending';
                entry.error  = null;
                renderIntakeQueue();
            });
            aside.appendChild(retryBtn);
        }

        // Action: remove any non-importing entry from the queue
        if (['pending', 'detected', 'changed', 'failed', 'imported'].includes(entry.status) && !_importingAll) {
            const removeBtn = document.createElement('button');
            removeBtn.className   = 'secondary tq-action-btn tq-remove-btn';
            removeBtn.textContent = '✕';
            removeBtn.title       = 'Remove from queue';
            removeBtn.addEventListener('click', () => {
                _intakeQueue = _intakeQueue.filter(e => e !== entry);
                renderIntakeQueue();
            });
            aside.appendChild(removeBtn);
        }

        row.appendChild(meta);
        row.appendChild(aside);
        queueEl.appendChild(row);
    });
}


/** Add files to the intake queue (deduplicated by name). */
function enqueueFiles(files) {
    const statusEl = document.getElementById('threshold-status');
    const unsupported = [];

    Array.from(files).forEach(f => {
        const ext = '.' + f.name.split('.').pop().toLowerCase();
        if (!INTAKE_SUPPORTED.has(ext)) {
            unsupported.push(f.name);
            return;
        }
        // Deduplicate by filename
        if (_intakeQueue.some(e => e.name === f.name)) return;
        _intakeQueue.push({
            file:        f,
            name:        f.name,
            status:      'pending',
            error:       null,
            title:       fileBaseName(f.name),
            description: '',
            shelf:       '',
        });
    });

    if (unsupported.length > 0 && statusEl) {
        statusEl.textContent = 'Unsupported: ' + unsupported.join(', ');
        statusEl.className   = 'threshold-status threshold-error';
        setTimeout(() => {
            statusEl.textContent = '';
            statusEl.className   = 'threshold-status';
        }, 5000);
    }

    renderIntakeQueue();
}

(function initThreshold() {
    const dropZone      = document.getElementById('threshold-drop-zone');
    const fileInput     = document.getElementById('threshold-file-input');
    const importAllBtn  = document.getElementById('threshold-import-all-btn');
    const clearQueueBtn = document.getElementById('threshold-clear-queue-btn');

    if (dropZone) {
        dropZone.addEventListener('dragover', e => {
            e.preventDefault();
            dropZone.classList.add('drag-over');
        });
        dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
        dropZone.addEventListener('drop', e => {
            e.preventDefault();
            dropZone.classList.remove('drag-over');
            enqueueFiles(e.dataTransfer.files);
        });
        dropZone.addEventListener('click', e => {
            if (e.target !== fileInput && !e.target.htmlFor) {
                fileInput && fileInput.click();
            }
        });
        dropZone.addEventListener('keypress', e => {
            if (e.key === 'Enter' || e.key === ' ') fileInput && fileInput.click();
        });
    }

    if (fileInput) {
        fileInput.addEventListener('change', () => {
            if (fileInput.files.length) enqueueFiles(fileInput.files);
            fileInput.value = '';
        });
    }

    if (importAllBtn) {
        importAllBtn.addEventListener('click', async () => {
            if (_importingAll) return;
            const pending = _intakeQueue.filter(e => e.status === 'pending');
            if (pending.length === 0) return;

            _importingAll = true;
            renderIntakeQueue();

            // Process sequentially for clarity and responsiveness
            for (const entry of pending) {
                if (entry.status !== 'pending') continue;
                await ingestQueueEntry(entry);
            }

            _importingAll = false;
            renderIntakeQueue();
            loadThresholdList();
        });
    }

    if (clearQueueBtn) {
        clearQueueBtn.addEventListener('click', () => {
            if (_importingAll) return;
            _intakeQueue = [];
            renderIntakeQueue();
        });
    }
})();

/* ================================================================
   Detected Files — Local File Detection
   ================================================================ */

/** Session-dismissed detected-file paths (so repeated notices aren't annoying). */
let _dismissedDetected = new Set();

/**
 * Check for locally-detected files (unmanaged or changed).
 * Shows a notice banner if any are found.
 */
async function checkDetectedFiles() {
    try {
        const res  = await fetch('/api/detected-files');
        const data = await res.json();

        const unmanaged = (data.unmanaged || []).filter(f => !_dismissedDetected.has(f.path));
        const changed   = (data.changed   || []).filter(f => !_dismissedDetected.has(f.path));
        const total     = unmanaged.length + changed.length;

        const notice     = document.getElementById('detected-notice');
        const noticeText = document.getElementById('detected-notice-text');
        const reviewBtn  = document.getElementById('detected-review-btn');
        const dismissBtn = document.getElementById('detected-dismiss-btn');

        if (!notice) return;

        if (total === 0) {
            notice.style.display = 'none';
            return;
        }

        const parts = [];
        if (unmanaged.length > 0) {
            parts.push(unmanaged.length + ' new file' + (unmanaged.length === 1 ? '' : 's') + ' detected in local storage');
        }
        if (changed.length > 0) {
            parts.push(changed.length + ' file' + (changed.length === 1 ? '' : 's') + ' changed since last import');
        }
        if (noticeText) noticeText.textContent = parts.join(' · ');

        notice.style.display = 'flex';

        // Review: load detected files into the intake queue
        if (reviewBtn) {
            // Clone button to remove old listeners
            const newBtn = reviewBtn.cloneNode(true);
            reviewBtn.parentNode.replaceChild(newBtn, reviewBtn);
            newBtn.addEventListener('click', () => {
                loadDetectedIntoQueue(unmanaged, changed);
                notice.style.display = 'none';
            });
        }

        // Dismiss: hide for this session
        if (dismissBtn) {
            const newDismiss = dismissBtn.cloneNode(true);
            dismissBtn.parentNode.replaceChild(newDismiss, dismissBtn);
            newDismiss.addEventListener('click', () => {
                [...unmanaged, ...changed].forEach(f => _dismissedDetected.add(f.path));
                notice.style.display = 'none';
            });
        }
    } catch { /* server unreachable — fail silently */ }
}

/**
 * Load detected files into the intake queue section.
 * Unmanaged files get a full queue entry.
 * Changed files get a "changed" queue entry with options.
 */
function loadDetectedIntoQueue(unmanaged, changed) {
    // Scroll to queue section
    const queueSection = document.getElementById('threshold-queue-section');

    // Add unmanaged as pending queue entries (no File object — server-side import)
    unmanaged.forEach(f => {
        if (_intakeQueue.some(e => e.name === f.filename)) return;
        _intakeQueue.push({
            file:        null,   // no File object — already on disk
            name:        f.filename,
            path:        f.path,
            room:        f.room,
            status:      'detected',
            error:       null,
            title:       fileBaseName(f.filename),
            description: '',
            shelf:       '',
        });
    });

    // Add changed files as 'changed' entries with context
    changed.forEach(f => {
        if (_intakeQueue.some(e => e.name === f.filename)) return;
        _intakeQueue.push({
            file:        null,
            name:        f.filename,
            path:        f.path,
            room:        f.room,
            sourceId:    f.sourceId,
            status:      'changed',
            error:       null,
            title:       f.title       || fileBaseName(f.filename),
            description: f.description || '',
            shelf:       f.shelf       || '',
        });
    });

    renderIntakeQueue();

    if (queueSection) {
        queueSection.style.display = '';
        queueSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

async function loadThresholdList() {
    const listEl = document.getElementById('threshold-file-list');
    if (!listEl) return;

    let files     = [];
    let changedPaths = new Set();

    try {
        const [listRes, detectedRes] = await Promise.all([
            fetch('/api/threshold/list'),
            fetch('/api/detected-files'),
        ]);
        const listData     = await listRes.json();
        const detectedData = await detectedRes.json();
        files = listData.files || [];
        (detectedData.changed || []).forEach(f => changedPaths.add(f.path));
    } catch {
        listEl.innerHTML = '<span class="message-system threshold-error">Could not load Threshold files.</span>';
        return;
    }

    if (files.length === 0) {
        listEl.innerHTML = '<span class="message-system">No files in Threshold.</span>';
        return;
    }

    listEl.innerHTML = '';

    // Split into sections
    const flaggedFiles  = files.filter(f => f.status === 'flagged');
    const changedFiles  = files.filter(f => changedPaths.has(f.path));
    const waitingFiles  = files.filter(f =>
        (!f.status || f.status === 'waiting') && !changedPaths.has(f.path)
    );
    const otherFiles    = files.filter(f =>
        f.status && f.status !== 'waiting' && f.status !== 'flagged' && !changedPaths.has(f.path)
    );

    function renderSection(title, items) {
        if (items.length === 0) return;

        const header = document.createElement('div');
        header.className = 'threshold-section-header';
        header.textContent = title + ' (' + items.length + ')';
        listEl.appendChild(header);

        items.forEach(f => listEl.appendChild(buildThresholdFileRow(f, changedPaths.has(f.path))));
    }

    renderSection('Flagged', flaggedFiles);
    renderSection('Changed', changedFiles);
    renderSection('Waiting', waitingFiles);
    if (otherFiles.length > 0) {
        renderSection('Other', otherFiles);
    }
}

/** Build a single threshold file row with flag/unflag and action buttons. */
function buildThresholdFileRow(f, isChanged) {
    const row = document.createElement('div');
    row.className = 'threshold-file-row';

    const titleText = f.title || f.filename;

    const nameEl = document.createElement('div');
    nameEl.style.cssText = 'flex:1; min-width:0;';

    let nameHtml = '<div class="threshold-file-name">' + escapeHtml(titleText);
    if (f.status === 'flagged') {
        nameHtml += ' <span class="status-badge flagged">Flagged</span>';
    } else if (isChanged) {
        nameHtml += ' <span class="status-badge changed">Changed</span>';
    }
    nameHtml += '</div>';

    if (f.shelf) {
        nameHtml += '<div class="source-card-filename">Shelf: ' + escapeHtml(f.shelf) + '</div>';
    }
    if (f.description) {
        nameHtml += '<div class="source-card-description">' + escapeHtml(f.description) + '</div>';
    }
    nameHtml += '<div class="source-card-filename">' + escapeHtml(f.filename) + '</div>';
    nameEl.innerHTML = nameHtml;

    const actions = document.createElement('span');
    actions.className = 'threshold-file-actions';

    // Status badge (for non-flagged files)
    if (f.status && f.status !== 'flagged') {
        const statusBadge = document.createElement('span');
        statusBadge.className = 'status-badge ' + (f.status || 'waiting');
        statusBadge.textContent = (f.status || 'waiting').charAt(0).toUpperCase() + (f.status || 'waiting').slice(1);
        actions.appendChild(statusBadge);
    }

    // Flag / Unflag button (only for threshold files with a sourceId)
    if (f.sourceId) {
        const flagBtn = document.createElement('button');
        flagBtn.className = 'secondary threshold-action-btn';
        if (f.status === 'flagged') {
            flagBtn.textContent = 'Unflag';
            flagBtn.title = 'Remove flag — return to Waiting';
            flagBtn.addEventListener('click', () => flagSource(f.sourceId, false));
        } else {
            flagBtn.textContent = 'Flag';
            flagBtn.title = 'Flag for review';
            flagBtn.addEventListener('click', () => flagSource(f.sourceId, true));
        }
        actions.appendChild(flagBtn);
    }

    // Index and move buttons (only for non-metaOnly files with a sourceId)
    if (!f.metaOnly && f.sourceId) {
        const indexBtn = document.createElement('button');
        indexBtn.className = 'secondary threshold-action-btn';
        indexBtn.textContent = 'Index';
        indexBtn.addEventListener('click', async () => {
            indexBtn.disabled = true;
            indexBtn.textContent = 'Indexing…';
            try {
                const r    = await fetch('/api/index/file', {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify({ sourceId: f.sourceId }),
                });
                const d = await r.json();
                if (d.success) {
                    indexBtn.textContent = 'Indexed';
                    refreshSystemStatus();
                    loadThresholdList();
                } else {
                    indexBtn.textContent = 'Failed';
                    indexBtn.title = d.error || 'Indexing failed';
                    indexBtn.disabled = false;
                }
            } catch {
                indexBtn.textContent = 'Error';
                indexBtn.disabled = false;
            }
        });

        const moveBtn = document.createElement('button');
        moveBtn.className = 'secondary threshold-action-btn';
        moveBtn.textContent = '→ Workshop';
        moveBtn.addEventListener('click', async () => {
            if (!f.sourceId) return;
            moveBtn.disabled = true;
            try {
                const r = await fetch('/api/index/file', {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify({ sourceId: f.sourceId, targetRoom: 'workshop' }),
                });
                const d = await r.json();
                if (d.success) {
                    moveBtn.textContent = '✓ Workshop';
                    loadThresholdList();
                } else {
                    moveBtn.disabled = false;
                }
            } catch {
                moveBtn.disabled = false;
            }
        });

        actions.appendChild(indexBtn);
        actions.appendChild(moveBtn);
    }

    row.appendChild(nameEl);
    row.appendChild(actions);
    return row;
}

/* ================================================================
   System Status
   ================================================================ */

async function refreshSystemStatus() {
    const ollamaEl  = document.getElementById('sys-ollama-status');
    const modelEl   = document.getElementById('sys-model');
    const chunksEl  = document.getElementById('sys-indexed-chunks');
    const sourcesEl = document.getElementById('sys-indexed-sources');

    try {
        const res  = await fetch('/api/status');
        const data = await res.json();
        if (modelEl)   modelEl.textContent   = data.model || MODEL_LABEL;
        if (chunksEl)  chunksEl.textContent  = String(data.indexedChunks  ?? 0);
        if (sourcesEl) sourcesEl.textContent = String(data.indexedSources ?? 0);
        updateSystemCartridgeCount(data.cartridgeCount ?? 0);
    } catch {
        if (modelEl) modelEl.textContent = MODEL_LABEL;
    }

    if (ollamaEl) {
        ollamaEl.textContent = 'checking…';
        ollamaEl.className   = 'system-val';
    }

    try {
        const res = await fetch('/api/ollama-status');
        if (ollamaEl) {
            if (res.ok) {
                ollamaEl.textContent = 'reachable';
                ollamaEl.className   = 'system-val ok';
            } else {
                ollamaEl.textContent = 'unreachable';
                ollamaEl.className   = 'system-val error';
            }
        }
    } catch {
        if (ollamaEl) {
            ollamaEl.textContent = 'unreachable';
            ollamaEl.className   = 'system-val error';
        }
    }

    updateHeaderStatus();
}

function updateSystemCartridgeCount(count) {
    const el = document.getElementById('sys-cartridge-count');
    if (el) el.textContent = String(count);
}

/* ================================================================
   Header Status Pill
   ================================================================ */

function updateHeaderStatus() {
    const dot   = document.getElementById('status-dot');
    const label = document.getElementById('model-label');
    if (label) label.textContent = MODEL_LABEL + ' · local';
    if (dot)   dot.className = 'status-dot';
}

/* ================================================================
   Phase 7 — Tool Registry: Discovery, Trust, Role, Heart
   ================================================================ */

/**
 * Fetch all tools from the registry.
 * @returns {Promise<{ tools: object[], active: object }>}
 */
async function fetchToolRegistry() {
    const res  = await fetch('/api/tools');
    const data = await res.json();
    return { tools: data.tools || [], active: data.active || {} };
}

/**
 * Trigger a discovery scan.
 * @returns {Promise<{ tools: object[], active: object }>}
 */
async function scanTools() {
    const res  = await fetch('/api/tools/scan', { method: 'POST' });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Scan failed');
    return { tools: data.tools || [], active: data.active || {} };
}

/** Status label for a tool lifecycle state */
function toolStatusLabel(tool) {
    if (tool.trusted && tool.role) return 'Assigned';
    if (tool.trusted)              return 'Trusted';
    if (tool.status === 'detected') return 'Waiting';
    return tool.status || 'Unknown';
}

/** CSS class for tool status badge */
function toolStatusClass(tool) {
    if (tool.trusted && tool.role) return 'indexed';
    if (tool.trusted)              return 'indexed';
    if (tool.status === 'detected') return 'waiting';
    return 'warn';
}

/** Running/offline badge HTML for a tool */
function toolRunningBadge(tool) {
    if (tool.status === 'not_detected' || tool.status === 'unknown') return '';
    if (tool.running === true)  return ' <span class="status-badge running">Running</span>';
    if (tool.running === false) return ' <span class="status-badge offline">Offline</span>';
    return '';
}

/** Human-readable role label */
function roleLabel(role) {
    if (role === 'mirror') return 'Mythic Mirror';
    if (role === 'forge')  return 'Forge Node';
    return 'Unclassified';
}

/* ── Threshold / AI tab ─────────────────────────────────────── */

/**
 * Load and render the Threshold → AI tool list.
 * Shows detected tools that are not yet trusted.
 */
async function loadThresholdTools() {
    const listEl   = document.getElementById('th-tool-list');
    const guideEl  = document.getElementById('th-ai-setup-guide');
    if (!listEl) return;
    listEl.innerHTML = '<span class="message-system">Loading…</span>';

    try {
        const { tools, active } = await fetchToolRegistry();

        // Show all non-trusted detected tools (+ not_detected as dim)
        const visible = tools.filter(t => !t.trusted);

        // Show guided setup if no running tools
        const anyRunning = tools.some(t => t.running === true);
        if (guideEl) guideEl.style.display = anyRunning ? 'none' : 'flex';

        if (visible.length === 0) {
            listEl.innerHTML = '<span class="message-system">No untrusted tools. All detected tools have been admitted.</span>';
            return;
        }

        listEl.innerHTML = '';
        visible.forEach(tool => renderThresholdToolRow(tool, active, listEl));
    } catch {
        listEl.innerHTML = '<span class="message-system threshold-error">Could not load tools.</span>';
    }
}

function renderThresholdToolRow(tool, active, container) {
    const row = document.createElement('div');
    row.className = 'threshold-file-row';
    row.dataset.toolId = tool.id;

    const nameEl = document.createElement('div');
    nameEl.style.cssText = 'flex:1; min-width:0;';
    nameEl.innerHTML =
        '<div class="threshold-file-name">' + escapeHtml(tool.name) +
            ' <span class="status-badge ' + toolStatusClass(tool) + '">' +
            escapeHtml(toolStatusLabel(tool)) + '</span>' +
            toolRunningBadge(tool) +
            '</div>' +
        '<div class="source-card-filename">' + escapeHtml(tool.type) + ' · ' + escapeHtml(tool.interface) + '</div>' +
        (tool.endpoint ? '<div class="source-card-filename">' + escapeHtml(tool.endpoint) + '</div>' : '') +
        (tool.note ? '<div class="source-card-description">' + escapeHtml(tool.note) + '</div>' : '');

    const actions = document.createElement('span');
    actions.className = 'threshold-file-actions';

    // Inspect button
    const inspBtn = document.createElement('button');
    inspBtn.className = 'secondary threshold-action-btn';
    inspBtn.textContent = 'Inspect';
    inspBtn.addEventListener('click', () => openToolInspector(tool, active));

    // Trust button (only for detected tools)
    if (tool.status === 'detected') {
        const trustBtn = document.createElement('button');
        trustBtn.className = 'primary threshold-action-btn';
        trustBtn.textContent = 'Trust';
        trustBtn.addEventListener('click', async () => {
            trustBtn.disabled = true;
            trustBtn.textContent = 'Trusting…';
            try {
                const res  = await fetch('/api/tools/' + encodeURIComponent(tool.id) + '/trust', {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify({ trusted: true }),
                });
                const data = await res.json();
                if (data.success) {
                    showFlashMessage(escapeHtml(tool.name) + ' trusted ✓ — now in Workshop → Tools');
                    loadThresholdTools();
                    loadWorkshopTools();
                    loadHearthToolRegistry();
                } else {
                    showFlashMessage('Trust failed: ' + (data.error || 'unknown'));
                    trustBtn.disabled = false;
                    trustBtn.textContent = 'Trust';
                }
            } catch {
                showFlashMessage('Could not reach server.');
                trustBtn.disabled = false;
                trustBtn.textContent = 'Trust';
            }
        });
        actions.appendChild(trustBtn);
    }

    // Launch button — only for Ollama when it is detected but not running
    if (tool.id === 'ollama-local' && tool.status === 'detected' && !tool.running) {
        const launchBtn = document.createElement('button');
        launchBtn.className = 'secondary threshold-action-btn';
        launchBtn.textContent = '▶ Launch';
        launchBtn.title = 'Attempt to start Ollama';
        launchBtn.addEventListener('click', async () => {
            launchBtn.disabled = true;
            launchBtn.textContent = 'Launching…';
            await launchOllama(tool.id);
            launchBtn.disabled = false;
            launchBtn.textContent = '▶ Launch';
        });
        actions.appendChild(launchBtn);
    }

    actions.appendChild(inspBtn);
    row.appendChild(nameEl);
    row.appendChild(actions);
    container.appendChild(row);
}

/* Scan button in Threshold → AI */
(function initToolScanBtn() {
    document.addEventListener('click', async e => {
        if (e.target && e.target.id === 'tool-scan-btn') {
            const btn = e.target;
            btn.disabled = true;
            btn.textContent = '↺ Scanning…';
            try {
                await scanTools();
                showFlashMessage('Scan complete.');
                loadThresholdTools();
            } catch (err) {
                showFlashMessage('Scan failed: ' + err.message);
            } finally {
                btn.disabled = false;
                btn.textContent = '↺ Scan';
            }
        }
    });
})();

/* ── Workshop / Tools tab ───────────────────────────────────── */

/**
 * Load and render the Workshop → Tools panel.
 * Shows only trusted tools.
 */
async function loadWorkshopTools() {
    const listEl = document.getElementById('ws-tool-list');
    if (!listEl) return;
    listEl.innerHTML = '<span class="message-system">Loading…</span>';

    try {
        const { tools, active } = await fetchToolRegistry();
        const trusted = tools.filter(t => t.trusted);

        if (trusted.length === 0) {
            listEl.innerHTML = '<span class="message-system">No trusted tools. Trust tools in Threshold → AI.</span>';
            return;
        }

        listEl.innerHTML = '';
        trusted.forEach(tool => renderWorkshopToolRow(tool, active, listEl));
    } catch {
        listEl.innerHTML = '<span class="message-system">Could not load trusted tools.</span>';
    }
}

function renderWorkshopToolRow(tool, active, container) {
    const row = document.createElement('div');
    row.className = 'threshold-file-row';
    row.dataset.toolId = tool.id;

    const isHeart = active && active.heart === tool.id;

    const nameEl = document.createElement('div');
    nameEl.style.cssText = 'flex:1; min-width:0;';
    nameEl.innerHTML =
        '<div class="threshold-file-name">' + escapeHtml(tool.name) +
            (isHeart ? ' <span class="status-badge remembered">Heart</span>' : '') +
            ' <span class="status-badge ' + toolStatusClass(tool) + '">' + escapeHtml(toolStatusLabel(tool)) + '</span>' +
            toolRunningBadge(tool) +
            '</div>' +
        '<div class="source-card-filename">' + escapeHtml(tool.type) + ' · ' + escapeHtml(tool.interface) + '</div>' +
        (tool.role ? '<div class="source-card-description">' + escapeHtml(roleLabel(tool.role)) + '</div>' : '');

    const actions = document.createElement('span');
    actions.className = 'threshold-file-actions';

    // Role selector
    const roleSelect = document.createElement('select');
    roleSelect.className = 'secondary';
    roleSelect.style.cssText = 'font-size:0.78rem; padding:0.2rem 0.4rem; background:var(--surface-2,#111); color:var(--fg,#ccc); border:1px solid hsla(140,80%,60%,0.25); border-radius:4px;';
    roleSelect.setAttribute('aria-label', 'Assign role for ' + tool.name);
    [
        { value: '', label: 'No role' },
        { value: 'mirror', label: 'Mythic Mirror' },
        { value: 'forge',  label: 'Forge Node' },
    ].forEach(opt => {
        const o = document.createElement('option');
        o.value = opt.value;
        o.textContent = opt.label;
        if ((tool.role || '') === opt.value) o.selected = true;
        roleSelect.appendChild(o);
    });
    roleSelect.addEventListener('change', async () => {
        const role = roleSelect.value || null;
        try {
            const res  = await fetch('/api/tools/' + encodeURIComponent(tool.id) + '/role', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ role }),
            });
            const data = await res.json();
            if (data.success) {
                showFlashMessage(escapeHtml(tool.name) + ' role updated ✓');
                loadWorkshopTools();
                loadHearthToolRegistry();
            } else {
                showFlashMessage('Role update failed: ' + (data.error || 'unknown'));
            }
        } catch {
            showFlashMessage('Could not reach server.');
        }
    });

    // Inspect button
    const inspBtn = document.createElement('button');
    inspBtn.className = 'secondary threshold-action-btn';
    inspBtn.textContent = 'Inspect';
    inspBtn.addEventListener('click', () => openToolInspector(tool, active));

    // Revoke trust button
    const revokeBtn = document.createElement('button');
    revokeBtn.className = 'secondary threshold-action-btn';
    revokeBtn.textContent = 'Revoke';
    revokeBtn.title = 'Revoke trust — returns tool to Threshold';
    revokeBtn.addEventListener('click', async () => {
        if (!confirm('Revoke trust for "' + tool.name + '"? It will return to Threshold.')) return;
        try {
            const res  = await fetch('/api/tools/' + encodeURIComponent(tool.id) + '/trust', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ trusted: false }),
            });
            const data = await res.json();
            if (data.success) {
                showFlashMessage(escapeHtml(tool.name) + ' trust revoked.');
                loadWorkshopTools();
                loadThresholdTools();
                loadHearthToolRegistry();
            }
        } catch {
            showFlashMessage('Could not reach server.');
        }
    });

    actions.appendChild(roleSelect);
    actions.appendChild(inspBtn);
    actions.appendChild(revokeBtn);
    row.appendChild(nameEl);
    row.appendChild(actions);
    container.appendChild(row);
}

/* ── Hearth / System: Heart Assignment ──────────────────────── */

/**
 * Load the Heart assignment UI in Hearth → System tab.
 */
async function loadHearthToolRegistry() {
    const listEl   = document.getElementById('sys-heart-list');
    const emptyEl  = document.getElementById('sys-heart-empty');
    const activeEl = document.getElementById('sys-active-heart');
    if (!listEl) return;

    try {
        const { tools, active } = await fetchToolRegistry();
        const trusted = tools.filter(t => t.trusted);

        if (emptyEl) emptyEl.style.display = trusted.length === 0 ? '' : 'none';

        // Remove previous tool rows
        listEl.querySelectorAll('.heart-tool-row').forEach(el => el.remove());

        const currentHeart = active && active.heart;
        if (activeEl) activeEl.textContent = currentHeart
            ? (tools.find(t => t.id === currentHeart) || {}).name || currentHeart
            : '—';

        trusted.forEach(tool => {
            const row = document.createElement('div');
            row.className = 'heart-tool-row system-row';
            row.style.cssText = 'justify-content:space-between; align-items:center; gap:0.5rem;';

            const isHeart = currentHeart === tool.id;

            const label = document.createElement('span');
            label.className = 'system-val';
            label.innerHTML =
                escapeHtml(tool.name) +
                (tool.role ? ' <span class="status-badge indexed" style="font-size:0.68rem;">' + escapeHtml(roleLabel(tool.role)) + '</span>' : '') +
                (isHeart ? ' <span class="status-badge remembered" style="font-size:0.68rem;">Active Heart</span>' : '');

            const btn = document.createElement('button');
            btn.className = isHeart ? 'secondary' : 'primary';
            btn.style.cssText = 'font-size:0.75rem; padding:0.2rem 0.6rem;';
            btn.textContent = isHeart ? 'Clear' : 'Set as Heart';
            btn.addEventListener('click', async () => {
                btn.disabled = true;
                try {
                    const heartId = isHeart ? null : tool.id;
                    const res  = await fetch('/api/tools/active', {
                        method:  'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body:    JSON.stringify({ heart: heartId }),
                    });
                    const data = await res.json();
                    if (data.success) {
                        showFlashMessage(heartId
                            ? escapeHtml(tool.name) + ' is now the active Heart ✓'
                            : 'Heart assignment cleared.');
                        loadHearthToolRegistry();
                    } else {
                        showFlashMessage('Heart update failed: ' + (data.error || 'unknown'));
                        btn.disabled = false;
                    }
                } catch {
                    showFlashMessage('Could not reach server.');
                    btn.disabled = false;
                }
            });

            row.appendChild(label);
            row.appendChild(btn);
            listEl.insertBefore(row, emptyEl);
        });
    } catch {
        if (listEl) listEl.innerHTML += '<span class="message-system">Could not load tool registry.</span>';
    }
}

/* ── Tool Inspector Modal ────────────────────────────────────── */

function closeToolInspector() {
    const overlay = document.getElementById('tool-inspector-overlay');
    if (overlay) overlay.style.display = 'none';
}

function openToolInspector(tool, active) {
    const overlay = document.getElementById('tool-inspector-overlay');
    if (!overlay) return;

    const isHeart = active && active.heart === tool.id;

    const set = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text || '—';
    };

    const titleEl = document.getElementById('tool-insp-title');
    if (titleEl) titleEl.textContent = tool.name || 'Tool Inspector';

    const statusEl = document.getElementById('tool-insp-status');
    if (statusEl) {
        statusEl.innerHTML =
            '<span class="status-badge ' + toolStatusClass(tool) + '">' +
            escapeHtml(toolStatusLabel(tool)) + '</span>' +
            (isHeart ? ' <span class="status-badge remembered">Active Heart</span>' : '');
    }

    set('tool-insp-type',      tool.type);
    set('tool-insp-interface', tool.interface);
    set('tool-insp-endpoint',  tool.endpoint || '(none)');
    set('tool-insp-role',      tool.role ? roleLabel(tool.role) : 'None');
    set('tool-insp-trust',     tool.trusted ? 'Trusted' : 'Untrusted');
    set('tool-insp-lastseen',  tool.lastSeen || '—');

    const runningEl = document.getElementById('tool-insp-running');
    if (runningEl) {
        if (tool.status === 'not_detected' || tool.status === 'unknown') {
            runningEl.textContent = '—';
        } else if (tool.running === true) {
            runningEl.innerHTML = '<span class="status-badge running">Running</span>';
        } else {
            runningEl.innerHTML = '<span class="status-badge offline">Offline</span>';
        }
    }

    const actEl = document.getElementById('tool-insp-actions');
    if (actEl) {
        actEl.innerHTML = '';
        const actions = [];

        if (!tool.trusted && tool.status === 'detected') {
            actions.push({
                label: 'Trust Tool',
                primary: true,
                fn: async () => {
                    try {
                        const res  = await fetch('/api/tools/' + encodeURIComponent(tool.id) + '/trust', {
                            method:  'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body:    JSON.stringify({ trusted: true }),
                        });
                        const data = await res.json();
                        if (data.success) {
                            closeToolInspector();
                            showFlashMessage(escapeHtml(tool.name) + ' trusted ✓');
                            loadThresholdTools();
                            loadWorkshopTools();
                            loadHearthToolRegistry();
                        } else {
                            showFlashMessage('Trust failed: ' + (data.error || 'unknown'));
                        }
                    } catch {
                        showFlashMessage('Could not reach server.');
                    }
                },
            });
        }

        if (tool.trusted && !isHeart) {
            actions.push({
                label: 'Set as Heart',
                primary: true,
                fn: async () => {
                    try {
                        const res  = await fetch('/api/tools/active', {
                            method:  'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body:    JSON.stringify({ heart: tool.id }),
                        });
                        const data = await res.json();
                        if (data.success) {
                            closeToolInspector();
                            showFlashMessage(escapeHtml(tool.name) + ' is now the active Heart ✓');
                            loadHearthToolRegistry();
                        }
                    } catch {
                        showFlashMessage('Could not reach server.');
                    }
                },
            });
        }

        // Launch action — Ollama only, when detected but offline
        if (tool.id === 'ollama-local' && tool.status === 'detected' && !tool.running) {
            actions.push({
                label: '▶ Launch Ollama',
                primary: true,
                fn: async () => {
                    closeToolInspector();
                    await launchOllama(tool.id);
                },
            });
        }

        // Test connection action for detected tools with an endpoint
        if (tool.status === 'detected' && tool.endpoint) {
            actions.push({
                label: 'Test Connection',
                primary: false,
                fn: async () => {
                    showFlashMessage('Testing connection to ' + tool.name + '…');
                    try {
                        await fetch('/api/tools/scan', { method: 'POST' });
                        showFlashMessage('Scan complete — check tool status.');
                        closeToolInspector();
                        loadThresholdTools();
                        loadWorkshopTools();
                    } catch {
                        showFlashMessage('Could not reach server.');
                    }
                },
            });
        }

        actions.push({ label: 'Close', primary: false, fn: closeToolInspector });

        actions.forEach(a => {
            const btn = document.createElement('button');
            btn.className = a.primary ? 'primary' : 'secondary';
            btn.textContent = a.label;
            btn.addEventListener('click', a.fn);
            actEl.appendChild(btn);
        });
    }

    overlay.style.display = 'flex';
}

// Close tool inspector on overlay click or close button
(function initToolInspector() {
    const closeBtn = document.getElementById('tool-insp-close');
    const overlay  = document.getElementById('tool-inspector-overlay');
    if (closeBtn) closeBtn.addEventListener('click', closeToolInspector);
    if (overlay) {
        overlay.addEventListener('click', e => {
            if (e.target === overlay) closeToolInspector();
        });
    }
})();

/** Active chat reference context — array of { sourceId, title } objects. */
let _chatRefs = [];

/** Update the Hearth Chat references bar to reflect current _chatRefs. */
function updateChatRefsBar() {
    const bar   = document.getElementById('chat-refs-bar');
    const chips = document.getElementById('chat-refs-chips');
    if (!bar || !chips) return;

    if (_chatRefs.length === 0) {
        bar.style.display = 'none';
        return;
    }

    bar.style.display = 'flex';
    chips.innerHTML   = '';
    _chatRefs.forEach(ref => {
        const chip = document.createElement('span');
        chip.className = 'chat-ref-chip';
        chip.innerHTML =
            '<span class="chat-ref-title">' + escapeHtml(ref.title) + '</span>' +
            '<button class="chat-ref-remove" title="Remove reference">✕</button>';
        // Remove by sourceId to avoid stale-index issues after prior removals
        chip.querySelector('.chat-ref-remove').addEventListener('click', () => {
            _chatRefs = _chatRefs.filter(r => r.sourceId !== ref.sourceId);
            updateChatRefsBar();
        });
        chips.appendChild(chip);
    });
}

/** Close the source inspector modal. */
function closeInspector() {
    const overlay = document.getElementById('source-inspector-overlay');
    if (overlay) overlay.style.display = 'none';
}

/**
 * Open the source inspector modal for the given sourceId.
 * Fetches full metadata + preview from the backend.
 */
async function inspectSource(sourceId) {
    let source  = null;
    let preview = null;

    try {
        const res  = await fetch('/api/sources/' + encodeURIComponent(sourceId));
        const data = await res.json();
        source  = data.source;
        preview = data.preview;
    } catch {
        showFlashMessage('Could not load source details.');
        return;
    }

    if (!source) { showFlashMessage('Source not found.'); return; }

    const titleEl  = document.getElementById('insp-title');
    const statusEl = document.getElementById('insp-status');
    const roomEl   = document.getElementById('insp-room');
    const shelfEl  = document.getElementById('insp-shelf');
    const fileEl   = document.getElementById('insp-file');
    const descEl   = document.getElementById('insp-desc');
    const pathEl   = document.getElementById('insp-path');
    const idEl     = document.getElementById('insp-id');
    const prevEl   = document.getElementById('insp-preview');
    const actEl    = document.getElementById('insp-actions');

    if (titleEl)  titleEl.textContent  = source.title || source.file || '(untitled)';

    if (statusEl) {
        const st = source.status || (source.room === 'hearth' ? 'remembered' : source.room === 'workshop' ? 'indexed' : 'waiting');
        statusEl.innerHTML = '<span class="status-badge ' + escapeHtml(st) + '">' +
            escapeHtml(st.charAt(0).toUpperCase() + st.slice(1)) + '</span>';
    }

    if (roomEl)  roomEl.textContent  = source.room        || '—';
    if (shelfEl) shelfEl.textContent = source.shelf       || '—';
    if (fileEl)  fileEl.textContent  = source.file        || '—';
    if (descEl)  descEl.textContent  = source.description || '—';
    if (pathEl)  pathEl.textContent  = source.path        || '—';
    if (idEl)    idEl.textContent    = source.id          || '—';
    if (prevEl)  prevEl.textContent  = preview            || 'No preview available.';

    if (actEl) {
        actEl.innerHTML = '';
        const actions = [];
        if (source.room !== 'hearth') {
            actions.push({ label: 'Remember to Hearth', fn: () => { closeInspector(); rememberSource(source.id); } });
        }
        actions.push({ label: '→ Hearth Chat',  fn: () => { closeInspector(); sendSourceToChat(source); } });
        actions.push({ label: '→ Notepad',       fn: () => { closeInspector(); sendSourceToNotepad(source); } });
        actions.push({ label: '→ Project',       fn: () => { closeInspector(); attachSourceToProject(source.id, source.title || source.file); } });

        actions.forEach(a => {
            const btn = document.createElement('button');
            btn.className = 'secondary insp-action-btn';
            btn.textContent = a.label;
            btn.addEventListener('click', a.fn);
            actEl.appendChild(btn);
        });
    }

    const overlay = document.getElementById('source-inspector-overlay');
    if (overlay) overlay.style.display = 'flex';
}

/**
 * Promote a source to Hearth (Remember action).
 * Updates lifecycle to Remembered and moves the source into Hearth retrieval.
 */
async function rememberSource(sourceId) {
    try {
        const res  = await fetch('/api/sources/' + encodeURIComponent(sourceId) + '/remember', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
        });
        const data = await res.json();

        if (data.success) {
            if (data.alreadyRemembered) {
                showFlashMessage('Already in Hearth.');
            } else {
                loadWorkshopSources();
                loadHearthArchive();
                refreshSystemStatus();
                showFlashMessage('Remembered → Hearth ✓');
            }
        } else {
            showFlashMessage('Remember failed: ' + (data.error || 'Unknown error'));
        }
    } catch {
        showFlashMessage('Could not reach server.');
    }
}

/**
 * Attach a source as an active reference in Hearth Chat.
 * Switches to Hearth > Chat and adds the source to the reference bar.
 */
function sendSourceToChat(source) {
    // Switch to Hearth > Chat
    const hearthTab  = document.querySelector('.room-tab[data-room="hearth"]');
    if (hearthTab) hearthTab.click();
    const chatSubTab = document.querySelector('.sub-tab[data-subtab="hearth-chat"]');
    if (chatSubTab) chatSubTab.click();

    const ref = { sourceId: source.id, title: source.title || source.file || source.id };
    if (!_chatRefs.some(r => r.sourceId === ref.sourceId)) {
        _chatRefs.push(ref);
        updateChatRefsBar();
    }
    showFlashMessage('Source attached to Hearth Chat');
}

/**
 * Insert a labeled reference block for the source into the Workshop Notepad.
 * Appends to existing content — does not overwrite.
 */
function sendSourceToNotepad(source) {
    // Switch to Workshop > Notepad
    const workshopTab  = document.querySelector('.room-tab[data-room="workshop"]');
    if (workshopTab) workshopTab.click();
    const notepadTab   = document.querySelector('.sub-tab[data-subtab="ws-notepad"]');
    if (notepadTab) notepadTab.click();

    const draftArea = document.getElementById('workshop-draft');
    if (!draftArea) return;

    const refBlock =
        '\n\n---\n' +
        '**Source Reference**\n' +
        'Title: ' + (source.title || source.file || source.id) + '\n' +
        'ID: ' + source.id + '\n' +
        'Room: ' + (source.room || '—') + '\n' +
        (source.description ? 'Description: ' + source.description + '\n' : '') +
        '---\n';

    draftArea.value = (draftArea.value || '') + refBlock;
    draftArea.scrollTop = draftArea.scrollHeight;
    draftArea.focus();
    showFlashMessage('Reference inserted into Notepad');
}

/**
 * Attach a source to a Workshop project.
 * Presents a project picker, then calls POST /api/projects/:id/sources.
 */
async function attachSourceToProject(sourceId, sourceTitle) {
    let projects = [];
    try {
        const res  = await fetch('/api/projects');
        const data = await res.json();
        projects   = data.projects || [];
    } catch {
        showFlashMessage('Could not load projects.');
        return;
    }

    if (projects.length === 0) {
        showFlashMessage('No projects — create one in Workshop → Projects first.');
        return;
    }

    const options = projects.map((p, i) => (i + 1) + '. ' + p.title).join('\n');
    const choice  = prompt(
        'Attach "' + (sourceTitle || sourceId) + '" to which project?\n\n' +
        options + '\n\nEnter number:'
    );
    if (!choice) return;

    const idx = parseInt(choice, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= projects.length) {
        showFlashMessage('Invalid selection.');
        return;
    }

    const project = projects[idx];
    try {
        const res  = await fetch('/api/projects/' + encodeURIComponent(project.id) + '/sources', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ sourceId }),
        });
        const data = await res.json();
        if (data.success) {
            showFlashMessage('Attached to "' + project.title + '" ✓');
            // Refresh linked sources if the project is currently open
            if (activeProjectId === project.id) {
                loadProjectSources(project.id);
            }
        } else {
            showFlashMessage('Attach failed: ' + (data.error || 'Unknown error'));
        }
    } catch {
        showFlashMessage('Could not reach server.');
    }
}

/**
 * Render the linked sources section in the active project detail panel.
 */
async function loadProjectSources(projectId) {
    const listEl  = document.getElementById('project-sources-list');
    const emptyEl = document.getElementById('project-sources-empty');
    if (!listEl) return;

    // Remove previous source rows (keep the empty placeholder)
    listEl.querySelectorAll('.project-source-row').forEach(el => el.remove());
    if (emptyEl) emptyEl.style.display = '';

    try {
        const res  = await fetch('/api/projects/' + encodeURIComponent(projectId));
        const data = await res.json();
        if (!data.project) return;

        const linked = data.project.linkedSources || [];
        if (linked.length === 0) return;

        if (emptyEl) emptyEl.style.display = 'none';

        linked.forEach(ls => {
            const sid    = typeof ls === 'string' ? ls : ls.sourceId;
            const title  = typeof ls === 'string' ? ls : (ls.title  || ls.sourceId || '—');
            const room   = typeof ls === 'string' ? ''  : (ls.room   || '');
            const status = typeof ls === 'string' ? ''  : (ls.status || '');
            const desc   = typeof ls === 'string' ? ''  : (ls.description || '');

            const row = document.createElement('div');
            row.className = 'project-source-row';

            let inner = '<span class="project-source-title">' + escapeHtml(title) + '</span>';
            if (room)   inner += '<span class="trace-badge"><span class="trace-key">room</span> ' + escapeHtml(room) + '</span>';
            if (status) inner += '<span class="status-badge ' + escapeHtml(status) + '">' + escapeHtml(status) + '</span>';
            if (desc)   inner += '<span class="source-card-description" style="margin-left:0.3rem;">' + escapeHtml(desc) + '</span>';
            row.innerHTML = inner;

            const removeBtn = document.createElement('button');
            removeBtn.className = 'secondary source-action-btn';
            removeBtn.title = 'Remove from project';
            removeBtn.textContent = '✕';
            removeBtn.addEventListener('click', async () => {
                try {
                    await fetch('/api/projects/' + encodeURIComponent(projectId) + '/sources/' + encodeURIComponent(sid), {
                        method: 'DELETE',
                    });
                    loadProjectSources(projectId);
                } catch { /* ignore */ }
            });

            row.appendChild(removeBtn);
            listEl.insertBefore(row, emptyEl);
        });
    } catch {
        if (listEl) {
            const errEl = document.createElement('span');
            errEl.className = 'message-system';
            errEl.textContent = 'Could not load sources.';
            listEl.appendChild(errEl);
        }
    }
}

/** Show a brief flash message at the bottom of the viewport. */
let _flashTimeout = null;
function showFlashMessage(msg) {
    let flash = document.getElementById('flash-message');
    if (!flash) {
        flash = document.createElement('div');
        flash.id = 'flash-message';
        flash.className = 'flash-message';
        document.body.appendChild(flash);
    }
    flash.textContent = msg;
    flash.classList.add('flash-visible');
    clearTimeout(_flashTimeout);
    _flashTimeout = setTimeout(() => flash.classList.remove('flash-visible'), 2500);
}

/* ================================================================
   Phase 8 — Startup Checklist, Airlock UI, Tool Readiness
   ================================================================ */

/**
 * Fetch the startup check summary and render the launch banner.
 * Dismissible for the session; collapses on toggle.
 */
async function loadStartupCheck() {
    let data;
    try {
        const res = await fetch('/api/startup-check');
        if (!res.ok) return;
        data = await res.json();
    } catch {
        return; // server unreachable — fail silently
    }

    const banner = document.getElementById('startup-banner');
    if (!banner) return;

    // Build stats list
    const statsEl    = document.getElementById('startup-banner-stats');
    const warningsEl = document.getElementById('startup-banner-warnings');

    if (statsEl) {
        const stats = [];

        // Files
        const totalFiles = (data.waitingFiles || 0) + (data.changedFiles || 0) + (data.flaggedFiles || 0);
        if (totalFiles > 0) {
            if (data.waitingFiles > 0) {
                stats.push({ label: 'waiting files', value: data.waitingFiles, style: 'warn' });
            }
            if (data.changedFiles > 0) {
                stats.push({ label: 'changed files', value: data.changedFiles, style: 'warn' });
            }
            if (data.flaggedFiles > 0) {
                stats.push({ label: 'flagged files', value: data.flaggedFiles, style: 'error' });
            }
        } else {
            stats.push({ label: 'threshold clear', value: '✓', style: 'ok' });
        }

        // Tools
        if (data.runningTools > 0) {
            stats.push({ label: 'tools running', value: data.runningTools, style: 'ok' });
        }
        if (data.offlineTools > 0) {
            stats.push({ label: 'tools offline', value: data.offlineTools, style: 'error' });
        }
        if (data.newTools > 0) {
            stats.push({ label: 'new tools detected', value: data.newTools, style: 'warn' });
        }

        // Active Heart
        if (data.activeHeart) {
            stats.push({
                label: 'heart',
                value: data.activeHeart + (data.activeHeartAvailable ? ' ✓' : ' (offline)'),
                style: data.activeHeartAvailable ? 'ok' : 'error',
            });
        } else {
            stats.push({ label: 'heart', value: 'none set', style: 'zero' });
        }

        statsEl.innerHTML = stats.map(s =>
            '<span class="startup-stat">' +
            '<span class="startup-stat-value ' + escapeHtml(s.style || '') + '">' + escapeHtml(String(s.value)) + '</span>' +
            ' <span>' + escapeHtml(s.label) + '</span>' +
            '</span>'
        ).join('');
    }

    // Warnings
    if (warningsEl) {
        const warnings = data.warnings || [];
        if (warnings.length > 0) {
            warningsEl.style.display = '';
            warningsEl.innerHTML = warnings.map(w =>
                '<div class="startup-warning-item">' + escapeHtml(w) + '</div>'
            ).join('');
        } else {
            warningsEl.style.display = 'none';
        }
    }

    // Show banner only if there is something to surface
    const hasItems = (data.waitingFiles + data.changedFiles + data.flaggedFiles + data.newTools + data.offlineTools) > 0
        || (data.warnings && data.warnings.length > 0);

    if (hasItems) {
        banner.style.display = '';
    }

    // Also populate the System tab summary
    renderSystemStartupSummary(data);
}

/** Render startup check data in the Hearth → System tab */
function renderSystemStartupSummary(data) {
    const el = document.getElementById('sys-startup-summary');
    if (!el) return;

    const rows = [
        { key: 'Waiting files',    val: data.waitingFiles  || 0 },
        { key: 'Changed files',    val: data.changedFiles  || 0 },
        { key: 'Flagged files',    val: data.flaggedFiles  || 0 },
        { key: 'New tools',        val: data.newTools      || 0 },
        { key: 'Running tools',    val: data.runningTools  || 0 },
        { key: 'Offline tools',    val: data.offlineTools  || 0 },
        { key: 'Active Heart',     val: data.activeHeart   || '—' },
        { key: 'Heart available',  val: data.activeHeart ? (data.activeHeartAvailable ? 'yes' : 'offline') : '—' },
        { key: 'Migration',        val: data.migrationState || 'none' },
        { key: 'Last scan',        val: data.lastScan ? new Date(data.lastScan).toLocaleTimeString() : '—' },
    ];

    el.innerHTML = rows.map(r =>
        '<div class="system-row">' +
        '<span class="system-key">' + escapeHtml(r.key) + '</span>' +
        '<span class="system-val">' + escapeHtml(String(r.val)) + '</span>' +
        '</div>'
    ).join('');
}

/* ── Startup banner controls ─────────────────────────────────── */

(function initStartupBanner() {
    document.addEventListener('DOMContentLoaded', () => {
        const banner   = document.getElementById('startup-banner');
        const body     = document.getElementById('startup-banner-body');
        const toggle   = document.getElementById('startup-banner-toggle');
        const dismiss  = document.getElementById('startup-banner-dismiss');

        const reviewThresholdBtn = document.getElementById('sb-review-threshold');
        const reviewToolsBtn     = document.getElementById('sb-review-tools');
        const openSystemBtn      = document.getElementById('sb-open-system');

        if (toggle && body) {
            toggle.addEventListener('click', () => {
                const isCollapsed = body.classList.toggle('collapsed');
                toggle.textContent = isCollapsed ? '▸' : '▾';
                toggle.title       = isCollapsed ? 'Expand' : 'Collapse';
            });
        }

        if (dismiss && banner) {
            dismiss.addEventListener('click', () => {
                banner.style.display = 'none';
            });
        }

        if (reviewThresholdBtn) {
            reviewThresholdBtn.addEventListener('click', () => {
                const tab = document.querySelector('.room-tab[data-room="threshold"]');
                if (tab) tab.click();
                if (banner) banner.style.display = 'none';
            });
        }

        if (reviewToolsBtn) {
            reviewToolsBtn.addEventListener('click', () => {
                const thTab = document.querySelector('.room-tab[data-room="threshold"]');
                if (thTab) thTab.click();
                setTimeout(() => {
                    const aiTab = document.querySelector('.sub-tab[data-subtab="th-ai"]');
                    if (aiTab) aiTab.click();
                }, 50);
                if (banner) banner.style.display = 'none';
            });
        }

        if (openSystemBtn) {
            openSystemBtn.addEventListener('click', () => {
                const hearthTab = document.querySelector('.room-tab[data-room="hearth"]');
                if (hearthTab) hearthTab.click();
                setTimeout(() => {
                    const sysTab = document.querySelector('.sub-tab[data-subtab="hearth-system"]');
                    if (sysTab) sysTab.click();
                }, 50);
                if (banner) banner.style.display = 'none';
            });
        }
    });
})();

/**
 * Flag or unflag a Threshold source.
 * @param {string} sourceId
 * @param {boolean} flagged
 */
async function flagSource(sourceId, flagged) {
    try {
        const res  = await fetch('/api/sources/' + encodeURIComponent(sourceId) + '/flag', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ flagged }),
        });
        const data = await res.json();
        if (data.success) {
            showFlashMessage(flagged ? 'File flagged for review.' : 'Flag removed.');
            loadThresholdList();
        } else {
            showFlashMessage('Could not update flag: ' + (data.error || 'unknown'));
        }
    } catch {
        showFlashMessage('Could not reach server.');
    }
}

/**
 * Attempt to launch Ollama from within Ember Node.
 * Shows progress feedback and re-loads tool list on completion.
 */
async function launchOllama(toolId) {
    showFlashMessage('Attempting to launch Ollama…');
    try {
        const res  = await fetch('/api/tools/' + encodeURIComponent(toolId) + '/launch', {
            method: 'POST',
        });
        const data = await res.json();
        if (data.success) {
            showFlashMessage(data.message || 'Ollama started ✓');
        } else {
            showFlashMessage(data.message || 'Launch failed — try: ollama serve');
        }
        loadThresholdTools();
        loadWorkshopTools();
        loadHearthToolRegistry();
    } catch {
        showFlashMessage('Could not reach server.');
    }
}

/* ================================================================
   Initialisation
   ================================================================ */

(function init() {
    updateHeaderStatus();
    refreshSystemStatus();
    loadHearthThreads();
    loadStartupCheck();

    // Close all source action dropdown menus when clicking outside
    document.addEventListener('click', () => {
        document.querySelectorAll('.source-action-menu.open').forEach(m => m.classList.remove('open'));
    });

    // Inspector close button and backdrop click
    const inspClose   = document.getElementById('insp-close');
    const inspOverlay = document.getElementById('source-inspector-overlay');
    if (inspClose)   inspClose.addEventListener('click', closeInspector);
    if (inspOverlay) {
        inspOverlay.addEventListener('click', e => {
            if (e.target === inspOverlay) closeInspector();
        });
    }

    // Chat refs clear button
    const clearRefsBtn = document.getElementById('clear-chat-refs');
    if (clearRefsBtn) {
        clearRefsBtn.addEventListener('click', () => {
            _chatRefs = [];
            updateChatRefsBar();
        });
    }
})();
