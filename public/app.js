/**
 * Ember Node v.ᚠ — Phase 8.75 app shell
 *
 * Covers all three rooms (Hearth / Workshop / Threshold) with sub-tab navigation,
 * file lifecycle (Waiting/Indexed/Remembered), intake discipline (Threshold airlock),
 * chat threads, source inspector, tool registry, startup checklist, and project
 * management.  All UI logic communicates only with the local Express server.
 */

/** Default model name — used as fallback if local config is unavailable. */
const DEFAULT_MODEL_LABEL = 'gemma3:4b';
let activeModelLabel = DEFAULT_MODEL_LABEL;
const EMBER_COURT_STORAGE_KEY = 'ember-court-active-member';
let _activeCourtMemberId = null;

function normalizeCourtMemberId(value) {
    if (!value || typeof value !== 'string') return null;
    const normalized = value.toLowerCase().trim().replace(/[^a-z0-9_-]/g, '');
    return normalized || null;
}

function getActiveCourtMemberId() {
    if (_activeCourtMemberId) return _activeCourtMemberId;
    try {
        _activeCourtMemberId = normalizeCourtMemberId(window.localStorage.getItem(EMBER_COURT_STORAGE_KEY));
    } catch {
        _activeCourtMemberId = null;
    }
    return _activeCourtMemberId;
}

function setActiveCourtMemberId(memberId) {
    const normalized = normalizeCourtMemberId(memberId);
    _activeCourtMemberId = normalized;
    try {
        if (normalized) {
            window.localStorage.setItem(EMBER_COURT_STORAGE_KEY, normalized);
        } else {
            window.localStorage.removeItem(EMBER_COURT_STORAGE_KEY);
        }
    } catch { /* ignore storage failures */ }
    return _activeCourtMemberId;
}

const COURT_MEMBER_TRANSITIONS = Object.freeze({
    builder: 'Grounding signal in structure, tools, and practical sequence.',
    warrior: 'Clarifying stakes, terrain, risk, and disciplined action.',
    scholar: 'Mapping distinctions, connections, and conceptual structure.',
    scribe: 'Shaping fragments into coherent chapters and transmissible language.',
    mystic: 'Reading symbolic thresholds while staying practical and clear.',
});

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

        // Keep internal room key as "workshop" for storage/route compatibility.
        if (roomId === 'workshop' && !window._workshopLoaded) {
            loadWorkshopPanel();
        }
        if (roomId === 'threshold') {
            loadThresholdList();
            checkDetectedFiles(true);   // auto-load into queue on room entry
        }
        if (roomId === 'hearth') {
            loadHearthThreads();
            loadHearthArchive();
            loadHearthTrustedArchive();
            loadHearthRememberedThreads();
            loadArchiveCacheManager();
            loadArchiveSignalPanel();
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
                if (panelId === 'ws-scribe') {
                    loadDocuments();
                }
                if (panelId === 'ws-index') {
                    loadWorkshopSources();
                    loadWorkshopNotes();
                }
                if (panelId === 'ws-caches' && !window._cachesLoaded) {
                    loadCacheShelf();
                }
                if (panelId === 'ws-projects') {
                    loadProjects();
                }
                if (panelId === 'ws-tools') {
                    loadWorkshopTools();
                }
                if (panelId === 'hearth-archive') {
                    loadHearthArchive();
                    loadHearthTrustedArchive();
                    loadHearthRememberedThreads();
                    loadArchiveCacheManager();
                    loadArchiveSignalPanel();
                }
                if (panelId === 'hearth-system') {
                    refreshSystemStatus();
                    loadHearthToolRegistry();
                    loadContextMapsStatus();
                    loadBootstrapStatus();
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
    const stopButton   = document.getElementById('stop-response-button');
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
    if (stopButton) {
        stopButton.addEventListener('click', () => { stillTheSignal(); });
    }
    if (messageInput) {
        messageInput.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (!_isChatGenerating) sendMessage();
            }
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
            const status = t.status || 'active';
            item.className = 'thread-item' + (t.id === hearthActiveThreadId ? ' active' : '') +
                             (status === 'archived' ? ' thread-archived' : '') +
                             (status === 'remembered' ? ' thread-remembered' : '');
            item.dataset.threadId    = t.id;
            item.dataset.threadTitle = t.title;

            const titleSpan = document.createElement('span');
            titleSpan.className = 'thread-item-title';
            titleSpan.textContent = t.title;

            // Status badge
            if (status === 'remembered') {
                const badge = document.createElement('span');
                badge.className = 'thread-status-badge remembered';
                badge.textContent = '★';
                badge.title = 'Remembered';
                titleSpan.appendChild(badge);
            } else if (status === 'archived') {
                const badge = document.createElement('span');
                badge.className = 'thread-status-badge archived';
                badge.textContent = '◾';
                badge.title = 'Archived';
                titleSpan.appendChild(badge);
            }

            item.appendChild(titleSpan);

            // Action buttons
            const actions = document.createElement('div');
            actions.className = 'thread-item-actions';

            if (status !== 'remembered') {
                const remBtn = document.createElement('button');
                remBtn.className = 'thread-action-btn';
                remBtn.textContent = '★';
                remBtn.title = 'Remember thread';
                remBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    rememberHearthThread(t.id);
                });
                actions.appendChild(remBtn);
            }

            if (status === 'active') {
                const archBtn = document.createElement('button');
                archBtn.className = 'thread-action-btn';
                archBtn.textContent = '◾';
                archBtn.title = 'Archive thread';
                archBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    archiveHearthThread(t.id);
                });
                actions.appendChild(archBtn);
            }

            const delBtn = document.createElement('button');
            delBtn.className = 'thread-action-btn thread-delete-btn';
            delBtn.textContent = '✕';
            delBtn.title = 'Delete thread';
            delBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteHearthThread(t.id);
            });
            actions.appendChild(delBtn);

            item.appendChild(actions);

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

async function rememberHearthThread(threadId) {
    try {
        const res  = await fetch('/api/threads/' + encodeURIComponent(threadId) + '/remember', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            showFlashMessage('Thread remembered ★');
            loadHearthThreads();
        } else {
            showFlashMessage('Could not remember thread.');
        }
    } catch {
        showFlashMessage('Could not remember thread.');
    }
}

async function archiveHearthThread(threadId) {
    try {
        const res  = await fetch('/api/threads/' + encodeURIComponent(threadId) + '/archive', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            showFlashMessage('Thread archived.');
            if (hearthActiveThreadId === threadId) hearthActiveThreadId = null;
            loadHearthThreads();
        }
    } catch {
        showFlashMessage('Could not archive thread.');
    }
}

