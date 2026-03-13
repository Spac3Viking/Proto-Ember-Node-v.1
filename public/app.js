/**
 * Ember Node v.ᚠ — Phase 3 app shell
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

        if (roomId === 'cartridges' && !window._cartridgesLoaded) {
            loadCartridgeShelf();
        }
        if (roomId === 'system') {
            refreshSystemStatus();
        }
        if (roomId === 'workshop' && !window._workshopLoaded) {
            loadWorkshopPanel();
        }
        if (roomId === 'threshold') {
            loadThresholdList();
        }
    }

    tabs.forEach(tab => {
        tab.addEventListener('click', () => activateRoom(tab.dataset.room));
    });
})();

/* ================================================================
   Hearth — Grounded Chat with The Heart
   ================================================================ */

(function initHearth() {
    const chatContainer    = document.getElementById('messages');
    const messageInput     = document.getElementById('message-input');
    const sendButton       = document.getElementById('send-button');
    const traceStatus      = document.getElementById('signal-trace-status');
    const traceSources     = document.getElementById('signal-trace-sources');

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

    function setTraceStatus(text) {
        if (traceStatus) traceStatus.textContent = text;
    }

    function renderSignalTrace(sources) {
        if (!traceSources) return;
        traceSources.innerHTML = '';

        if (!sources || sources.length === 0) {
            setTraceStatus('base model — no local sources');
            return;
        }

        setTraceStatus(sources.length + ' source' + (sources.length === 1 ? '' : 's'));

        sources.forEach(s => {
            const item = document.createElement('div');
            item.className = 'signal-trace-item';

            const badges = [
                { label: 'room',  val: s.room },
                s.cartridgeId ? { label: 'cartridge', val: s.cartridgeId } : null,
                { label: 'file',  val: s.file },
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
    }

    async function sendMessage() {
        const message = messageInput.value.trim();
        if (!message) return;

        displayMessage(message, 'message-user');
        messageInput.value = '';
        scrollToBottom();

        const thinking = document.createElement('div');
        thinking.className = 'message-heart loading-dots';
        thinking.textContent = 'The Heart stirs';
        chatContainer.appendChild(thinking);
        scrollToBottom();

        setTraceStatus('retrieving…');
        if (traceSources) traceSources.innerHTML = '';
        sendButton.disabled = true;

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: message }),
            });

            chatContainer.removeChild(thinking);

            const data = await response.json();

            if (data && typeof data.answer === 'string') {
                displayMessage(data.answer, 'message-heart');
                exchangeCount++;
                renderSignalTrace(data.sources || []);
            } else if (data && data.error) {
                displayMessage('The Heart returned an error: ' + data.error, 'message-heart');
                setTraceStatus('error');
            } else {
                displayMessage('The Heart returned an unreadable signal.', 'message-heart');
                setTraceStatus('unexpected response');
            }
        } catch {
            if (chatContainer.contains(thinking)) chatContainer.removeChild(thinking);
            displayMessage('Error: could not reach the Heart.', 'message-heart');
            setTraceStatus('connection lost');
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
   Workshop — Draft Panel + Index Management
   ================================================================ */

(function initWorkshop() {
    const saveNoteBtn  = document.getElementById('save-note-btn');
    const clearBtn     = document.getElementById('clear-draft-btn');
    const draftArea    = document.getElementById('workshop-draft');
    const statusEl     = document.getElementById('workshop-status');

    function setStatus(msg, duration) {
        if (!statusEl) return;
        statusEl.textContent = msg;
        if (duration) setTimeout(() => { statusEl.textContent = ''; }, duration);
    }

    if (saveNoteBtn) {
        saveNoteBtn.addEventListener('click', async () => {
            const text = draftArea ? draftArea.value.trim() : '';
            if (!text) {
                setStatus('Nothing to save.', 2000);
                return;
            }
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
                    loadWorkshopNotes();
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
            if (draftArea) {
                draftArea.value = '';
                setStatus('Draft cleared.', 1500);
            }
        });
    }
})();

function loadWorkshopPanel() {
    window._workshopLoaded = true;
    loadWorkshopCartridges();
    loadWorkshopSources();
    loadWorkshopNotes();
}

async function loadWorkshopCartridges() {
    const listEl = document.getElementById('ws-cartridge-index-list');
    if (!listEl) return;

    try {
        const res  = await fetch('/cartridges');
        const data = await res.json();
        const cartridges = data.cartridges || [];

        if (cartridges.length === 0) {
            listEl.innerHTML = '<span class="message-system">No cartridges found.</span>';
            return;
        }

        listEl.innerHTML = '';
        cartridges.forEach(c => {
            const row = document.createElement('div');
            row.className = 'ws-cartridge-row';
            row.innerHTML =
                '<span class="ws-cartridge-name">' + escapeHtml(c.name || c.id) + '</span>' +
                '<button class="secondary ws-index-btn" data-id="' + escapeHtml(c.id) + '">Index</button>';
            listEl.appendChild(row);
        });

        listEl.querySelectorAll('.ws-index-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id  = btn.dataset.id;
                btn.disabled  = true;
                btn.textContent = 'Indexing…';
                try {
                    const res  = await fetch('/api/index/cartridge/' + encodeURIComponent(id), {
                        method:  'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body:    JSON.stringify({ room: 'workshop' }),
                    });
                    const data = await res.json();
                    if (data.success) {
                        btn.textContent = 'Indexed (' + data.chunksCreated + ')';
                        loadWorkshopSources();
                        refreshSystemStatus();
                    } else {
                        btn.textContent = 'Error';
                        btn.disabled = false;
                    }
                } catch {
                    btn.textContent = 'Error';
                    btn.disabled = false;
                }
            });
        });
    } catch {
        listEl.innerHTML = '<span class="message-system">Could not load cartridges.</span>';
    }
}

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
        sources.slice(0, 20).forEach(s => {
            const row = document.createElement('div');
            row.className = 'ws-source-row';

            const roomBadge = '<span class="trace-badge"><span class="trace-key">room</span> ' +
                escapeHtml(s.room) + '</span>';
            const fileBadge = '<span class="trace-badge"><span class="trace-key">file</span> ' +
                escapeHtml(s.file) + '</span>';

            row.innerHTML = roomBadge + ' ' + fileBadge;
            listEl.appendChild(row);
        });

        if (sources.length > 20) {
            const more = document.createElement('div');
            more.className = 'message-system';
            more.textContent = '…and ' + (sources.length - 20) + ' more';
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

/* ================================================================
   Threshold — File Intake
   ================================================================ */

(function initThreshold() {
    const dropZone  = document.getElementById('threshold-drop-zone');
    const fileInput = document.getElementById('threshold-file-input');
    const statusEl  = document.getElementById('threshold-status');

    function setThresholdStatus(msg, duration) {
        if (!statusEl) return;
        statusEl.textContent = msg;
        if (duration) setTimeout(() => { statusEl.textContent = ''; }, duration);
    }

    async function ingestFile(file) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = async (e) => {
                const content = e.target.result;
                try {
                    const res  = await fetch('/api/ingest', {
                        method:  'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body:    JSON.stringify({
                            filename: file.name,
                            content,
                            room: 'threshold',
                        }),
                    });
                    const data = await res.json();
                    resolve(data.success ? { ok: true, name: file.name } : { ok: false, name: file.name });
                } catch {
                    resolve({ ok: false, name: file.name });
                }
            };
            reader.readAsText(file);
        });
    }

    async function handleFiles(files) {
        const supported = Array.from(files).filter(f =>
            f.name.endsWith('.txt') || f.name.endsWith('.md')
        );
        if (supported.length === 0) {
            setThresholdStatus('Only .txt and .md files are supported.', 3000);
            return;
        }

        setThresholdStatus('Ingesting ' + supported.length + ' file(s)…');
        const results = await Promise.all(supported.map(ingestFile));
        const ok      = results.filter(r => r.ok).length;
        const failed  = results.length - ok;
        const msg     = ok + ' file(s) ingested' + (failed > 0 ? ', ' + failed + ' failed' : '') + '.';
        setThresholdStatus(msg, 4000);
        loadThresholdList();
    }

    if (dropZone) {
        dropZone.addEventListener('dragover', e => {
            e.preventDefault();
            dropZone.classList.add('drag-over');
        });
        dropZone.addEventListener('dragleave', () => {
            dropZone.classList.remove('drag-over');
        });
        dropZone.addEventListener('drop', e => {
            e.preventDefault();
            dropZone.classList.remove('drag-over');
            handleFiles(e.dataTransfer.files);
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
            if (fileInput.files.length) handleFiles(fileInput.files);
            fileInput.value = '';
        });
    }
})();

