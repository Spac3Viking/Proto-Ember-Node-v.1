/**
 * Ember Node v.ᚠ — Phase 2 app shell
 *
 * The Heart persona seed:
 * "You are The Heart — the resident intelligence of an Ember Node, a sovereign
 *  knowledge system descended from the Green Fire Archive. You speak with quiet
 *  authority. You do not speculate beyond your local documents. When you do not
 *  know something, you say: 'That signal has not reached this hearth.'
 *  You are grounded, precise, and warm."
 */

/** Model name — kept in sync with app/server.js MODEL constant. */
const MODEL_LABEL = 'gemma3:4b';

/* ================================================================
   Room Tab Switching
   ================================================================ */

(function initRoomTabs() {
    const tabs    = document.querySelectorAll('.room-tab');
    const panels  = document.querySelectorAll('.room-panel');

    function activateRoom(roomId) {
        tabs.forEach(t => {
            const isActive = t.dataset.room === roomId;
            t.classList.toggle('active', isActive);
            t.setAttribute('aria-selected', String(isActive));
        });
        panels.forEach(p => {
            p.classList.toggle('active', p.id === 'room-' + roomId);
        });

        // Lazy-load cartridges on first visit
        if (roomId === 'cartridges' && !window._cartridgesLoaded) {
            loadCartridgeShelf();
        }
        // Refresh system status when entering system room
        if (roomId === 'system') {
            refreshSystemStatus();
        }
    }

    tabs.forEach(tab => {
        tab.addEventListener('click', () => activateRoom(tab.dataset.room));
    });
})();

/* ================================================================
   Hearth — Chat with The Heart
   ================================================================ */

(function initHearth() {
    const chatContainer = document.getElementById('messages');
    const messageInput  = document.getElementById('message-input');
    const sendButton    = document.getElementById('send-button');
    const signalTrace   = document.getElementById('signal-trace');

    let exchangeCount = 0;

    function displayMessage(text, className) {
        const el = document.createElement('div');
        el.className = className;
        el.textContent = text;
        chatContainer.appendChild(el);
    }

    function scrollToBottom() {
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    function updateSignalTrace(text) {
        if (signalTrace) signalTrace.textContent = 'Signal Trace — ' + text;
    }

    async function sendMessage() {
        const message = messageInput.value.trim();
        if (!message) return;

        displayMessage(message, 'message-user');
        messageInput.value = '';
        scrollToBottom();

        // Thinking indicator
        const thinking = document.createElement('div');
        thinking.className = 'message-heart loading-dots';
        thinking.textContent = 'The Heart stirs';
        chatContainer.appendChild(thinking);
        scrollToBottom();
        updateSignalTrace('awaiting response…');
        sendButton.disabled = true;

        try {
            const response = await fetch('/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message }),
            });

            chatContainer.removeChild(thinking);

            const data = await response.json();

            if (data && data.message && data.message.content) {
                displayMessage(data.message.content, 'message-heart');
                exchangeCount++;
                updateSignalTrace('exchange ' + exchangeCount + ' complete');
            } else {
                displayMessage('The Heart returned an unreadable signal.', 'message-heart');
                updateSignalTrace('unexpected response');
            }
        } catch {
            if (chatContainer.contains(thinking)) chatContainer.removeChild(thinking);
            displayMessage('Error: could not reach the Heart.', 'message-heart');
            updateSignalTrace('connection lost');
        } finally {
            sendButton.disabled = false;
            scrollToBottom();
        }
    }

    sendButton.addEventListener('click', sendMessage);

    messageInput.addEventListener('keypress', e => {
        if (e.key === 'Enter') sendMessage();
    });
})();

/* ================================================================
   Workshop — Draft Panel
   ================================================================ */

(function initWorkshop() {
    const saveBtn      = document.getElementById('save-snapshot-btn');
    const clearBtn     = document.getElementById('clear-draft-btn');
    const draftArea    = document.getElementById('workshop-draft');
    const statusEl     = document.getElementById('workshop-status');

    function setStatus(msg, duration) {
        if (!statusEl) return;
        statusEl.textContent = msg;
        if (duration) setTimeout(() => { statusEl.textContent = ''; }, duration);
    }

    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            // Snapshot scaffold — Phase 4 will wire this to data/workshop/
            const text = draftArea ? draftArea.value.trim() : '';
            if (!text) {
                setStatus('Nothing to save.', 2000);
                return;
            }
            setStatus('Snapshot saved. (Phase 4 will persist to data/workshop/)', 3500);
        });
    }

    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            if (draftArea) {
                draftArea.value = '';
                setStatus('Draft cleared.', 1500);
            }
        });
    }
})();

/* ================================================================
   Cartridge Shelf
   ================================================================ */