async function deleteHearthThread(threadId) {
    if (!confirm('Delete this thread permanently? This cannot be undone.')) return;
    try {
        const res  = await fetch('/api/threads/' + encodeURIComponent(threadId), { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
            showFlashMessage('Thread deleted.');
            if (hearthActiveThreadId === threadId) {
                hearthActiveThreadId = null;
                const chatEl = document.getElementById('messages');
                const titleEl = document.getElementById('hearth-active-thread-title');
                if (chatEl)  chatEl.innerHTML = '';
                if (titleEl) titleEl.textContent = 'Select or create a thread';
            }
            loadHearthThreads();
        }
    } catch {
        showFlashMessage('Could not delete thread.');
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
    return el;
}

const HEART_TECHNICAL_ERROR = (
    'Ember Prime could not complete the response.\n' +
    'Check local AI status and try again.'
);

const CHAT_STATES = Object.freeze({
    IDLE:       'idle',
    THINKING:   'thinking',
    RESOLVING:  'resolving',
    RESPONDING: 'responding',
    COMPLETE:   'complete',
    INTERRUPTED: 'interrupted',
    ERROR:      'error',
});

let _chatState = CHAT_STATES.IDLE;
let _glyphResolveEnabled = true;
let _isChatGenerating = false;
let _activeChatAbortController = null;
let _activeChatRequestId = null;
let _activeChatRevealToken = { cancelled: false };
let _activeChatLongWaitTimer = null;
let _activeChatResponseEl = null;
let _activeChatContainer = null;
let _chatRequestSeq = 0;
let _chatCancelledByUser = false;

function setChatState(nextState) {
    _chatState = nextState;
    const chatEl = document.getElementById('messages');
    if (chatEl) chatEl.dataset.chatState = nextState;
}

setChatState(CHAT_STATES.IDLE);

function nextChatRequestId() {
    _chatRequestSeq += 1;
    return 'ui-' + Date.now() + '-' + _chatRequestSeq;
}

function setChatGenerationUi(active) {
    _isChatGenerating = Boolean(active);
    const sendButton = document.getElementById('send-button');
    const stopButton = document.getElementById('stop-response-button');
    if (sendButton) sendButton.disabled = _isChatGenerating;
    if (stopButton) stopButton.style.display = _isChatGenerating ? '' : 'none';
}

function clearChatLongWaitTimer() {
    if (_activeChatLongWaitTimer) {
        clearTimeout(_activeChatLongWaitTimer);
        _activeChatLongWaitTimer = null;
    }
}

function resetActiveChatState() {
    clearChatLongWaitTimer();
    _activeChatAbortController = null;
    _activeChatRequestId = null;
    _activeChatRevealToken = { cancelled: false };
    _activeChatResponseEl = null;
    _activeChatContainer = null;
    _chatCancelledByUser = false;
    setChatGenerationUi(false);
}

async function stillTheSignal() {
    if (!_isChatGenerating) return;
    _chatCancelledByUser = true;
    _activeChatRevealToken.cancelled = true;
    if (_activeChatAbortController) {
        try { _activeChatAbortController.abort(); } catch { /* ignore */ }
    }
    if (_activeChatRequestId) {
        try {
            await fetch('/api/chat/cancel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ requestId: _activeChatRequestId }),
            });
        } catch { /* ignore */ }
    }
}

function cleanupThinkingIndicator(container, thinkingEl, cancelAnim) {
    if (typeof cancelAnim === 'function') cancelAnim();
    if (container && thinkingEl && container.contains(thinkingEl)) container.removeChild(thinkingEl);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function randomRuneLikeChars(sample) {
    let out = '';
    for (let i = 0; i < sample.length; i += 1) {
        out += /\s/.test(sample[i])
            ? sample[i]
            : HEART_SYMBOLS[Math.floor(Math.random() * HEART_SYMBOLS.length)];
    }
    return out;
}

const TERMINAL_REVEAL_PROFILE = Object.freeze({
    MIN_CHUNK: 2,
    MAX_CHUNK: 4,
    MIN_TICK_MS: 58,
    MAX_TICK_MS: 75,
    GLYPH_FRAMES: 2,
    GLYPH_LENGTH: 10,
});
const LONG_WAIT_THRESHOLD_MS = 12000;

/**
 * Render text progressively with optional rune flicker that resolves into readable output.
 *
 * @param {HTMLElement} targetElement
 * @param {string} finalText
 * @param {Object} [options]
 * @param {boolean} [options.glyphEffect=true]  Show temporary rune glyphs before settling to text
 * @param {Function} [options.onFrame]          Callback fired after each visual update
 * @param {number} [options.minDelay=58]        Minimum delay (ms) between reveal steps
 * @param {number} [options.maxDelay=75]        Maximum delay (ms) between reveal steps
 * @param {number} [options.minChunk=2]         Minimum chars appended per reveal tick
 * @param {number} [options.maxChunk=4]         Maximum chars appended per reveal tick
 * @param {number} [options.flickerDelay=45]    Delay (ms) for glyph flicker frame
 * @returns {Promise<void>}
 */
async function resolveGlyphText(targetElement, finalText, options = {}) {
    const text = typeof finalText === 'string' ? finalText : '';
    const useGlyph = options.glyphEffect !== false;
    const onFrame = typeof options.onFrame === 'function' ? options.onFrame : null;
    const minDelay = Number.isFinite(options.minDelay) ? options.minDelay : TERMINAL_REVEAL_PROFILE.MIN_TICK_MS;
    const maxDelay = Number.isFinite(options.maxDelay) ? options.maxDelay : TERMINAL_REVEAL_PROFILE.MAX_TICK_MS;
    const minChunk = Number.isFinite(options.minChunk) ? options.minChunk : TERMINAL_REVEAL_PROFILE.MIN_CHUNK;
    const maxChunk = Number.isFinite(options.maxChunk) ? options.maxChunk : TERMINAL_REVEAL_PROFILE.MAX_CHUNK;
    const flickerDelay = Number.isFinite(options.flickerDelay) ? options.flickerDelay : 45;
    const shouldStop = typeof options.shouldStop === 'function' ? options.shouldStop : null;

    const boundedMinChunk = Math.max(1, Math.floor(Math.min(minChunk, maxChunk)));
    const boundedMaxChunk = Math.max(boundedMinChunk, Math.floor(Math.max(minChunk, maxChunk)));
    const boundedMinDelay = Math.max(1, Math.floor(Math.min(minDelay, maxDelay)));
    const boundedMaxDelay = Math.max(boundedMinDelay, Math.floor(Math.max(minDelay, maxDelay)));

    if (useGlyph && /\S/.test(text)) {
        targetElement.textContent = '';
        const glyphLength = Math.min(TERMINAL_REVEAL_PROFILE.GLYPH_LENGTH, Math.max(8, text.length));
        const glyphSample = text.slice(0, glyphLength);
        for (let i = 0; i < TERMINAL_REVEAL_PROFILE.GLYPH_FRAMES; i += 1) {
            if (shouldStop && shouldStop()) return { interrupted: true };
            targetElement.textContent = randomRuneLikeChars(glyphSample);
            if (onFrame) onFrame();
            await sleep(flickerDelay);
        }
        targetElement.textContent = '';
        if (onFrame) onFrame();
    } else {
        targetElement.textContent = '';
    }

    let stableText = '';
    let idx = 0;
    const chunkRange = boundedMaxChunk - boundedMinChunk + 1;
    const delayRange = boundedMaxDelay - boundedMinDelay + 1;
    while (idx < text.length) {
        if (shouldStop && shouldStop()) return { interrupted: true, partialText: stableText };
        const chunkForTick = boundedMinChunk + Math.floor(Math.random() * chunkRange);
        const delayForTick = boundedMinDelay + Math.floor(Math.random() * delayRange);
        const chunkSize = Math.min(chunkForTick, text.length - idx);
        stableText += text.slice(idx, idx + chunkSize);
        targetElement.textContent = stableText;
        if (onFrame) onFrame();
        idx += chunkSize;

        if (idx < text.length) await sleep(delayForTick);
    }
    return { interrupted: false, partialText: stableText };
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

function renderSignalTrace(sources, signalTrace = null) {
    const MAX_SOURCE_LIST_DISPLAY_CHARS = 180;
    const MIN_TRUNCATION_POSITION = 40;
    const traceSources = document.getElementById('signal-trace-sources');
    if (!traceSources) return;
    traceSources.innerHTML = '';

    const metadata = signalTrace && typeof signalTrace === 'object' ? signalTrace : null;
    const contextStatus = metadata && metadata.contextStatus ? String(metadata.contextStatus) : null;
    const sourcesUsed = metadata && Number.isFinite(metadata.sourcesUsed) ? metadata.sourcesUsed : null;
    const sourceList = metadata && Array.isArray(metadata.sourceList) ? metadata.sourceList : [];
    const conceptRoute = metadata && metadata.conceptRoute ? String(metadata.conceptRoute) : null;
    const courtLens = metadata && metadata.courtLens ? String(metadata.courtLens) : null;
    const courtDomains = metadata && Array.isArray(metadata.courtDomains) ? metadata.courtDomains : [];
    const model = metadata && metadata.model ? String(metadata.model) : null;
    const provider = metadata && metadata.provider ? String(metadata.provider) : null;
    const relatedDomains = metadata && Array.isArray(metadata.relatedDomains) ? metadata.relatedDomains : [];
    const courtSourcesConsidered = metadata && Array.isArray(metadata.courtSourcesConsidered)
        ? metadata.courtSourcesConsidered
        : (metadata && Array.isArray(metadata.courtPrioritySourcesConsidered)
            ? metadata.courtPrioritySourcesConsidered
            : []);
    const prioritySourcesConsidered = metadata && Array.isArray(metadata.prioritySourcesConsidered)
        ? metadata.prioritySourcesConsidered
        : [];
    const sourcesActuallyUsed = metadata && Array.isArray(metadata.sourcesActuallyUsed)
        ? metadata.sourcesActuallyUsed
        : [];
    const retrievalNote = metadata && metadata.retrievalNote ? String(metadata.retrievalNote) : '';

    function boundedListText(list) {
        const listText = list.join(', ');
        if (listText.length <= MAX_SOURCE_LIST_DISPLAY_CHARS) return listText;
        let truncated = listText.slice(0, MAX_SOURCE_LIST_DISPLAY_CHARS);
        const lastCommaIndex = truncated.lastIndexOf(', ');
        if (lastCommaIndex > MIN_TRUNCATION_POSITION) truncated = truncated.slice(0, lastCommaIndex);
        return truncated + '…';
    }

    if (contextStatus) {
        const parts = ['context ' + contextStatus];
        if (sourcesUsed !== null) parts.push(String(sourcesUsed) + ' source' + (sourcesUsed === 1 ? '' : 's'));
        setTraceStatus(parts.join(' · '));
    } else if (!sources || sources.length === 0) {
        setTraceStatus('base model — no local sources');
    }

    const conceptRouteList = [conceptRoute, ...relatedDomains]
        .filter(Boolean)
        .map(String);
    const dedupedConceptRoute = Array.from(new Set(conceptRouteList));
    const sourceSummary = sourcesActuallyUsed.length > 0
        ? sourcesActuallyUsed
        : (sourceList.length > 0 ? sourceList : prioritySourcesConsidered);
    const contextSummary = sourceSummary.length > 0
        ? sourceSummary
        : (courtSourcesConsidered.length > 0 ? courtSourcesConsidered : courtDomains);
    const dedupedContextSummary = Array.from(new Set(contextSummary.map(item => String(item))));
    const compactRoute = dedupedConceptRoute.length > 0
        ? dedupedConceptRoute.join(' → ')
        : null;
    const rows = [
        { key: 'Active archetype', value: courtLens || 'Ember Prime' },
        { key: 'Route', value: compactRoute },
        { key: 'Context', value: dedupedContextSummary.length > 0 ? boundedListText(dedupedContextSummary) : null },
        { key: 'Model', value: model },
        { key: 'Provider', value: provider },
    ];

    rows.forEach(row => {
        if (!row.value) return;
        const item = document.createElement('div');
        item.className = 'signal-trace-item';
        item.innerHTML =
            '<span class="trace-badge"><span class="trace-key">' +
            escapeHtml(row.key) + '</span> ' +
            escapeHtml(row.value) + '</span>';
        traceSources.appendChild(item);
    });

    if (retrievalNote) {
        const note = document.createElement('div');
        note.className = 'signal-trace-item';
        note.innerHTML =
            '<span class="trace-badge"><span class="trace-key">retrieval</span> ' +
            escapeHtml(retrievalNote) + '</span>';
        traceSources.appendChild(note);
    }

    if (!sources || sources.length === 0) {
        if (!contextStatus && !retrievalNote) setTraceStatus('base model — no local sources');
        return;
    }

    const count = sources.length;
    if (!contextStatus) {
        setTraceStatus(count + ' source' + (count === 1 ? '' : 's'));
    }

    // Auto-expand when there is compact trace content.
    const panel  = document.getElementById('signal-trace-panel');
    const toggle = document.getElementById('signal-trace-toggle');
    if (panel && traceSources.children.length > 0) {
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
    if (!chatContainer || !messageInput) return;
    if (_isChatGenerating) return;

    const message = messageInput.value.trim();
    if (!message) return;

    displayMessage(chatContainer, message, 'message-user');
    messageInput.value = '';
    chatContainer.scrollTop = chatContainer.scrollHeight;
    setChatState(CHAT_STATES.THINKING);
    setChatGenerationUi(true);
    _chatCancelledByUser = false;
    _activeChatContainer = chatContainer;
    _activeChatRequestId = nextChatRequestId();
    _activeChatAbortController = new AbortController();

    // Rune loading indicator — JS-driven symbol cycle
    const thinking = document.createElement('div');
    thinking.className = 'message-heart loading-rune thinking-bubble';
    const runeSpan = document.createElement('span');
    runeSpan.className = 'rune-symbol';
    const thinkingLabel = document.createElement('span');
    thinkingLabel.className = 'thinking-label';
    thinkingLabel.textContent = 'Signal resolving...';
    thinking.appendChild(runeSpan);
    thinking.appendChild(thinkingLabel);
    const cancelAnim = startRuneAnimation(runeSpan);
    chatContainer.appendChild(thinking);
    chatContainer.scrollTop = chatContainer.scrollHeight;

    setTraceStatus('retrieving…');
    const traceSources = document.getElementById('signal-trace-sources');
    if (traceSources) traceSources.innerHTML = '';
    _activeChatLongWaitTimer = setTimeout(() => {
        if (_isChatGenerating && _chatState === CHAT_STATES.THINKING) {
            displayMessage(
                chatContainer,
                'Ember Prime is taking longer than usual. You may wait or still the signal.',
                'message-system',
            );
            chatContainer.scrollTop = chatContainer.scrollHeight;
        }
    }, LONG_WAIT_THRESHOLD_MS);

    try {
        const activeCourtMember = getActiveCourtMemberId();
        const response = await fetch('/api/chat', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: _activeChatAbortController.signal,
            body:    JSON.stringify({
                query:     message,
                sourceIds: _chatRefs.length > 0 ? _chatRefs.map(r => r.sourceId) : undefined,
                courtMember: activeCourtMember || undefined,
                requestId: _activeChatRequestId,
            }),
        });

        const data = await response.json().catch(() => ({}));
        cleanupThinkingIndicator(chatContainer, thinking, cancelAnim);
        clearChatLongWaitTimer();

        if (response.status === 499 || (data && data.cancelled)) {
            displayMessage(chatContainer, 'Signal stilled by user.', 'message-system');
            setTraceStatus('response interrupted');
            setChatState(CHAT_STATES.INTERRUPTED);
        } else if (response.status === 504 || (data && data.timeout)) {
            displayMessage(
                chatContainer,
                data.message || 'Ember Prime is taking longer than usual. You may wait or still the signal.',
                'message-system',
            );
            setTraceStatus('timed out');
            setChatState(CHAT_STATES.ERROR);
        } else if (data && typeof data.answer === 'string') {
            const responseEl = displayMessage(chatContainer, '', 'message-heart message-heart-live');
            _activeChatResponseEl = responseEl;
            _activeChatRevealToken = { cancelled: false };
            setChatState(CHAT_STATES.RESOLVING);
            chatContainer.scrollTop = chatContainer.scrollHeight;
            setChatState(CHAT_STATES.RESPONDING);
            const revealResult = await resolveGlyphText(responseEl, data.answer, {
                glyphEffect: _glyphResolveEnabled,
                onFrame: () => { chatContainer.scrollTop = chatContainer.scrollHeight; },
                shouldStop: () => _activeChatRevealToken.cancelled,
            });

            if (revealResult && revealResult.interrupted) {
                displayMessage(chatContainer, 'Signal stilled by user.', 'message-system');
                setTraceStatus('response interrupted');
                setChatState(CHAT_STATES.INTERRUPTED);
            } else {
                renderSignalTrace(data.sources || [], data.signalTrace || null);
                setChatState(CHAT_STATES.COMPLETE);

                // Persist to thread if active
                if (hearthActiveThreadId) {
                    await saveMessageToThread(hearthActiveThreadId, 'user', message);
                    await saveMessageToThread(hearthActiveThreadId, 'assistant', data.answer);
                }
            }
        } else if (data && data.error) {
            console.warn('[chat] server returned error payload:', data.error);
            displayMessage(chatContainer, HEART_TECHNICAL_ERROR, 'message-system');
            setTraceStatus('error');
            setChatState(CHAT_STATES.ERROR);
        } else {
            console.warn('[chat] unreadable response payload from /api/chat');
            displayMessage(chatContainer, HEART_TECHNICAL_ERROR, 'message-system');
            setTraceStatus('unexpected response');
            setChatState(CHAT_STATES.ERROR);
        }
    } catch (err) {
        clearChatLongWaitTimer();
        console.warn('[chat] request to /api/chat failed (connection/runtime issue)');
        cleanupThinkingIndicator(chatContainer, thinking, cancelAnim);
        if (_chatCancelledByUser || (err && err.name === 'AbortError')) {
            displayMessage(chatContainer, 'Signal stilled by user.', 'message-system');
            setTraceStatus('response interrupted');
            setChatState(CHAT_STATES.INTERRUPTED);
        } else {
            displayMessage(chatContainer, HEART_TECHNICAL_ERROR, 'message-system');
            setTraceStatus('connection lost');
            setChatState(CHAT_STATES.ERROR);
        }
    } finally {
        chatContainer.scrollTop = chatContainer.scrollHeight;
        resetActiveChatState();
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
        const sources = (data.sources || []).filter(s => s.sourceClass !== 'trusted-archive');

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
   Hearth — Trusted Archive (Phase 11)
   ================================================================ */

async function loadHearthTrustedArchive() {
    const listEl = document.getElementById('hearth-trusted-archive-list');
    if (!listEl) return;

    try {
        const res  = await fetch('/api/archive');
        const data = await res.json();
        const sources = data.sources || [];

        if (sources.length === 0) {
            listEl.innerHTML = '<span class="message-system">No archive sources. Place files in <em>DATA_ROOT/archive/</em> and rescan.</span>';
            return;
        }

        listEl.innerHTML = '';
        sources.forEach(s => {
            const row = document.createElement('div');
            row.className = 'ws-source-row';
            const shelfBadge = s.shelf
                ? '<span class="lifecycle-pill" style="font-size:0.7rem; padding:0.1rem 0.5rem;">' + escapeHtml(s.shelf) + '</span>'
                : '';
            row.innerHTML =
                '<span class="ws-source-name">' + escapeHtml(s.title || s.file) + '</span>' +
                shelfBadge +
                '<span class="ws-source-type">' + escapeHtml(s.sourceType || '') + '</span>';
            listEl.appendChild(row);
        });
    } catch {
        listEl.innerHTML = '<span class="message-system">Could not load trusted archive.</span>';
    }
}

async function loadHearthRememberedThreads() {
    const listEl = document.getElementById('hearth-remembered-threads-list');
    if (!listEl) return;

    try {
        const res  = await fetch('/api/remembered-threads');
        const data = await res.json();
        const summaries = data.summaries || [];

        if (summaries.length === 0) {
            listEl.innerHTML = '<span class="message-system">No remembered threads yet. Use ★ in the Threads list to remember a thread.</span>';
            return;
        }

        listEl.innerHTML = '';
        summaries.forEach(s => {
            const row = document.createElement('div');
            row.className = 'ws-source-row';
            const themes = (s.themes || []).slice(0, 4).join(', ');
            row.innerHTML =
                '<div style="display:flex; flex-direction:column; gap:0.2rem;">' +
                '<span class="ws-source-name" style="font-weight:500;">★ ' + escapeHtml(s.title) + '</span>' +
                (themes ? '<span style="font-size:0.75rem; opacity:0.6;">' + escapeHtml(themes) + '</span>' : '') +
                (s.excerpt ? '<span style="font-size:0.75rem; opacity:0.5; font-style:italic;">' + escapeHtml(s.excerpt.slice(0, 100)) + '…</span>' : '') +
                '</div>';
            listEl.appendChild(row);
        });
    } catch {
        listEl.innerHTML = '<span class="message-system">Could not load remembered threads.</span>';
    }
}

function formatIsoDate(value) {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString();
}

function formatBytes(bytes) {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n <= 0) return '—';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB';
    return (n / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}

function cacheStatusLabel(status, installed) {
    if (status === 'update-available') return 'Update available';
    if (installed) return 'Installed';
    return 'Not installed';
}

function isBundledCorePackage(item) {
    return item && item.packageId === 'green-fire-core';
}

function cacheSourceLabel(item) {
    const source = (item && item.registry && item.registry.source) || '';
    if (isBundledCorePackage(item)) {
        return source === 'bundled' ? 'Bundled Core (seed memory)' : 'Bundled Core';
    }
    return 'Archive Cache';
}

function buildCacheConfirmMessage(mode, item, packageTitle, destination) {
    if (mode === 'update') {
        return [
            'Update this cache?',
            'Package: ' + packageTitle,
            'This will replace the existing cache folder:',
            item.packageId === 'green-fire-core' ? 'archive/core' : ('archive/caches/' + item.packageId),
        ].join('\n');
    }
    return [
        'Install this cache?',
        'Package: ' + packageTitle,
        'Destination: ' + destination,
        isBundledCorePackage(item)
            ? 'This will extract the bundled core seed locally (no first-run download).'
            : 'This will download and extract files locally.',
    ].join('\n');
}

async function installOrUpdateCache(packageId, mode, uiBtn, packageTitle, destination, item) {
    const confirmed = confirm(buildCacheConfirmMessage(mode, item, packageTitle, destination));
    if (!confirmed) return;

    const previous = uiBtn.textContent;
    uiBtn.disabled = true;
    uiBtn.textContent = mode === 'update' ? 'Updating…' : 'Installing…';
    try {
        const res = await fetch('/api/archive/caches/install', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ packageId }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
            showFlashMessage((mode === 'update' ? 'Update' : 'Install') + ' failed: ' + (data.error || 'unknown'));
            return;
        }
        showFlashMessage((mode === 'update' ? 'Updated' : 'Installed') + ': ' + packageTitle);
        loadHearthTrustedArchive();
        loadArchiveCacheManager();
        loadArchiveSignalPanel();
    } catch {
        showFlashMessage((mode === 'update' ? 'Update' : 'Install') + ' failed — server unreachable.');
    } finally {
        uiBtn.disabled = false;
        uiBtn.textContent = previous;
    }
}

async function loadArchiveCacheManager() {
    const listEl = document.getElementById('hearth-cache-manager-list');
    const metaEl = document.getElementById('hearth-cache-manager-meta');
    if (!listEl || !metaEl) return;

    listEl.innerHTML = '<span class="message-system">Loading cache packages…</span>';
    metaEl.textContent = 'Loading cache index…';

    try {
        const [updatesRes, availableRes] = await Promise.all([
            fetch('/api/archive/caches/updates'),
            fetch('/api/archive/caches/available'),
        ]);
        const updates = await updatesRes.json();
        const available = await availableRes.json();

        const upstreamById = new Map(((available && available.packages) || []).map(p => [p.packageId, p]));
        const rows = (updates && updates.comparison) || [];
        if (rows.length === 0) {
            listEl.innerHTML = '<span class="message-system">No canonical cache packages found.</span>';
            metaEl.textContent = 'No package metadata available.';
            return;
        }

        const fetchedAt = updates.fetchedAt || available.fetchedAt || null;
        metaEl.textContent = [
            'Source: ' + (updates.source || available.source || 'unknown'),
            updates.offline ? 'offline fallback' : 'live',
            fetchedAt ? 'updated ' + formatIsoDate(fetchedAt) : null,
        ].filter(Boolean).join(' · ');

        listEl.innerHTML = '';
        rows.forEach(item => {
            const upstream = item.upstreamPackage || upstreamById.get(item.packageId) || {};
            const registry = item.registry || {};
            const packageTitle = upstream.title || (item.manifest && item.manifest.title) || registry.title || item.packageId;
            const destination = item.recommendedDestination || registry.destination || ('archive/caches/' + item.packageId);
            const displayVersion = item.upstreamVersion || item.localVersion || registry.installedVersion || '—';
            const lastUpdated = upstream.lastUpdated || registry.lastUpdated || null;
            const sizeText = formatBytes(upstream.sizeBytes);
            const sourceText = cacheSourceLabel(item);

            const row = document.createElement('div');
            row.className = 'ws-source-row cache-manager-row';
            row.innerHTML =
                '<div class="cache-manager-main">' +
                    '<span class="ws-source-name">' + escapeHtml(packageTitle) + '</span>' +
                    '<span class="lifecycle-pill indexed">' + escapeHtml(cacheStatusLabel(item.status, item.installed)) + '</span>' +
                '</div>' +
                '<div class="cache-manager-meta">' +
                    'ID: ' + escapeHtml(item.packageId) + ' · ' +
                    'Version: ' + escapeHtml(displayVersion) + ' · ' +
                    'Last updated: ' + escapeHtml(formatIsoDate(lastUpdated)) + ' · ' +
                    'Type: ' + escapeHtml(sourceText) + ' · ' +
                    'Destination: ' + escapeHtml(destination) + ' · ' +
                    'Size: ' + escapeHtml(sizeText) +
                '</div>';

            const actionRow = document.createElement('div');
            actionRow.className = 'cache-manager-actions';

            const installBtn = document.createElement('button');
            installBtn.className = 'secondary';
            installBtn.textContent = isBundledCorePackage(item) ? 'Install Bundled' : 'Install';
            installBtn.disabled = Boolean(item.installed);
            installBtn.addEventListener('click', () => {
                installOrUpdateCache(item.packageId, 'install', installBtn, packageTitle, destination, item);
            });
            actionRow.appendChild(installBtn);

            const updateBtn = document.createElement('button');
            updateBtn.className = 'secondary';
            updateBtn.textContent = item.status === 'update-available' ? 'Update' : 'Reinstall';
            updateBtn.disabled = !item.installed;
            updateBtn.addEventListener('click', () => {
                installOrUpdateCache(item.packageId, 'update', updateBtn, packageTitle, destination, item);
            });
            actionRow.appendChild(updateBtn);

            row.appendChild(actionRow);
            listEl.appendChild(row);
        });
    } catch {
        listEl.innerHTML = '<span class="message-system">Could not load cache manager.</span>';
        metaEl.textContent = 'Cache index unavailable.';
    }
}

async function loadArchiveSignalPanel() {
    const panel = document.getElementById('hearth-archive-signal-panel');
    if (!panel) return;
    panel.innerHTML = '<span class="message-system">Loading signal…</span>';

    try {
        const [signalRes, resourcesRes] = await Promise.all([
            fetch('/api/archive/signal'),
            fetch('/api/archive/resources'),
        ]);
        const signalData = await signalRes.json();
        const resourcesData = await resourcesRes.json();
        const payload = signalData.payload || {};
        const endpoints = resourcesData.endpoints || {};

        const dispatch = payload.dispatch || payload.signal_dispatch || (payload.signal && payload.signal.dispatch) || '—';
        const question = payload.question || payload.signal_question || (payload.signal && payload.signal.question) || '—';
        const fetchedLabel = signalData.fetchedAt ? formatIsoDate(signalData.fetchedAt) : '—';

        panel.innerHTML =
            '<div class="cache-signal-line"><strong>Dispatch:</strong> ' + escapeHtml(dispatch) + '</div>' +
            '<div class="cache-signal-line"><strong>Question:</strong> ' + escapeHtml(question) + '</div>' +
            '<div class="cache-signal-line"><strong>Source:</strong> ' + escapeHtml(signalData.source || 'unknown') +
            (signalData.offline ? ' (offline)' : '') + ' · updated ' + escapeHtml(fetchedLabel) + '</div>' +
            '<div class="cache-signal-links">' +
                '<a href="' + escapeHtml(endpoints.forgeMd || '#') + '" target="_blank" rel="noopener noreferrer">Forge (MD)</a>' +
                '<a href="' + escapeHtml(endpoints.forgePdf || '#') + '" target="_blank" rel="noopener noreferrer">Forge (PDF)</a>' +
                '<a href="' + escapeHtml(endpoints.mythicSeedMd || '#') + '" target="_blank" rel="noopener noreferrer">Mythic Seed (MD)</a>' +
                '<a href="' + escapeHtml(endpoints.mythicSeedTxt || '#') + '" target="_blank" rel="noopener noreferrer">Mythic Seed (TXT)</a>' +
            '</div>';
    } catch {
        panel.innerHTML = '<span class="message-system">Could not load archive signal.</span>';
    }
}

// Archive bootstrap button
(function initArchiveBootstrap() {
    const btn = document.getElementById('hearth-archive-bootstrap-btn');
    if (!btn) return;
    btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = '↻ Scanning…';
        try {
            const res  = await fetch('/api/archive/bootstrap', { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                showFlashMessage('Archive scanned — ' + (data.registered || 0) + ' registered, ' + (data.indexed || 0) + ' indexed.');
                loadHearthTrustedArchive();
                loadArchiveCacheManager();
            } else {
                showFlashMessage('Archive scan failed.');
            }
        } catch {
            showFlashMessage('Could not reach server.');
        } finally {
            btn.disabled = false;
            btn.textContent = '↻ Refresh';
        }
    });
})();

(function initCacheManagerRescan() {
    const btn = document.getElementById('hearth-cache-manager-rescan-btn');
    if (!btn) return;
    btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = '↻ Refreshing…';
        try {
            await loadArchiveCacheManager();
            await loadArchiveSignalPanel();
        } finally {
            btn.disabled = false;
            btn.textContent = '↻ Refresh';
        }
    });
})();

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
    // Scribe is the default Workshop sub-tab — load documents on panel open
    loadDocuments();
}