async function loadThresholdList() {
    const listEl = document.getElementById('threshold-file-list');
    if (!listEl) return;

    try {
        const res   = await fetch('/api/threshold/list');
        const data  = await res.json();
        const files = data.files || [];

        if (files.length === 0) {
            listEl.innerHTML = '<span class="message-system">No files in Threshold.</span>';
            return;
        }

        listEl.innerHTML = '';
        files.forEach(f => {
            const row = document.createElement('div');
            row.className = 'threshold-file-row';

            const name = document.createElement('span');
            name.className = 'threshold-file-name';
            name.textContent = f.filename;

            const actions = document.createElement('span');
            actions.className = 'threshold-file-actions';

            const indexBtn = document.createElement('button');
            indexBtn.className = 'secondary threshold-action-btn';
            indexBtn.textContent = 'Index';
            indexBtn.addEventListener('click', async () => {
                if (!f.sourceId) {
                    // Ingest first to create a manifest entry
                    alert('Re-ingest this file via drop zone first.');
                    return;
                }
                indexBtn.disabled = true;
                indexBtn.textContent = 'Indexing…';
                try {
                    const r = await fetch('/api/index/file', {
                        method:  'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body:    JSON.stringify({ sourceId: f.sourceId }),
                    });
                    const d = await r.json();
                    if (d.success) {
                        indexBtn.textContent = 'Indexed';
                        refreshSystemStatus();
                    } else {
                        indexBtn.textContent = 'Error';
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
            row.appendChild(name);
            row.appendChild(actions);
            listEl.appendChild(row);
        });
    } catch {
        listEl.innerHTML = '<span class="message-system">Could not load Threshold files.</span>';
    }
}

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
            item.innerHTML =
                '<div class="cartridge-item-name">' + escapeHtml(c.name) + '</div>' +
                '<div class="cartridge-item-type">' + escapeHtml(c.type || 'cartridge') + '</div>';
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
            if (perms.writeHearth === false) items.push({ label: 'no Hearth write', denied: true });
            if (perms.networkAccess === false) items.push({ label: 'no network access', denied: true });
            if (perms.writeHearth === true)   items.push({ label: 'Hearth write allowed', denied: false });
            if (perms.networkAccess === true)  items.push({ label: 'network access allowed', denied: false });
            permsEl.innerHTML = items
                .map(p =>
                    '<span class="perm-badge ' + (p.denied ? 'denied' : '') + '">' +
                    escapeHtml(p.label) + '</span>'
                )
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
    updateHeaderStatus();
    refreshSystemStatus();
})();