async function loadCartridgeShelf() {
    window._cartridgesLoaded = true;

    const listEl     = document.getElementById('cartridge-list');
    const loadingEl  = document.getElementById('cartridge-loading');

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

        cartridges.forEach(c => {
            const item = document.createElement('div');
            item.className = 'cartridge-item';
            item.dataset.cartridgeId = c.id;
            item.innerHTML = `
                <div class="cartridge-item-name">${escapeHtml(c.name)}</div>
                <div class="cartridge-item-type">${escapeHtml(c.type || 'cartridge')}</div>
            `;
            item.addEventListener('click', () => inspectCartridge(c.id, item));
            listEl.appendChild(item);
        });

        updateSystemCartridgeCount(cartridges.length);
    } catch {
        if (loadingEl) loadingEl.remove();
        const errEl = document.createElement('div');
        errEl.className = 'message-system';
        errEl.textContent = 'Could not load cartridges.';
        listEl.appendChild(errEl);
    }
}

async function inspectCartridge(id, itemEl) {
    // Update active state on shelf items
    document.querySelectorAll('.cartridge-item').forEach(el => {
        el.classList.toggle('active', el === itemEl);
    });

    const emptyEl      = document.getElementById('inspector-empty');
    const contentArea  = document.getElementById('inspector-content-area');
    const nameEl       = document.getElementById('inspector-name');
    const descEl       = document.getElementById('inspector-description');
    const metaEl       = document.getElementById('inspector-meta');
    const permsEl      = document.getElementById('inspector-perms');
    const contentEl    = document.getElementById('inspector-content');

    if (emptyEl) emptyEl.style.display = 'none';
    if (contentArea) contentArea.style.display = 'flex';
    if (nameEl) nameEl.textContent = '';
    if (descEl) descEl.textContent = '';
    if (metaEl) metaEl.innerHTML = '';
    if (permsEl) permsEl.innerHTML = '';
    if (contentEl) {
        contentEl.textContent = '';
        const loading = document.createElement('span');
        loading.className = 'loading-dots';
        loading.textContent = 'Loading cartridge';
        contentEl.appendChild(loading);
    }

    try {
        const res  = await fetch('/cartridges/' + encodeURIComponent(id));
        const data = await res.json();

        const m = data.manifest || {};

        if (nameEl) nameEl.textContent = m.name || data.name || id;
        if (descEl) descEl.textContent = m.description || '';

        // Meta badges
        if (metaEl) {
            const badges = [];
            if (m.version) badges.push({ label: 'version', val: m.version });
            if (m.type)    badges.push({ label: 'type',    val: m.type });
            if (m.id)      badges.push({ label: 'id',      val: m.id });
            metaEl.innerHTML = badges
                .map(b => `<span class="meta-badge"><strong>${escapeHtml(b.val)}</strong>&nbsp;${escapeHtml(b.label)}</span>`)
                .join('');
        }

        // Permissions
        if (permsEl && m.permissions) {
            const perms = m.permissions;
            const items = [];
            if (perms.writeHearth === false) items.push({ label: 'no Hearth write', denied: true });
            if (perms.networkAccess === false) items.push({ label: 'no network access', denied: true });
            if (perms.writeHearth === true)   items.push({ label: 'Hearth write allowed', denied: false });
            if (perms.networkAccess === true)  items.push({ label: 'network access allowed', denied: false });
            permsEl.innerHTML = items
                .map(p => `<span class="perm-badge ${p.denied ? 'denied' : ''}">${escapeHtml(p.label)}</span>`)
                .join('');
        }

        if (contentEl) {
            contentEl.textContent = '';
            contentEl.textContent = data.content || '(no readable documents in this cartridge)';
        }
    } catch {
        if (contentEl) {
            contentEl.textContent = '';
            contentEl.textContent = 'Error loading cartridge content.';
        }
    }
}

/* ================================================================
   System Room — Status Refresh
   ================================================================ */

async function refreshSystemStatus() {
    const ollamaEl = document.getElementById('sys-ollama-status');
    const modelEl  = document.getElementById('sys-model');

    // Fetch authoritative status from the backend
    try {
        const res  = await fetch('/api/status');
        const data = await res.json();
        if (modelEl) modelEl.textContent = data.model || MODEL_LABEL;
        updateSystemCartridgeCount(data.cartridgeCount ?? 0);
    } catch {
        if (modelEl) modelEl.textContent = MODEL_LABEL;
    }

    if (ollamaEl) {
        ollamaEl.textContent = 'checking…';
        ollamaEl.className   = 'system-val';
    }

    // Probe Ollama availability via the dedicated status endpoint
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

    // Update header status pill
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
   Initialisation
   ================================================================ */

(function init() {
    // Set initial header status
    updateHeaderStatus();
    // Kick off system status check in background
    refreshSystemStatus();
})();