/* ================================================================
   Phase 9 — Scribe Forge: Document Editor
   ================================================================ */

/** Currently open document ID (null when no document is open). */
let _activeDocId       = null;
/** Last Heart response text, for Insert Response action. */
let _lastHeartResponse = null;
/** Autosave debounce timer handle. */
let _autosaveTimer     = null;

/**
 * Load and render the document list in the Scribe sidebar.
 */
async function loadDocuments() {
    const listEl = document.getElementById('scribe-doc-list');
    if (!listEl) return;
    listEl.innerHTML = '<span class="message-system">Loading…</span>';

    try {
        const res  = await fetch('/api/documents');
        const data = await res.json();
        const docs = data.documents || [];

        if (docs.length === 0) {
            listEl.innerHTML = '<span class="message-system">No documents yet. Create one to begin.</span>';
            return;
        }

        listEl.innerHTML = '';
        docs.forEach(doc => {
            const item = document.createElement('div');
            item.className = 'scribe-doc-item' + (doc.id === _activeDocId ? ' active' : '');
            item.dataset.docId = doc.id;

            const typeBadge = doc.type && doc.type !== 'note'
                ? '<span class="scribe-type-badge">' + escapeHtml(doc.type) + '</span>'
                : '';
            item.innerHTML =
                '<div class="scribe-doc-item-title">' + escapeHtml(doc.title || 'Untitled') + typeBadge + '</div>' +
                '<div class="scribe-doc-item-date">' + escapeHtml(new Date(doc.updatedAt).toLocaleDateString()) + '</div>';

            item.addEventListener('click', () => openDocument(doc.id));
            listEl.appendChild(item);
        });
    } catch {
        listEl.innerHTML = '<span class="message-system">Could not load documents.</span>';
    }
}

/**
 * Open a document in the editor panel.
 * @param {string} id  Document ID
 */
async function openDocument(id) {
    try {
        const res  = await fetch('/api/documents/' + encodeURIComponent(id));
        const data = await res.json();
        const doc  = data.document;
        if (!doc) { showFlashMessage('Document not found.'); return; }

        _activeDocId = doc.id;

        const titleEl   = document.getElementById('scribe-doc-title');
        const contentEl = document.getElementById('scribe-doc-content');
        const typeEl    = document.getElementById('scribe-doc-type');
        const deleteBtn = document.getElementById('scribe-delete-btn');

        if (titleEl)   titleEl.value   = doc.title   || '';
        if (contentEl) contentEl.value = doc.content || '';
        if (typeEl)    typeEl.value    = doc.type    || 'note';
        if (deleteBtn) deleteBtn.style.display = '';

        setScribeSaveStatus('');

        // Highlight active item in list
        document.querySelectorAll('.scribe-doc-item').forEach(el => {
            el.classList.toggle('active', el.dataset.docId === id);
        });
    } catch {
        showFlashMessage('Could not open document.');
    }
}

/**
 * Create a new blank document and open it.
 */
async function newDocument() {
    try {
        const res  = await fetch('/api/documents', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ title: 'Untitled', content: '', type: 'note' }),
        });
        const data = await res.json();
        if (data.success) {
            await loadDocuments();
            openDocument(data.document.id);
        }
    } catch {
        showFlashMessage('Could not create document.');
    }
}

/**
 * Save the currently open document.
 */
async function saveDocument() {
    if (!_activeDocId) return;

    const titleEl   = document.getElementById('scribe-doc-title');
    const contentEl = document.getElementById('scribe-doc-content');
    const typeEl    = document.getElementById('scribe-doc-type');

    const title   = titleEl   ? titleEl.value   : '';
    const content = contentEl ? contentEl.value : '';
    const type    = typeEl    ? typeEl.value    : 'note';

    setScribeSaveStatus('Saving…');
    try {
        const res  = await fetch('/api/documents/' + encodeURIComponent(_activeDocId), {
            method:  'PUT',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ title, content, type }),
        });
        const data = await res.json();
        if (data.success) {
            setScribeSaveStatus('Saved ✓');
            setTimeout(() => setScribeSaveStatus(''), 2000);
            // Refresh document list title
            loadDocuments();
        } else {
            setScribeSaveStatus('Save failed');
        }
    } catch {
        setScribeSaveStatus('Save failed');
    }
}

/**
 * Delete the currently open document after confirmation.
 */
async function deleteActiveDocument() {
    if (!_activeDocId) return;
    if (!confirm('Delete this document? This cannot be undone.')) return;

    try {
        const res = await fetch('/api/documents/' + encodeURIComponent(_activeDocId), {
            method: 'DELETE',
        });
        const data = await res.json();
        if (data.success) {
            _activeDocId = null;
            const titleEl   = document.getElementById('scribe-doc-title');
            const contentEl = document.getElementById('scribe-doc-content');
            const typeEl    = document.getElementById('scribe-doc-type');
            const deleteBtn = document.getElementById('scribe-delete-btn');
            if (titleEl)   titleEl.value   = '';
            if (contentEl) contentEl.value = '';
            if (typeEl)    typeEl.value    = 'note';
            if (deleteBtn) deleteBtn.style.display = 'none';
            setScribeSaveStatus('');
            showFlashMessage('Document deleted.');
            loadDocuments();
        }
    } catch {
        showFlashMessage('Could not delete document.');
    }
}

/**
 * Set the save-status indicator text.
 * @param {string} text
 */
function setScribeSaveStatus(text) {
    const el = document.getElementById('scribe-save-status');
    if (el) el.textContent = text;
}

/**
 * Schedule an autosave 2 seconds after the user stops typing.
 */
function scheduleAutosave() {
    clearTimeout(_autosaveTimer);
    setScribeSaveStatus('Unsaved…');
    _autosaveTimer = setTimeout(saveDocument, 2000);
}

/**
 * Send the current document content to Ember Prime for scribe assistance.
 * Renders the response in the Scribe Ember Prime panel.
 */
async function sendDocumentToHeart() {
    if (!_activeDocId) {
        showFlashMessage('Open or create a document first.');
        return;
    }

    const titleEl   = document.getElementById('scribe-doc-title');
    const contentEl = document.getElementById('scribe-doc-content');
    const chatEl    = document.getElementById('scribe-heart-chat');
    const sendBtn   = document.getElementById('scribe-send-to-heart-btn');
    const insertBtn = document.getElementById('scribe-insert-response-btn');

    const title   = titleEl   ? titleEl.value.trim()   : '';
    const content = contentEl ? contentEl.value.trim() : '';

    if (!content) {
        showFlashMessage('Write something in the editor first.');
        return;
    }

    if (chatEl) chatEl.innerHTML = '';
    if (sendBtn) sendBtn.disabled = true;
    if (insertBtn) insertBtn.style.display = 'none';

    // Build the query: include title and full document text as context.
    // Escape double-quotes in the title so the prompt structure is preserved.
    const safeTitle = title.replace(/"/g, '\u201c').replace(/'/g, '\u2018');
    const query =
        'I am working on a document titled "' + safeTitle + '".\n\n' +
        'Here is the current draft:\n\n' +
        content + '\n\n' +
        'Please help me refine, expand, or improve this writing. ' +
        'Suggest structural improvements, identify key themes, and help strengthen the work.';

    let cancelAnim = null;
    let thinkingEl = null;
    try {
        if (chatEl) {
            thinkingEl = document.createElement('div');
            thinkingEl.className = 'message-heart loading-rune thinking-bubble';
            const runeEl = document.createElement('span');
            runeEl.className = 'rune-symbol';
            const labelEl = document.createElement('span');
            labelEl.className = 'thinking-label';
            labelEl.textContent = 'Signal resolving...';
            thinkingEl.appendChild(runeEl);
            thinkingEl.appendChild(labelEl);
            chatEl.appendChild(thinkingEl);
            cancelAnim = startRuneAnimation(runeEl);
        }

        const res  = await fetch('/api/chat', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
                query,
                courtMember: getActiveCourtMemberId() || undefined,
            }),
        });
        const data = await res.json();
        cleanupThinkingIndicator(chatEl, thinkingEl, cancelAnim);
        const answer = (data && data.answer) ? data.answer : '(no response)';
        _lastHeartResponse = answer;

        if (chatEl) {
            chatEl.innerHTML = '';
            const responseEl = document.createElement('div');
            responseEl.className = 'message-heart scribe-heart-response';
            chatEl.appendChild(responseEl);
            await resolveGlyphText(responseEl, answer, {
                glyphEffect: _glyphResolveEnabled,
                onFrame: () => { chatEl.scrollTop = chatEl.scrollHeight; },
            });
        }

        if (insertBtn) insertBtn.style.display = '';
    } catch {
        console.warn('[scribe] request to /api/chat failed while sending document');
        cleanupThinkingIndicator(chatEl, thinkingEl, cancelAnim);
        if (chatEl) chatEl.innerHTML = '<span class="message-system">' + HEART_TECHNICAL_ERROR + '</span>';
        showFlashMessage('Ember Prime could not complete the response.');
    } finally {
        if (sendBtn) sendBtn.disabled = false;
    }
}

/**
 * Insert the last Ember Prime response into the current document (appended).
 */
function insertHeartResponse() {
    if (!_lastHeartResponse) return;
    const contentEl = document.getElementById('scribe-doc-content');
    if (!contentEl) return;

    const separator = '\n\n---\n\n';
    contentEl.value = (contentEl.value || '') + separator + _lastHeartResponse;
    contentEl.scrollTop = contentEl.scrollHeight;
    contentEl.focus();
    scheduleAutosave();
    showFlashMessage('Ember Prime response inserted ✓');
}

/** Initialize Scribe panel event listeners. */
(function initScribe() {
    document.addEventListener('DOMContentLoaded', () => {
        const newDocBtn   = document.getElementById('scribe-new-doc-btn');
        const saveBtn     = document.getElementById('scribe-save-btn');
        const deleteBtn   = document.getElementById('scribe-delete-btn');
        const sendBtn     = document.getElementById('scribe-send-to-heart-btn');
        const insertBtn   = document.getElementById('scribe-insert-response-btn');
        const contentEl   = document.getElementById('scribe-doc-content');
        const titleEl     = document.getElementById('scribe-doc-title');

        if (newDocBtn) newDocBtn.addEventListener('click', newDocument);
        if (saveBtn)   saveBtn.addEventListener('click', saveDocument);
        if (deleteBtn) deleteBtn.addEventListener('click', deleteActiveDocument);
        if (sendBtn)   sendBtn.addEventListener('click', sendDocumentToHeart);
        if (insertBtn) insertBtn.addEventListener('click', insertHeartResponse);

        // Autosave on content change
        if (contentEl) contentEl.addEventListener('input', scheduleAutosave);
        if (titleEl)   titleEl.addEventListener('input', scheduleAutosave);
    });
})();

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
   Workshop — Caches sub-tab
   ================================================================ */

async function loadCacheShelf() {
    window._cachesLoaded = true;

    const listEl    = document.getElementById('cache-list');
    const loadingEl = document.getElementById('cache-loading');

    try {
        const res  = await fetch('/caches');
        const data = await res.json();
        const caches = data.caches || [];

        if (loadingEl) loadingEl.remove();

        if (caches.length === 0) {
            listEl.innerHTML = '<div class="message-system">No caches found.</div>';
            updateSystemCacheCount(0);
            return;
        }

        listEl.innerHTML = '';
        caches.forEach(c => {
            const item = document.createElement('div');
            item.className = 'cache-item';
            item.dataset.cacheId = c.id;
            item.innerHTML =
                '<div class="cache-item-name">' + escapeHtml(c.name) + '</div>' +
                '<div class="cache-item-type">' + escapeHtml(c.type || 'cache') + '</div>';
            item.addEventListener('click', () => inspectCache(c.id, item));
            listEl.appendChild(item);
        });

        updateSystemCacheCount(caches.length);
    } catch {
        if (loadingEl) loadingEl.remove();
        if (listEl) listEl.innerHTML = '<div class="message-system">Could not load caches.</div>';
    }

    // Also load user caches
    loadUserCaches();
}

async function loadUserCaches() {
    const listEl = document.getElementById('user-cache-list');
    if (!listEl) return;

    try {
        const res  = await fetch('/api/user-caches');
        const data = await res.json();
        const caches = data.caches || [];

        if (caches.length === 0) {
            listEl.innerHTML = '<span class="message-system">None created yet.</span>';
            return;
        }

        listEl.innerHTML = '';
        caches.forEach(c => {
            const item = document.createElement('div');
            item.className = 'cache-item';
            item.innerHTML =
                '<div class="cache-item-name">' + escapeHtml(c.title) + '</div>' +
                '<div class="cache-item-type">user cache</div>';
            item.addEventListener('click', () => inspectUserCache(c));
            listEl.appendChild(item);
        });
    } catch {
        listEl.innerHTML = '<span class="message-system">Could not load.</span>';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const newCacheBtn = document.getElementById('new-cache-btn');
    if (newCacheBtn) {
        newCacheBtn.addEventListener('click', async () => {
            const title = prompt('Cache title:');
            if (!title) return;
            const description = prompt('Short description (optional):') || '';
            try {
                const res  = await fetch('/api/user-caches', {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify({ title, description }),
                });
                const data = await res.json();
                if (data.success) loadUserCaches();
            } catch { /* ignore */ }
        });
    }
});

function inspectUserCache(c) {
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
    if (metaEl) metaEl.innerHTML = '<span class="meta-badge"><strong>user</strong>&nbsp;cache</span>';
    if (permsEl) permsEl.innerHTML = '';
    if (contentEl) contentEl.textContent = c.notes || '(no notes)';
}

async function inspectCache(id, itemEl) {
    document.querySelectorAll('.cache-item').forEach(el => {
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
        const res  = await fetch('/caches/' + encodeURIComponent(id));
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
            contentEl.textContent = data.content || '(no readable documents in this cache)';
        }
    } catch {
        if (contentEl) contentEl.textContent = 'Error loading cache content.';
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

            // Show timestamps for changed files
            if (entry.ingestTimestamp) {
                const ts1 = document.createElement('div');
                ts1.className   = 'tq-changed-note';
                ts1.textContent = 'Last indexed: ' + new Date(entry.ingestTimestamp).toLocaleString();
                meta.appendChild(ts1);
            }
            if (entry.mtime) {
                const ts2 = document.createElement('div');
                ts2.className   = 'tq-changed-note';
                ts2.textContent = 'Last modified: ' + new Date(entry.mtime).toLocaleString();
                meta.appendChild(ts2);
            }
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

            const rejectUpdateBtn = document.createElement('button');
            rejectUpdateBtn.className   = 'secondary tq-action-btn threshold-reject-btn';
            rejectUpdateBtn.textContent = 'Reject update';
            rejectUpdateBtn.title       = 'Reject this file change — will not resurface until changed again';
            rejectUpdateBtn.addEventListener('click', async () => {
                if (!entry.sourceId) {
                    _intakeQueue = _intakeQueue.filter(e => e !== entry);
                    renderIntakeQueue();
                    return;
                }
                rejectUpdateBtn.disabled = true;
                try {
                    await fetch('/api/sources/' + encodeURIComponent(entry.sourceId) + '/reject', {
                        method: 'POST',
                    });
                    showFlashMessage('Update rejected — file will not resurface until changed again.');
                } catch { /* ignore */ }
                _intakeQueue = _intakeQueue.filter(e => e !== entry);
                renderIntakeQueue();
                loadThresholdList();
            });

            aside.appendChild(reImportBtn);
            aside.appendChild(keepBtn);
            aside.appendChild(rejectUpdateBtn);
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
 *
 * @param {boolean} [autoLoad=false]  When true, automatically loads unmanaged
 *   threshold files into the intake queue without requiring a button click.
 */
async function checkDetectedFiles(autoLoad) {
    try {
        const res  = await fetch('/api/detected-files');
        const data = await res.json();

        const unmanaged = (data.unmanaged || []).filter(f => !_dismissedDetected.has(f.path));
        const changed   = (data.changed   || []).filter(f => !_dismissedDetected.has(f.path));
        const total     = unmanaged.length + changed.length;

        // Auto-load unmanaged threshold files into the queue when entering
        // the Threshold room — no button click required.
        if (autoLoad) {
            const thresholdUnmanaged = unmanaged.filter(f => f.room === 'threshold');
            if (thresholdUnmanaged.length > 0) {
                loadDetectedIntoQueue(thresholdUnmanaged, []);
            }
            // Still show changed-files notice for non-threshold or changed files
            const nonAutoFiles = [
                ...unmanaged.filter(f => f.room !== 'threshold'),
                ...changed,
            ];
            if (nonAutoFiles.length === 0) return;
            // Show notice only for the remaining items
            const notice     = document.getElementById('detected-notice');
            const noticeText = document.getElementById('detected-notice-text');
            const reviewBtn  = document.getElementById('detected-review-btn');
            const dismissBtn = document.getElementById('detected-dismiss-btn');
            if (!notice) return;
            const parts = [];
            const nonChangedNew = nonAutoFiles.filter(f => !changed.includes(f));
            if (nonChangedNew.length > 0) {
                parts.push(nonChangedNew.length + ' new file' + (nonChangedNew.length === 1 ? '' : 's') + ' detected in local storage');
            }
            const pendingChanged = changed.filter(f => !_dismissedDetected.has(f.path));
            if (pendingChanged.length > 0) {
                parts.push(pendingChanged.length + ' file' + (pendingChanged.length === 1 ? '' : 's') + ' changed since last import');
            }
            if (parts.length === 0) { notice.style.display = 'none'; return; }
            if (noticeText) noticeText.textContent = parts.join(' · ');
            notice.style.display = 'flex';
            if (reviewBtn) {
                const newBtn = reviewBtn.cloneNode(true);
                reviewBtn.parentNode.replaceChild(newBtn, reviewBtn);
                newBtn.addEventListener('click', () => {
                    loadDetectedIntoQueue(
                        unmanaged.filter(f => f.room !== 'threshold'),
                        changed,
                    );
                    notice.style.display = 'none';
                });
            }
            if (dismissBtn) {
                const newDismiss = dismissBtn.cloneNode(true);
                dismissBtn.parentNode.replaceChild(newDismiss, dismissBtn);
                newDismiss.addEventListener('click', () => {
                    [...unmanaged, ...changed].forEach(f => _dismissedDetected.add(f.path));
                    notice.style.display = 'none';
                });
            }
            return;
        }

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
            mtime:           f.mtime           || null,
            ingestTimestamp: f.ingestTimestamp  || null,
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

    // ── Batch action bar ─────────────────────────────────────────────────────
    // Collect non-rejected, non-metaOnly files with sourceIds for batch ops
    const batchable = files.filter(f =>
        f.sourceId && !f.metaOnly && (!f.intake || f.intake.state !== 'rejected')
    );

    if (batchable.length > 1) {
        const batchBar = document.createElement('div');
        batchBar.className = 'threshold-batch-bar';

        const admitAllBtn = document.createElement('button');
        admitAllBtn.className = 'threshold-action-btn threshold-admit-btn';
        admitAllBtn.textContent = 'Admit All (' + batchable.length + ')';
        admitAllBtn.title = 'Admit all waiting files to Ember Council';
        admitAllBtn.addEventListener('click', async () => {
            admitAllBtn.disabled = true;
            admitAllBtn.textContent = 'Admitting…';
            let successCount = 0;
            let failCount    = 0;
            for (const f of batchable) {
                try {
                    const r = await fetch('/api/threshold/admit', {
                        method:  'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body:    JSON.stringify({ sourceId: f.sourceId }),
                    });
                    const d = await r.json();
                    if (d.success) { successCount++; } else { failCount++; }
                } catch { failCount++; }
            }
            const msg = successCount + ' admitted' + (failCount > 0 ? ', ' + failCount + ' failed' : '') + '.';
            showFlashMessage(msg);
            refreshSystemStatus();
            loadThresholdList();
        });

        const rejectAllBtn = document.createElement('button');
        rejectAllBtn.className = 'secondary threshold-action-btn threshold-reject-btn';
        rejectAllBtn.textContent = 'Reject All (' + batchable.length + ')';
        rejectAllBtn.title = 'Persistently reject all waiting files';
        rejectAllBtn.addEventListener('click', async () => {
            rejectAllBtn.disabled = true;
            rejectAllBtn.textContent = 'Rejecting…';
            for (const f of batchable) {
                try {
                    await fetch('/api/sources/' + encodeURIComponent(f.sourceId) + '/reject', {
                        method: 'POST',
                    });
                } catch { /* ignore individual failures */ }
            }
            showFlashMessage(batchable.length + ' files rejected.');
            loadThresholdList();
        });

        batchBar.appendChild(admitAllBtn);
        batchBar.appendChild(rejectAllBtn);
        listEl.appendChild(batchBar);
    }

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

    // Dim rejected rows
    const intakeState = f.intake && f.intake.state;
    if (intakeState === 'rejected') {
        row.className += ' intake-rejected';
    }

    const titleText = f.title || f.filename;

    const nameEl = document.createElement('div');
    nameEl.style.cssText = 'flex:1; min-width:0;';

    let nameHtml = '<div class="threshold-file-name">' + escapeHtml(titleText);
    if (f.status === 'flagged') {
        nameHtml += ' <span class="status-badge flagged">Flagged</span>';
    } else if (isChanged) {
        nameHtml += ' <span class="status-badge changed">Changed</span>';
    }
    if (intakeState === 'rejected') {
        nameHtml += ' <span class="status-badge rejected">Rejected</span>';
    } else if (intakeState === 'inspected') {
        nameHtml += ' <span class="status-badge inspected">Inspected</span>';
    }
    nameHtml += '</div>';

    if (f.shelf) {
        nameHtml += '<div class="source-card-filename">Shelf: ' + escapeHtml(f.shelf) + '</div>';
    }
    if (f.description) {
        nameHtml += '<div class="source-card-description">' + escapeHtml(f.description) + '</div>';
    }
    nameHtml += '<div class="source-card-filename">' + escapeHtml(f.filename) + '</div>';

    // Show timestamps for changed files
    if (isChanged) {
        if (f.ingestTimestamp) {
            nameHtml += '<div class="source-card-filename tq-changed-note">Last indexed: ' +
                escapeHtml(new Date(f.ingestTimestamp).toLocaleString()) + '</div>';
        }
        if (f.mtime) {
            nameHtml += '<div class="source-card-filename tq-changed-note">Last modified: ' +
                escapeHtml(new Date(f.mtime).toLocaleString()) + '</div>';
        }
    }

    nameEl.innerHTML = nameHtml;

    const actions = document.createElement('span');
    actions.className = 'threshold-file-actions';

    // Status badge (for non-flagged files without an explicit intake badge)
    if (f.status && f.status !== 'flagged' && intakeState !== 'rejected' && intakeState !== 'inspected') {
        const statusBadge = document.createElement('span');
        statusBadge.className = 'status-badge ' + (f.status || 'waiting');
        statusBadge.textContent = (f.status || 'waiting').charAt(0).toUpperCase() + (f.status || 'waiting').slice(1);
        actions.appendChild(statusBadge);
    }

    // Only show action buttons when source is not rejected
    if (intakeState !== 'rejected') {
        // ── PRIMARY ACTION: Admit to Workshop ────────────────────────────────
        // Combines inspect + index + move into one click.  Shown for non-metaOnly
        // files with a sourceId.  This is the main intake action.
        if (!f.metaOnly && f.sourceId) {
            const admitBtn = document.createElement('button');
            admitBtn.className = 'threshold-action-btn threshold-admit-btn';
            admitBtn.textContent = 'Admit to Ember Council';
            admitBtn.title = 'Inspect, index, and move to Ember Council in one step';
            admitBtn.addEventListener('click', async () => {
                admitBtn.disabled = true;
                admitBtn.textContent = 'Admitting…';
                try {
                    const r = await fetch('/api/threshold/admit', {
                        method:  'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body:    JSON.stringify({ sourceId: f.sourceId }),
                    });
                    const d = await r.json();
                    if (d.success) {
                        showFlashMessage(
                            d.indexWarning
                                ? 'Admitted to Ember Council (index skipped: ' + d.indexWarning + ')'
                                : 'Admitted to Ember Council ✓',
                        );
                        refreshSystemStatus();
                        loadThresholdList();
                    } else {
                        admitBtn.textContent = 'Failed';
                        admitBtn.title = d.error || 'Admit failed';
                        admitBtn.disabled = false;
                        showFlashMessage('Admit failed: ' + (d.error || 'Unknown error'));
                    }
                } catch {
                    admitBtn.textContent = 'Error';
                    admitBtn.disabled = false;
                    showFlashMessage('Could not reach server — Admit failed.');
                }
            });
            actions.appendChild(admitBtn);
        }

        // ── SECONDARY: Inspect (deep view, auto-marks inspected) ─────────────
        if (f.sourceId) {
            const inspBtn = document.createElement('button');
            inspBtn.className = 'secondary threshold-action-btn';
            inspBtn.textContent = 'Inspect';
            inspBtn.title = 'View file details (marks as inspected)';
            inspBtn.addEventListener('click', async () => {
                inspBtn.disabled = true;
                try {
                    // Auto-mark inspected on preview open
                    await fetch('/api/sources/' + encodeURIComponent(f.sourceId) + '/inspect', {
                        method: 'POST',
                    });
                    inspectSource(f.sourceId);
                    loadThresholdList();
                } catch {
                    inspBtn.disabled = false;
                }
            });
            actions.appendChild(inspBtn);
        }

        // Flag / Unflag button
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

        // Advanced: Index-only and Move-only (shown as secondary actions)
        if (!f.metaOnly && f.sourceId) {
            const indexBtn = document.createElement('button');
            indexBtn.className = 'secondary threshold-action-btn';
            indexBtn.textContent = 'Index';
            indexBtn.title = 'Index file without moving';
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
                        showFlashMessage('Indexing failed: ' + (d.error || 'Unknown error'));
                    }
                } catch {
                    indexBtn.textContent = 'Error';
                    indexBtn.disabled = false;
                    showFlashMessage('Could not reach server — indexing failed.');
                }
            });

            const moveBtn = document.createElement('button');
            moveBtn.className = 'secondary threshold-action-btn';
            moveBtn.textContent = '→ Ember Council';
            moveBtn.title = 'Move to Ember Council without re-indexing';
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
                        moveBtn.textContent = '✓ Ember Council';
                        loadThresholdList();
                    } else {
                        moveBtn.disabled = false;
                        showFlashMessage('Move failed: ' + (d.error || 'Unknown error'));
                    }
                } catch {
                    moveBtn.disabled = false;
                    showFlashMessage('Could not reach server — move failed.');
                }
            });

            actions.appendChild(indexBtn);
            actions.appendChild(moveBtn);
        }

        // Reject button — persistent rejection
        if (f.sourceId) {
            const rejectBtn = document.createElement('button');
            rejectBtn.className = 'secondary threshold-action-btn threshold-reject-btn';
            rejectBtn.textContent = 'Reject';
            rejectBtn.title = 'Persistently reject — removes from intake queue until file changes';
            rejectBtn.addEventListener('click', async () => {
                rejectBtn.disabled = true;
                try {
                    await fetch('/api/sources/' + encodeURIComponent(f.sourceId) + '/reject', {
                        method: 'POST',
                    });
                    showFlashMessage('File rejected — will not resurface unless changed.');
                    loadThresholdList();
                } catch {
                    rejectBtn.disabled = false;
                    showFlashMessage('Could not reach server — reject failed.');
                }
            });
            actions.appendChild(rejectBtn);
        }
    } else {
        // Rejected — offer an "Undo reject" button via re-inspect
        if (f.sourceId) {
            const undoBtn = document.createElement('button');
            undoBtn.className = 'secondary threshold-action-btn';
            undoBtn.textContent = 'Undo Reject';
            undoBtn.title = 'Return to Waiting state';
            undoBtn.addEventListener('click', async () => {
                undoBtn.disabled = true;
                try {
                    await fetch('/api/sources/' + encodeURIComponent(f.sourceId) + '/inspect', {
                        method: 'POST',
                    });
                    showFlashMessage('Rejection cleared — file returned to intake.');
                    loadThresholdList();
                } catch {
                    undoBtn.disabled = false;
                    showFlashMessage('Could not reach server — undo failed.');
                }
            });
            actions.appendChild(undoBtn);
        }
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
    const modelSelectEl = document.getElementById('sys-model-select');
    const modelSaveBtnEl = document.getElementById('sys-model-save-btn');
    const modelSelectionStatusEl = document.getElementById('sys-model-selection-status');
    const chunksEl  = document.getElementById('sys-indexed-chunks');
    const sourcesEl = document.getElementById('sys-indexed-sources');
    const nodeRuntimeStatusEl = document.getElementById('sys-node-runtime-status');
    const nodeRuntimePathEl = document.getElementById('sys-node-runtime-path');

    try {
        const res  = await fetch('/api/status');
        const data = await res.json();
        if (chunksEl)  chunksEl.textContent  = String(data.indexedChunks  ?? 0);
        if (sourcesEl) sourcesEl.textContent = String(data.indexedSources ?? 0);
        updateSystemCacheCount(data.cacheCount ?? 0);
        if (nodeRuntimeStatusEl) {
            nodeRuntimeStatusEl.textContent = data.nodeRuntimeStatus || 'Missing';
            if (data.nodeRuntimeSource === 'bundled') {
                nodeRuntimeStatusEl.className = 'system-val ok';
            } else if (data.nodeRuntimeSource === 'system') {
                nodeRuntimeStatusEl.className = 'system-val';
            } else {
                nodeRuntimeStatusEl.className = 'system-val error';
            }
        }
        if (nodeRuntimePathEl) {
            nodeRuntimePathEl.textContent = data.nodeRuntimePath || '—';
        }
    } catch {
        if (nodeRuntimeStatusEl) {
            nodeRuntimeStatusEl.textContent = 'Missing';
            nodeRuntimeStatusEl.className = 'system-val error';
        }
        if (nodeRuntimePathEl) {
            nodeRuntimePathEl.textContent = '—';
        }
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

    try {
        const res = await fetch('/api/ai/models');
        const data = await res.json();
        activeModelLabel = data.selected_model || DEFAULT_MODEL_LABEL;
        if (modelEl) {
            modelEl.textContent = activeModelLabel;
        }
        if (modelSelectEl) {
            const models = Array.isArray(data.models) ? data.models : [];
            const options = models
                .map(m => `<option value="${escapeHtml(m.name)}">${escapeHtml(m.name)}</option>`)
                .join('');
            modelSelectEl.innerHTML = options || '<option value="">No models detected</option>';
            if (data.selected_model && models.some(m => m.name === data.selected_model)) {
                modelSelectEl.value = data.selected_model;
            }
            modelSelectEl.disabled = !data.available || models.length === 0;
        }
        if (modelSaveBtnEl) {
            modelSaveBtnEl.disabled = !data.available || !modelSelectEl || !modelSelectEl.value;
        }
        if (modelSelectionStatusEl) {
            modelSelectionStatusEl.textContent = data.available ? 'ready' : 'unavailable';
            modelSelectionStatusEl.className = data.available ? 'system-val ok' : 'system-val error';
        }
    } catch {
        activeModelLabel = DEFAULT_MODEL_LABEL;
        if (modelEl) modelEl.textContent = DEFAULT_MODEL_LABEL;
        if (modelSelectEl) {
            modelSelectEl.innerHTML = '<option value="">No models detected</option>';
            modelSelectEl.disabled = true;
        }
        if (modelSaveBtnEl) modelSaveBtnEl.disabled = true;
        if (modelSelectionStatusEl) {
            modelSelectionStatusEl.textContent = 'unavailable';
            modelSelectionStatusEl.className = 'system-val error';
        }
    }

    updateHeaderStatus();
    loadNodeStatusUpdates();
}

(function initModelSelectionButton() {
    document.addEventListener('click', async (e) => {
        if (!e.target || e.target.id !== 'sys-model-save-btn') return;
        const selectEl = document.getElementById('sys-model-select');
        const statusEl = document.getElementById('sys-model-selection-status');
        const buttonEl = e.target;
        const model = selectEl ? String(selectEl.value || '').trim() : '';
        if (!model) return;

        buttonEl.disabled = true;
        if (statusEl) {
            statusEl.textContent = 'saving…';
            statusEl.className = 'system-val';
        }
        try {
            const res = await fetch('/api/ai/models/select', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model }),
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Could not save model');
            }
            activeModelLabel = data.selected_model || model;
            if (statusEl) {
                statusEl.textContent = 'saved';
                statusEl.className = 'system-val ok';
            }
            showFlashMessage('Heart model set to ' + activeModelLabel + '.');
            await refreshSystemStatus();
        } catch (err) {
            if (statusEl) {
                statusEl.textContent = 'failed';
                statusEl.className = 'system-val error';
            }
            showFlashMessage(err.message || 'Could not save model.');
        } finally {
            buttonEl.disabled = false;
        }
    });
})();

function setShutdownStatus(message, cssClass = '') {
    const statusEl = document.getElementById('sys-shutdown-status');
    if (!statusEl) return;
    statusEl.textContent = message || '';
    statusEl.className = cssClass ? ('message-system ' + cssClass) : 'message-system';
}

async function requestSystemShutdown(buttonEl) {
    const btn = buttonEl || document.getElementById('sys-shutdown-btn');
    if (!btn) return;

    btn.disabled = true;
    setShutdownStatus('Sending shutdown signal…');
    try {
        const res = await fetch('/api/system/shutdown', { method: 'POST' });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'shutdown failed');
        setShutdownStatus('Ember Node is returning to slumber. You may close this window.');
    } catch (err) {
        console.warn('[system] shutdown request failed:', err?.message || err);
        setShutdownStatus('Unable to shut down cleanly. You may close the terminal manually.', 'error');
        btn.disabled = false;
    }
}

(function initSystemShutdownButton() {
    document.addEventListener('click', (e) => {
        if (e.target && e.target.id === 'sys-shutdown-btn') {
            requestSystemShutdown(e.target);
        }
    });
})();

function setMaintenanceStatus(message, cssClass = '') {
    const statusEl = document.getElementById('sys-maintenance-status');
    if (!statusEl) return;
    statusEl.textContent = message || '';
    statusEl.className = cssClass ? ('message-system ' + cssClass) : 'message-system';
}

async function requestRefreshNode(buttonEl) {
    const btn = buttonEl || document.getElementById('sys-refresh-node-btn');
    if (!btn) return;
    btn.disabled = true;
    setMaintenanceStatus('Refreshing node state…');
    try {
        const res = await fetch('/api/system/refresh-node', { method: 'POST' });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'refresh failed');
        setMaintenanceStatus('Node refreshed. Reloading interface…');
        await refreshSystemStatus();
        setTimeout(() => window.location.reload(), 350);
    } catch (err) {
        setMaintenanceStatus(err.message || 'Refresh failed.', 'error');
        btn.disabled = false;
    }
}

function _incinerationWarningText() {
    return (
        'This will permanently erase local Node memory, conversations, drafts, and temporary structures.\n' +
        'Installed Archive caches may optionally be preserved.\n' +
        'This action cannot be undone.'
    );
}

async function requestIncinerateNodeMemory(buttonEl) {
    const btn = buttonEl || document.getElementById('sys-incinerate-node-btn');
    if (!btn) return;

    const choice = window.prompt(
        'Incinerate Node Memory\n\n' +
        '1) Purge Temporary Memory Only (recommended)\n' +
        '2) Full Incineration\n\n' +
        'Enter 1 or 2:',
        '1',
    );
    if (!choice) return;

    const normalized = String(choice).trim();
    const mode = normalized === '2' ? 'full' : 'temporary';
    let includeArchive = false;
    if (mode === 'full') {
        includeArchive = window.confirm(
            'Include archive/core and archive/caches in this full incineration?\n\n' +
            'Cancel preserves installed archive caches.',
        );
    }

    if (!window.confirm(_incinerationWarningText())) return;

    btn.disabled = true;
    setMaintenanceStatus('Incineration in progress…');
    try {
        const res = await fetch('/api/system/incinerate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode, includeArchive }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'incineration failed');
        const removedCount = data.result && Number.isFinite(data.result.removedCount)
            ? data.result.removedCount
            : 0;
        setMaintenanceStatus(
            (mode === 'full' ? 'Full incineration complete.' : 'Temporary memory purge complete.') +
            ' Removed ' + removedCount + ' path(s).',
        );
        await refreshSystemStatus();
    } catch (err) {
        setMaintenanceStatus(err.message || 'Incineration failed.', 'error');
    } finally {
        btn.disabled = false;
    }
}

(function initSystemMaintenanceButtons() {
    document.addEventListener('click', (e) => {
        if (!e.target) return;
        if (e.target.id === 'sys-refresh-node-btn') {
            requestRefreshNode(e.target);
        }
        if (e.target.id === 'sys-incinerate-node-btn') {
            requestIncinerateNodeMemory(e.target);
        }
    });
})();

function mapStatusToCssClass(status) {
    if (status === 'Coming soon') return 'system-val warn';
    return 'system-val';
}

async function loadNodeStatusUpdates() {
    const appVersionEl = document.getElementById('sys-app-version');
    const latestVersionEl = document.getElementById('sys-latest-version');
    const updateSourceEl = document.getElementById('sys-update-source');
    const updateStatusEl = document.getElementById('sys-update-status');
    const dataRootEl = document.getElementById('sys-data-root-path');
    const coreCacheVersionEl = document.getElementById('sys-core-cache-version');
    const installedVersionsEl = document.getElementById('sys-installed-cache-versions');
    const cacheStatusListEl = document.getElementById('sys-cache-status-list');
    const guidanceEl = document.getElementById('sys-update-guidance');
    const releasesBtn = document.getElementById('sys-open-releases-btn');
    if (!appVersionEl) return;

    try {
        const res = await fetch('/api/system/node-status-updates');
        const data = await res.json();
        if (!res.ok || data.success === false) throw new Error(data.error || 'Failed to load status');

        appVersionEl.textContent = data.currentAppVersion || '—';
        latestVersionEl.textContent = data.latestAvailableVersion || 'Check Archive';
        if (updateSourceEl) {
            updateSourceEl.textContent = data.updateSource || 'Green Fire Archive';
        }
        dataRootEl.textContent = data.dataRootPath || '—';
        coreCacheVersionEl.textContent = data.coreCacheVersion || 'unknown';

        const statusText = data.updateStatus || 'Coming soon';
        updateStatusEl.textContent = statusText;
        updateStatusEl.className = mapStatusToCssClass(statusText);

        const installedList = Array.isArray(data.installedCacheVersions) ? data.installedCacheVersions : [];
        installedVersionsEl.textContent = installedList.length > 0
            ? installedList.map(item => `${item.label} ${item.version}`).join(' · ')
            : 'none installed';

        const cacheStatuses = Array.isArray(data.cacheStatuses) ? data.cacheStatuses : [];
        cacheStatusListEl.innerHTML = cacheStatuses.length > 0
            ? cacheStatuses.map(item =>
                '<div class="system-row">' +
                '<span class="system-key">' + escapeHtml(item.label) + '</span>' +
                '<span class="system-val">' + escapeHtml(item.status || 'not installed') + '</span>' +
                '</div>',
            ).join('')
            : '<span class="message-system">Cache status unavailable.</span>';

        if (guidanceEl) {
            const updateLine = 'Updates are distributed through the Green Fire Archive. Download the latest Ember Node build and install it over the current version.';
            const preservationLine = 'Your Ember-Node-Data folder will be preserved. Archive caches, chats, drafts, projects, and remembered threads live outside the app folder.';
            const hearthLine = 'The app can be replaced. The hearth remains.';
            guidanceEl.textContent = updateLine + ' ' + preservationLine + ' ' + hearthLine;
        }

        if (releasesBtn) {
            const hasUrl = Boolean(data.updatePageUrl);
            releasesBtn.disabled = !hasUrl;
            releasesBtn.onclick = hasUrl
                ? () => window.open(data.updatePageUrl, '_blank', 'noopener,noreferrer')
                : null;
        }
    } catch (err) {
        console.warn('[system] Could not load node status updates:', err && err.message ? err.message : err);
        if (updateSourceEl) {
            updateSourceEl.textContent = 'Green Fire Archive';
        }
        if (updateStatusEl) {
            updateStatusEl.textContent = 'Coming soon';
            updateStatusEl.className = 'system-val warn';
        }
        if (cacheStatusListEl) {
            cacheStatusListEl.innerHTML = '<span class="message-system">Cache status unavailable.</span>';
        }
        if (guidanceEl) {
            guidanceEl.textContent = 'Updates are distributed through the Green Fire Archive. Download the latest Ember Node build and install it over the current version. Your Ember-Node-Data folder will be preserved. The app can be replaced. The hearth remains.';
        }
    }
}

function updateSystemCacheCount(count) {
    const el = document.getElementById('sys-cache-count');
    if (el) el.textContent = String(count);
}

/* ================================================================
   Context Maps Status (Phase 11)
   ================================================================ */

async function loadContextMapsStatus() {
    const el = document.getElementById('sys-context-maps-status');
    if (!el) return;

    el.innerHTML = '<span class="message-system">Loading…</span>';

    const rooms = ['hearth', 'workshop', 'threshold'];
    const rows  = [];

    for (const room of rooms) {
        try {
            const res  = await fetch('/api/context-maps/' + room + '/working');
            if (res.ok) {
                const data = await res.json();
                const map  = data.map;
                const updated = map.updatedAt ? new Date(map.updatedAt).toLocaleString() : '—';
                rows.push(
                    '<div class="system-row">' +
                    '<span class="system-key">' + room.charAt(0).toUpperCase() + room.slice(1) + ' map</span>' +
                    '<span class="system-val ok">updated ' + escapeHtml(updated) + '</span>' +
                    '</div>',
                );
            } else {
                rows.push(
                    '<div class="system-row">' +
                    '<span class="system-key">' + room.charAt(0).toUpperCase() + room.slice(1) + ' map</span>' +
                    '<span class="system-val warn">not generated</span>' +
                    '</div>',
                );
            }
        } catch {
            rows.push(
                '<div class="system-row"><span class="system-key">' + room + '</span><span class="system-val error">error</span></div>',
            );
        }
    }

    el.innerHTML = rows.join('');
}

// Refresh all context maps button
(function initRefreshMapsBtn() {
    document.addEventListener('click', async (e) => {
        if (e.target && e.target.id === 'sys-refresh-maps-btn') {
            const btn = e.target;
            btn.disabled = true;
            btn.textContent = '↻ Refreshing…';
            try {
                await Promise.all(['hearth', 'workshop', 'threshold'].map(room =>
                    fetch('/api/context-maps/' + room + '/refresh', { method: 'POST' }),
                ));
                showFlashMessage('Context maps refreshed.');
                loadContextMapsStatus();
            } catch {
                showFlashMessage('Could not refresh maps.');
            } finally {
                btn.disabled = false;
                btn.textContent = '↻ Refresh All';
            }
        }
    });
})();

/* ================================================================
   Bootstrap Status (Phase 11.5)
   ================================================================ */

async function loadBootstrapStatus() {
    const el = document.getElementById('sys-bootstrap-status');
    if (!el) return;

    el.innerHTML = '<span class="message-system">Loading…</span>';

    try {
        const res  = await fetch('/api/status');
        const data = await res.json();

        const rows = [];

        rows.push(
            '<div class="system-row">' +
            '<span class="system-key">Forge v1.3</span>' +
            '<span class="system-val ' + (data.forgeLoaded ? 'ok' : 'warn') + '">' +
            (data.forgeLoaded ? 'loaded' : 'not found') + '</span></div>',
        );

        rows.push(
            '<div class="system-row">' +
            '<span class="system-key">Bootstrap</span>' +
            '<span class="system-val ' + (data.bootstrapStatus === 'ready' ? 'ok' : 'warn') + '">' +
            escapeHtml(data.bootstrapStatus || '—') + '</span></div>',
        );

        if (data.lastBootstrapRefresh) {
            const refreshed = new Date(data.lastBootstrapRefresh).toLocaleString();
            rows.push(
                '<div class="system-row">' +
                '<span class="system-key">Last refresh</span>' +
                '<span class="system-val">' + escapeHtml(refreshed) + '</span></div>',
            );
        }

        rows.push(
            '<div class="system-row">' +
            '<span class="system-key">Active archetype</span>' +
            '<span class="system-val">' + escapeHtml(data.activeArchetype || 'none') + '</span></div>',
        );

        el.innerHTML = rows.join('');
    } catch {
        el.innerHTML = '<span class="message-system error">Could not load bootstrap status.</span>';
    }
}

// Refresh Bootstrap button
(function initRefreshBootstrapBtn() {
    document.addEventListener('click', async (e) => {
        if (e.target && e.target.id === 'sys-refresh-bootstrap-btn') {
            const btn = e.target;
            btn.disabled = true;
            btn.textContent = '↻ Refreshing…';
            try {
                const res = await fetch('/api/bootstrap/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
                if (res.ok) {
                    showFlashMessage('Bootstrap refreshed.');
                    loadBootstrapStatus();
                } else {
                    showFlashMessage('Bootstrap refresh failed.');
                }
            } catch {
                showFlashMessage('Could not reach server.');
            } finally {
                btn.disabled = false;
                btn.textContent = '↻ Refresh Bootstrap';
            }
        }
    });
})();

/* ================================================================
   Header Status Pill
   ================================================================ */

function updateHeaderStatus() {
    const dot   = document.getElementById('status-dot');
    const label = document.getElementById('model-label');
    if (label) label.textContent = activeModelLabel + ' · local';
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
 * Shows detected tools that are not yet trusted (excluding persistently rejected ones).
 */
async function loadThresholdTools() {
    const listEl   = document.getElementById('th-tool-list');
    const guideEl  = document.getElementById('th-ai-setup-guide');
    if (!listEl) return;
    listEl.innerHTML = '<span class="message-system">Loading…</span>';

    try {
        const { tools, active } = await fetchToolRegistry();

        // Show all non-trusted detected tools (+ not_detected as dim)
        // Persistently rejected tools are shown as a separate dim section
        const visible  = tools.filter(t => !t.trusted && (!t.intake || t.intake.state !== 'rejected'));
        const rejected = tools.filter(t => !t.trusted && t.intake && t.intake.state === 'rejected');

        // Show guided setup if no running tools at all
        const anyRunning = tools.some(t => t.running === true);
        if (guideEl) guideEl.style.display = anyRunning ? 'none' : 'flex';

        if (visible.length === 0 && rejected.length === 0) {
            listEl.innerHTML = '<span class="message-system">No untrusted tools. All detected tools have been admitted.</span>';
            return;
        }

        listEl.innerHTML = '';
        visible.forEach(tool => renderThresholdToolRow(tool, active, listEl));

        if (rejected.length > 0) {
            const sep = document.createElement('div');
            sep.className   = 'threshold-section-header';
            sep.textContent = 'Rejected (' + rejected.length + ')';
            listEl.appendChild(sep);
            rejected.forEach(tool => renderThresholdToolRow(tool, active, listEl));
        }
    } catch {
        listEl.innerHTML = '<span class="message-system threshold-error">Could not load tools.</span>';
    }
}

function renderThresholdToolRow(tool, active, container) {
    const row = document.createElement('div');
    row.className = 'threshold-file-row';
    row.dataset.toolId = tool.id;

    const intakeState = tool.intake && tool.intake.state;
    if (intakeState === 'rejected') row.className += ' intake-rejected';

    // Tool last-seen timestamp
    const lastSeen = tool.lastSeen ? ' · last seen ' + new Date(tool.lastSeen).toLocaleString() : '';

    const nameEl = document.createElement('div');
    nameEl.style.cssText = 'flex:1; min-width:0;';
    nameEl.innerHTML =
        '<div class="threshold-file-name">' + escapeHtml(tool.name) +
            ' <span class="status-badge ' + toolStatusClass(tool) + '">' +
            escapeHtml(toolStatusLabel(tool)) + '</span>' +
            toolRunningBadge(tool) +
            (intakeState === 'rejected' ? ' <span class="status-badge rejected">Rejected</span>' : '') +
            (intakeState === 'inspected' ? ' <span class="status-badge inspected">Inspected</span>' : '') +
            '</div>' +
        '<div class="source-card-filename">' + escapeHtml(tool.type || '') + ' · ' + escapeHtml(tool.interface || '') + escapeHtml(lastSeen) + '</div>' +
        (tool.endpoint ? '<div class="source-card-filename">' + escapeHtml(tool.endpoint) + '</div>' : '') +
        (tool.note ? '<div class="source-card-description">' + escapeHtml(tool.note) + '</div>' : '');

    const actions = document.createElement('span');
    actions.className = 'threshold-file-actions';

    if (intakeState !== 'rejected') {
        // Inspect button — marks as inspected in persistent state
        const inspBtn = document.createElement('button');
        inspBtn.className = 'secondary threshold-action-btn';
        inspBtn.textContent = intakeState === 'inspected' ? 'Re-inspect' : 'Inspect';
        inspBtn.addEventListener('click', async () => {
            inspBtn.disabled = true;
            try {
                await fetch('/api/tools/' + encodeURIComponent(tool.id) + '/inspect', { method: 'POST' });
            } catch { /* ignore */ }
            openToolInspector(tool, active);
            loadThresholdTools();
        });
        actions.appendChild(inspBtn);

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
                        showFlashMessage(escapeHtml(tool.name) + ' trusted ✓ — now in Ember Council → Tools');
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

        // Launch button — only for Ollama when detected but not running
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

        // Reject button — persistent rejection
        const rejectBtn = document.createElement('button');
        rejectBtn.className = 'secondary threshold-action-btn threshold-reject-btn';
        rejectBtn.textContent = 'Reject';
        rejectBtn.title = 'Persistently reject — hides tool from intake queue';
        rejectBtn.addEventListener('click', async () => {
            rejectBtn.disabled = true;
            try {
                await fetch('/api/tools/' + encodeURIComponent(tool.id) + '/reject', { method: 'POST' });
                showFlashMessage(escapeHtml(tool.name) + ' rejected.');
            } catch { /* ignore */ }
            loadThresholdTools();
        });
        actions.appendChild(rejectBtn);
    } else {
        // Rejected — offer undo
        const undoBtn = document.createElement('button');
        undoBtn.className = 'secondary threshold-action-btn';
        undoBtn.textContent = 'Undo Reject';
        undoBtn.title = 'Restore tool to intake queue';
        undoBtn.addEventListener('click', async () => {
            undoBtn.disabled = true;
            try {
                await fetch('/api/tools/' + encodeURIComponent(tool.id) + '/inspect', { method: 'POST' });
                showFlashMessage(escapeHtml(tool.name) + ' restored to intake.');
            } catch { /* ignore */ }
            loadThresholdTools();
        });
        actions.appendChild(undoBtn);
    }

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

function renderEmberCourtMembers(court) {
    const listEl = document.getElementById('ws-court-list');
    const activeEl = document.getElementById('ws-court-active');
    if (!listEl) return;

    const members = Array.isArray(court && court.members) ? court.members : [];
    if (members.length === 0) {
        listEl.innerHTML = '<span class="message-system">No Ember Court members configured.</span>';
        if (activeEl) activeEl.textContent = 'No active Ember Court member.';
        return;
    }

    const configuredDefault = normalizeCourtMemberId(court && court.defaultMember);
    const persistedMember = getActiveCourtMemberId();
    const firstMemberId = normalizeCourtMemberId(members[0] && members[0].id);
    const activeMemberId = persistedMember || configuredDefault || firstMemberId;
    setActiveCourtMemberId(activeMemberId);

    listEl.innerHTML = '';
    members.forEach(member => {
        const memberId = normalizeCourtMemberId(member.id);
        const button = document.createElement('button');
        button.className = memberId === activeMemberId ? 'primary threshold-file-row' : 'secondary threshold-file-row';
        button.type = 'button';
        button.dataset.courtMember = memberId || '';
        button.setAttribute('aria-pressed', String(memberId === activeMemberId));
        button.style.cssText = 'display:flex; flex-direction:column; align-items:flex-start; gap:0.25rem; width:100%; text-align:left;';
        button.innerHTML =
            '<span class="threshold-file-name">' + escapeHtml(member.name || member.id || 'Court Member') + '</span>' +
            '<span class="source-card-filename">Role: ' + escapeHtml(member.role || '—') + '</span>' +
            '<span class="source-card-description">' + escapeHtml(member.shortDescription || '—') + '</span>' +
            '<span class="message-system">Domains: ' + escapeHtml((member.primaryDomains || []).join(', ') || '—') + '</span>' +
            '<span class="message-system">Sources: ' + escapeHtml((member.preferredSources || []).join(', ') || '—') + '</span>' +
            '<span class="message-system">Voice: ' + escapeHtml(member.toneCadence || member.tone || '—') + '</span>';
        button.addEventListener('click', () => {
            if (!memberId) return;
            setActiveCourtMemberId(memberId);
            renderEmberCourtMembers(court);
            const memberLabel = member.name ? escapeHtml(member.name) : escapeHtml(memberId);
            showFlashMessage('Active archetype set to ' + memberLabel + ' ✓');
        });
        listEl.appendChild(button);
    });

    const activeMember = members.find(m => normalizeCourtMemberId(m.id) === activeMemberId) || null;
    if (activeEl) {
        if (!activeMember) {
            activeEl.textContent = 'Active archetype: Ember Prime';
            return;
        }
        const transitionSubline = COURT_MEMBER_TRANSITIONS[normalizeCourtMemberId(activeMember.id)] || '';
        activeEl.innerHTML =
            '<strong>Active archetype: ' + escapeHtml(activeMember.name || activeMember.id) + '</strong>' +
            (transitionSubline
                ? '<br><span class="message-system">' + escapeHtml(transitionSubline) + '</span>'
                : '');
    }
}

/**
 * Load and render the Workshop → Ember Court panel.
 */
async function loadWorkshopTools() {
    const listEl = document.getElementById('ws-court-list');
    if (!listEl) return;
    listEl.innerHTML = '<span class="message-system">Loading Ember Court…</span>';
    const activeEl = document.getElementById('ws-court-active');
    if (activeEl) activeEl.textContent = 'Loading court selection…';

    try {
        const res = await fetch('/api/court');
        const data = await res.json();
        renderEmberCourtMembers(data && data.court ? data.court : null);
    } catch {
        listEl.innerHTML = '<span class="message-system">Could not load Ember Court.</span>';
        if (activeEl) activeEl.textContent = 'Court unavailable.';
    }
}

/* ── Hearth / System: Heart Assignment ──────────────────────── */

/**
 * Load the Ember Prime assignment UI in Hearth → System tab.
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
                (isHeart ? ' <span class="status-badge remembered" style="font-size:0.68rem;">Active Ember Prime</span>' : '');

            const btn = document.createElement('button');
            btn.className = isHeart ? 'secondary' : 'primary';
            btn.style.cssText = 'font-size:0.75rem; padding:0.2rem 0.6rem;';
            btn.textContent = isHeart ? 'Clear' : 'Set as Ember Prime';
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
                            ? escapeHtml(tool.name) + ' is now active as Ember Prime ✓'
                            : 'Ember Prime assignment cleared.');
                        loadHearthToolRegistry();
                    } else {
                        showFlashMessage('Ember Prime update failed: ' + (data.error || 'unknown'));
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
            (isHeart ? ' <span class="status-badge remembered">Active Ember Prime</span>' : '');
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
                label: 'Set as Ember Prime',
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
                            showFlashMessage(escapeHtml(tool.name) + ' is now active as Ember Prime ✓');
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
        showFlashMessage('No projects — create one in Ember Council → Projects first.');
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
        // ── Top-line summary ────────────────────────────────────────
        const summaryParts = [];
        const totalIntake  = (data.waitingFiles || 0) + (data.changedFiles || 0) + (data.flaggedFiles || 0);
        summaryParts.push('Node awakened');
        if (data.activeHeart && data.activeHeartAvailable) {
            summaryParts.push('Ember Prime ready');
        } else if (data.activeHeart && !data.activeHeartAvailable) {
            summaryParts.push('Ember Prime offline');
        } else {
            summaryParts.push('no Ember Prime set');
        }
        if (totalIntake > 0) summaryParts.push(totalIntake + ' file' + (totalIntake === 1 ? '' : 's') + ' awaiting review');
        if (data.offlineTools > 0) summaryParts.push(data.offlineTools + ' AI offline');
        if (data.newTools > 0) summaryParts.push(data.newTools + ' new tool' + (data.newTools === 1 ? '' : 's') + ' detected');

        const summaryEl = document.getElementById('startup-banner-summary');
        if (summaryEl) {
            summaryEl.textContent = summaryParts.join(' • ');
            summaryEl.style.display = '';
        }

        const stats = [];

        // ── Intake group ─────────────────────────────────────────────
        const totalFiles = (data.waitingFiles || 0) + (data.changedFiles || 0) + (data.flaggedFiles || 0);
        if (totalFiles > 0) {
            if (data.waitingFiles > 0) {
                stats.push({ label: 'waiting files', value: data.waitingFiles, style: 'warn', group: 'Intake' });
            }
            if (data.changedFiles > 0) {
                stats.push({ label: 'changed files', value: data.changedFiles, style: 'warn', group: 'Intake' });
            }
            if (data.flaggedFiles > 0) {
                stats.push({ label: 'flagged files', value: data.flaggedFiles, style: 'error', group: 'Intake' });
            }
        } else {
            stats.push({ label: 'threshold clear', value: '✓', style: 'ok', group: 'Intake' });
        }

        // ── Tools group ──────────────────────────────────────────────
        if (data.runningTools > 0) {
            stats.push({ label: 'tools running', value: data.runningTools, style: 'ok', group: 'Tools' });
        }
        if (data.offlineTools > 0) {
            stats.push({ label: 'tools offline', value: data.offlineTools, style: 'error', group: 'Tools' });
        }
        if (data.newTools > 0) {
            stats.push({ label: 'new tools detected', value: data.newTools, style: 'warn', group: 'Tools' });
        }

        // Active Ember Prime
        const noHeart = !data.activeHeart;
        if (data.activeHeart) {
            stats.push({
                label: 'ember prime',
                value: data.activeHeart + (data.activeHeartAvailable ? ' ✓' : ' (offline)'),
                style: data.activeHeartAvailable ? 'ok' : 'error',
                group: 'Tools',
            });
        } else {
            stats.push({ label: 'ember prime', value: 'none set', style: 'zero', group: 'Tools' });
        }

        // ── Render grouped stats ─────────────────────────────────────
        let lastGroup = null;
        statsEl.innerHTML = stats.map(s => {
            let html = '';
            if (s.group !== lastGroup) {
                lastGroup = s.group;
                html += '<span class="startup-stat-group">' + escapeHtml(s.group) + '</span>';
            }
            html +=
                '<span class="startup-stat">' +
                '<span class="startup-stat-value ' + escapeHtml(s.style || '') + '">' + escapeHtml(String(s.value)) + '</span>' +
                ' <span>' + escapeHtml(s.label) + '</span>' +
                '</span>';
            return html;
        }).join('');

        // Show/hide "View Setup Guide" button in banner links
        const setupGuideBtn = document.getElementById('sb-setup-guide');
        if (setupGuideBtn) setupGuideBtn.style.display = noHeart ? '' : 'none';
    }

    // Warnings — merge server warnings with local no-Ember-Prime notice
    if (warningsEl) {
        const warnings = [...(data.warnings || [])];
        if (!data.activeHeart) warnings.unshift('No active Ember Prime detected — Recommended local AI: Ollama');
        if (warnings.length > 0) {
            warningsEl.style.display = '';
            warningsEl.innerHTML = warnings.map(w =>
                '<div class="startup-warning-item">' + escapeHtml(w) + '</div>'
            ).join('');
        } else {
            warningsEl.style.display = 'none';
        }
    }

    // Always show banner — startup ritual is always surfaced
    banner.style.display = '';

    // Also populate the System tab summary
    renderSystemStartupSummary(data);
}

/** Render startup check data in the Hearth → System tab */
function renderSystemStartupSummary(data) {
    const el = document.getElementById('sys-startup-summary');
    if (!el) return;

    const sections = [
        {
            title: 'Intake',
            rows: [
                { key: 'Waiting files',  val: data.waitingFiles  || 0 },
                { key: 'Changed files',  val: data.changedFiles  || 0 },
                { key: 'Flagged files',  val: data.flaggedFiles  || 0 },
            ],
        },
        {
            title: 'Tools',
            rows: [
                { key: 'New tools',      val: data.newTools      || 0 },
                { key: 'Running tools',  val: data.runningTools  || 0 },
                { key: 'Offline tools',  val: data.offlineTools  || 0 },
                { key: 'Active Ember Prime', val: data.activeHeart || '—' },
                { key: 'Ember Prime ready',  val: data.activeHeart ? (data.activeHeartAvailable ? 'yes' : 'offline') : '—' },
            ],
        },
        {
            title: 'System',
            rows: [
                { key: 'Migration',  val: data.migrationState || 'none' },
                { key: 'Last scan',  val: data.lastScan ? new Date(data.lastScan).toLocaleTimeString() : '—' },
            ],
        },
    ];

    el.innerHTML = sections.map(section =>
        '<div class="sys-startup-section">' +
        '<div class="sys-startup-section-title">' + escapeHtml(section.title) + '</div>' +
        section.rows.map(r =>
            '<div class="system-row">' +
            '<span class="system-key">' + escapeHtml(r.key) + '</span>' +
            '<span class="system-val">' + escapeHtml(String(r.val)) + '</span>' +
            '</div>'
        ).join('') +
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

        const setupGuideBtn  = document.getElementById('sb-setup-guide');
        const setupOverlay   = document.getElementById('setup-guide-overlay');
        const setupCloseBtn  = document.getElementById('setup-guide-close');

        if (setupGuideBtn && setupOverlay) {
            setupGuideBtn.addEventListener('click', () => {
                setupOverlay.style.display = '';
            });
        }
        if (setupCloseBtn && setupOverlay) {
            setupCloseBtn.addEventListener('click', () => {
                setupOverlay.style.display = 'none';
            });
        }
        if (setupOverlay) {
            setupOverlay.addEventListener('click', e => {
                if (e.target === setupOverlay) setupOverlay.style.display = 'none';
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
    loadHearthArchive();
    loadHearthTrustedArchive();
    loadHearthRememberedThreads();
    loadArchiveCacheManager();
    loadArchiveSignalPanel();
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
