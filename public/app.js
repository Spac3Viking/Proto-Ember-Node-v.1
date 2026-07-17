/**
 * Ember Node v.ᚠ — app shell
 *
 * Covers primary rooms (Session / Hearth / Threshold) with advanced council lenses,
 * file lifecycle (Waiting/Indexed/Remembered), intake discipline (Threshold airlock),
 * chat threads, source inspector, runtime registry, and startup checklist.
 * All UI logic communicates only with the local Express server.
 */

/** Default model name — used as fallback if local config is unavailable. */
const DEFAULT_MODEL_LABEL = 'gemma3:4b';
let activeModelLabel = DEFAULT_MODEL_LABEL;
const EMBER_COURT_STORAGE_KEY = 'ember-court-active-member';
const EMBER_PRIME_MEMBER_ID = 'ember-prime';
const RESPONSE_DEPTH_STORAGE_KEY = 'responseDepth';
const RESPONSE_DEPTH_IDS = new Set(['spark', 'ember', 'hearth', 'archive']);
const DEFAULT_RESPONSE_DEPTH = 'ember';
const RUNTIME_PROFILE_STORAGE_KEY = 'runtimeProfile';
const LOADOUT_FOCUS_STORAGE_KEY = 'loadoutFocus';
const RUNTIME_PROFILE_IDS = new Set([
    'spark-compression',
    'balanced-ember',
    'field-guide',
    'scholar-weave',
    'narrative-forge',
    'minimal-retrieval',
    'deep-hearth',
]);
const DEFAULT_RUNTIME_PROFILE = 'balanced-ember';
const RUNTIME_PROFILE_META = Object.freeze({
    'spark-compression': {
        label: 'Spark Compression',
        description: [
            'Direct concise guidance.',
            'Minimal retrieval sweep.',
            'Single clear next step.',
        ],
    },
    'balanced-ember': {
        label: 'Balanced Ember',
        description: [
            'Grounded practical synthesis.',
            'Balanced retrieval breadth.',
            'Steady mentor pacing.',
        ],
    },
    'field-guide': {
        label: 'Field Guide',
        description: [
            'Grounded practical synthesis.',
            'Minimal symbolic drift.',
            'Focused implementation posture.',
        ],
    },
    'scholar-weave': {
        label: 'Scholar Weave',
        description: [
            'Comparative synthesis emphasis.',
            'Broader cross-reference retrieval.',
            'Question-led mentor cadence.',
        ],
    },
    'narrative-forge': {
        label: 'Narrative Forge',
        description: [
            'Continuity-oriented prose posture.',
            'Narrative-aware retrieval.',
            'Reflective but practical pacing.',
        ],
    },
    'minimal-retrieval': {
        label: 'Minimal Retrieval',
        description: [
            'Bootstrap-first guidance.',
            'Small retrieval budget.',
            'High loadout preference.',
        ],
    },
    'deep-hearth': {
        label: 'Deep Hearth',
        description: [
            'Deeper synthesis posture.',
            'Expanded retrieval depth.',
            'Continuity teaching cadence.',
        ],
    },
});
const FORGE_ARCHETYPE_ORDER = ['builder', 'warrior', 'scholar', 'scribe', 'mystic'];
const FORGE_ARCHETYPE_LABELS = Object.freeze({
    builder: 'Builder',
    warrior: 'Warrior',
    scholar: 'Scholar',
    scribe: 'Scribe',
    mystic: 'Mystic',
    ember_prime: 'Ember Prime',
});
const FORGE_MAX_ROLLING_SUMMARY_LINE = 145;
const FORGE_MAX_ROLLING_SUMMARY_TRUNCATE = 142;
const FORGE_MAX_BOOTSTRAP_PREVIEW_LINES = 18;
const FORGE_MAX_CACHE_CARDS = 8;
const CACHE_CARRY_SUMMARY_MAX_CHARS = 220;
const DEFAULT_CACHE_LEVEL = 'spark';
const DEFAULT_CACHE_SOURCE = 'archive';
const MAX_DISTILLATION_THEME_DISPLAY = 8;
const MIN_SIGNAL_KEYWORD_LENGTH = 4;
const MAX_SIGNAL_KEYWORDS = 20;
const SIGNAL_OVERLAP_THEME_WEIGHT = 3;
const SIGNAL_OVERLAP_TAG_WEIGHT = 2;
const SIGNAL_OVERLAP_ARCHETYPE_WEIGHT = 2;
const SIGNAL_OVERLAP_KEYWORD_WEIGHT = 1;
const SIGNAL_OVERLAP_DOCUMENT_WEIGHT = 1;
const SIGNAL_OVERLAP_LEVEL_WEIGHT = 1;
const MODERATE_SIGNAL_OVERLAP_THRESHOLD = 4;
const HIGH_SIGNAL_OVERLAP_THRESHOLD = 8;
const TAB_SWITCH_DELAY_MS = 50;
const ONBOARDING_DISMISS_PREFIX = 'first-ember-dismissed:';
let _activeCourtMemberId = null;
let _activeResponseDepth = null;
let _activeRuntimeProfile = null;
let _activeLoadoutFocus = null;
let _pendingCouncilDistillationGuidance = false;
let _runtimeTuningLastRun = null;

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

/**
 * Resolve the court member value to send to API routes.
 * Returns undefined when Ember Prime/no-lens is active.
 * @returns {string|undefined}
 */
function getEffectiveCourtMemberForApi() {
    const activeCourtMember = getActiveCourtMemberId();
    if (!activeCourtMember || activeCourtMember === EMBER_PRIME_MEMBER_ID) return undefined;
    return activeCourtMember;
}

function normalizeResponseDepth(value) {
    if (typeof value !== 'string') return DEFAULT_RESPONSE_DEPTH;
    const raw = value.trim().toLowerCase();
    return RESPONSE_DEPTH_IDS.has(raw) ? raw : DEFAULT_RESPONSE_DEPTH;
}

function syncResponseDepthSelects() {
    const activeDepth = getActiveResponseDepth();
    const selectors = ['response-depth-select', 'ws-response-depth-select']
        .map(id => document.getElementById(id))
        .filter(Boolean);
    selectors.forEach(selectEl => {
        if (selectEl.value !== activeDepth) {
            selectEl.value = activeDepth;
        }
    });
}

function getActiveResponseDepth() {
    if (_activeResponseDepth) return _activeResponseDepth;
    try {
        _activeResponseDepth = normalizeResponseDepth(window.localStorage.getItem(RESPONSE_DEPTH_STORAGE_KEY));
    } catch {
        _activeResponseDepth = DEFAULT_RESPONSE_DEPTH;
    }
    return _activeResponseDepth;
}

function setActiveResponseDepth(depth) {
    const normalized = normalizeResponseDepth(depth);
    _activeResponseDepth = normalized;
    try {
        window.localStorage.setItem(RESPONSE_DEPTH_STORAGE_KEY, normalized);
    } catch { /* ignore storage failures */ }
    syncResponseDepthSelects();
    return _activeResponseDepth;
}

(function initRuntimeProfileControls() {
    const selectors = ['runtime-profile-select', 'ws-runtime-profile-select']
        .map(id => document.getElementById(id))
        .filter(Boolean);
    const activeProfile = getActiveRuntimeProfile();
    selectors.forEach(selectEl => {
        selectEl.value = activeProfile;
        selectEl.addEventListener('change', () => {
            setActiveRuntimeProfile(selectEl.value);
        });
    });
})();

(function initResponseDepthControls() {
    const selectors = ['response-depth-select', 'ws-response-depth-select']
        .map(id => document.getElementById(id))
        .filter(Boolean);
    const activeDepth = getActiveResponseDepth();
    selectors.forEach(selectEl => {
        selectEl.value = activeDepth;
        selectEl.addEventListener('change', () => {
            setActiveResponseDepth(selectEl.value);
        });
    });
})();

(function initLoadoutFocusControls() {
    const toggles = ['loadout-focus-toggle', 'ws-loadout-focus-toggle']
        .map(id => document.getElementById(id))
        .filter(Boolean);
    const activeLoadoutFocus = getActiveLoadoutFocus();
    toggles.forEach(toggleEl => {
        toggleEl.checked = activeLoadoutFocus;
        toggleEl.addEventListener('change', () => {
            setActiveLoadoutFocus(toggleEl.checked);
        });
    });
    syncLoadoutFocusControls();
})();

function normalizeRuntimeProfile(value) {
    if (typeof value !== 'string') return DEFAULT_RUNTIME_PROFILE;
    const raw = value.trim().toLowerCase();
    return RUNTIME_PROFILE_IDS.has(raw) ? raw : DEFAULT_RUNTIME_PROFILE;
}

function syncRuntimeProfileSelects() {
    const activeProfile = getActiveRuntimeProfile();
    const selectors = ['runtime-profile-select', 'ws-runtime-profile-select']
        .map(id => document.getElementById(id))
        .filter(Boolean);
    selectors.forEach(selectEl => {
        if (selectEl.value !== activeProfile) {
            selectEl.value = activeProfile;
        }
    });
}

function getActiveRuntimeProfile() {
    if (_activeRuntimeProfile) return _activeRuntimeProfile;
    try {
        _activeRuntimeProfile = normalizeRuntimeProfile(window.localStorage.getItem(RUNTIME_PROFILE_STORAGE_KEY));
    } catch {
        _activeRuntimeProfile = DEFAULT_RUNTIME_PROFILE;
    }
    return _activeRuntimeProfile;
}

function setActiveRuntimeProfile(profile) {
    const normalized = normalizeRuntimeProfile(profile);
    _activeRuntimeProfile = normalized;
    try {
        window.localStorage.setItem(RUNTIME_PROFILE_STORAGE_KEY, normalized);
    } catch { /* ignore storage failures */ }
    syncRuntimeProfileSelects();
    return _activeRuntimeProfile;
}

function normalizeLoadoutFocus(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') {
        if (value === 1) return true;
        if (value === 0) return false;
        return false;
    }
    if (typeof value !== 'string') return false;
    const normalized = value.trim().toLowerCase();
    if (!normalized) return false;
    if (['true', '1', 'yes', 'on', 'enabled'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off', 'disabled'].includes(normalized)) return false;
    return false;
}

function syncLoadoutFocusControls() {
    const activeLoadoutFocus = getActiveLoadoutFocus();
    const toggles = ['loadout-focus-toggle', 'ws-loadout-focus-toggle']
        .map(id => document.getElementById(id))
        .filter(Boolean);
    toggles.forEach(toggleEl => {
        toggleEl.checked = activeLoadoutFocus;
    });
    const statusLabels = ['loadout-focus-state', 'ws-loadout-focus-state']
        .map(id => document.getElementById(id))
        .filter(Boolean);
    statusLabels.forEach(labelEl => {
        labelEl.textContent = activeLoadoutFocus ? 'ON' : 'OFF';
    });
}

function getActiveLoadoutFocus() {
    if (typeof _activeLoadoutFocus === 'boolean') return _activeLoadoutFocus;
    try {
        _activeLoadoutFocus = normalizeLoadoutFocus(window.localStorage.getItem(LOADOUT_FOCUS_STORAGE_KEY));
    } catch {
        _activeLoadoutFocus = false;
    }
    return _activeLoadoutFocus;
}

function setActiveLoadoutFocus(enabled) {
    const normalized = normalizeLoadoutFocus(enabled);
    _activeLoadoutFocus = normalized;
    try {
        window.localStorage.setItem(LOADOUT_FOCUS_STORAGE_KEY, normalized ? 'true' : 'false');
    } catch { /* ignore storage failures */ }
    syncLoadoutFocusControls();
    return _activeLoadoutFocus;
}

function setPendingCouncilDistillationGuidance(enabled) {
    _pendingCouncilDistillationGuidance = Boolean(enabled);
}

function consumePendingCouncilDistillationGuidance() {
    const enabled = _pendingCouncilDistillationGuidance === true;
    _pendingCouncilDistillationGuidance = false;
    return enabled;
}

const COURT_MEMBER_TRANSITIONS = Object.freeze({
    builder: 'Grounding signal in structure, systems, and practical sequence.',
    warrior: 'Clarifying stakes, terrain, risk, and disciplined action.',
    scholar: 'Mapping distinctions, connections, and conceptual structure.',
    scribe: 'Shaping fragments into coherent chapters and transmissible language.',
    mystic: 'Reading symbolic thresholds while staying practical and clear.',
});
const COURT_MEMBER_RUNES = Object.freeze({
    builder: 'ᛒ',
    warrior: 'ᛏ',
    scholar: 'ᛋ',
    scribe: 'ᛋ',
    mystic: 'ᛗ',
});
const GREEN_FIRE_HANDOFF_TEMPLATE = `---
title:
type: research-brief | field-note | bootstrap | manual-summary | cache-readme | source-summary
source:
created:
status: unverified | reviewed | trusted | local
archetypes:
tags:
license:
---
# Summary
# Key Knowledge
# Practical Use
# Risks / Unknowns
# Suggested Cache Placement
# Sources
`;
const GREEN_FIRE_PROMPT_GUIDES = Object.freeze([
    {
        id: 'general',
        label: 'General Handoff Prompt',
        filename: 'green-fire-handoff-prompt-general.md',
        archetype: '',
    },
    {
        id: 'builder',
        label: 'ᛒ Builder Handoff Prompt',
        filename: 'green-fire-handoff-prompt-builder.md',
        archetype: 'builder',
    },
    {
        id: 'warrior',
        label: 'ᛏ Warrior Handoff Prompt',
        filename: 'green-fire-handoff-prompt-warrior.md',
        archetype: 'warrior',
    },
    {
        id: 'scholar',
        label: 'ᚨ Scholar Handoff Prompt',
        filename: 'green-fire-handoff-prompt-scholar.md',
        archetype: 'scholar',
    },
    {
        id: 'scribe',
        label: 'ᚲ Scribe Handoff Prompt',
        filename: 'green-fire-handoff-prompt-scribe.md',
        archetype: 'scribe',
    },
    {
        id: 'mystic',
        label: 'ᛇ Mystic Handoff Prompt',
        filename: 'green-fire-handoff-prompt-mystic.md',
        archetype: 'mystic',
    },
]);
const COURT_DISCUSS_ACTIONS = Object.freeze([
    { id: EMBER_PRIME_MEMBER_ID, label: 'Discuss with Ember Prime' },
    { id: 'builder', label: 'Discuss with Builder' },
    { id: 'scholar', label: 'Discuss with Scholar' },
    { id: 'scribe', label: 'Discuss with Scribe' },
    { id: 'warrior', label: 'Discuss with Warrior' },
    { id: 'mystic', label: 'Discuss with Mystic' },
]);
const EXTERNAL_PROMPT_SOURCE_IDS = Object.freeze([
    'discussion',
    'reader-document',
    'selected-cache',
    'cache-loadout',
    'active-archetype',
]);
const RUNTIME_TUNING_PROMPT_PRESETS = Object.freeze({
    'green-fire': 'What is Green Fire?',
    'cache-plain-language': 'Explain this cache in plain language.',
    'next-step': 'What should I do next?',
    'summarize-loadout': 'Summarize the current Cache Loadout.',
    'cache-weaknesses': 'What is weak or missing in this cache?',
    'spark-answer-only': 'Give me a Spark answer only.',
    'through-builder': 'Explain this through Builder.',
    'through-scholar': 'Explain this through Scholar.',
});
const RUNTIME_TUNING_ARCHETYPE_IDS = new Set([
    'ember-prime',
    'builder',
    'warrior',
    'scholar',
    'scribe',
    'mystic',
]);
const RUNTIME_TUNING_ARCHETYPE_LABELS = Object.freeze({
    'ember-prime': 'Ember Prime',
    builder: 'Builder',
    warrior: 'Warrior',
    scholar: 'Scholar',
    scribe: 'Scribe',
    mystic: 'Mystic',
});
const RUNTIME_TUNING_ROOM = 'hearth';
const RUNTIME_TUNING_MAX_PROMPT_LENGTH = 280;
const RUNTIME_TUNING_MAX_RESPONSE_PREVIEW_LENGTH = 320;

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

function buildOnboardingStorageKey(key) {
    return ONBOARDING_DISMISS_PREFIX + String(key || '').trim().toLowerCase();
}

function isOnboardingDismissed(key) {
    try {
        return window.localStorage.getItem(buildOnboardingStorageKey(key)) === '1';
    } catch {
        return false;
    }
}

function dismissOnboardingHint(key) {
    try {
        window.localStorage.setItem(buildOnboardingStorageKey(key), '1');
    } catch { /* ignore storage failures */ }
}

function openRoomAndSubtab(roomId, subtabId) {
    const normalizedRoomId = String(roomId || '').trim().toLowerCase();
    const roomTab = document.querySelector('.room-tab[data-room="' + normalizedRoomId + '"]');
    if (roomTab) roomTab.click();
    if (!roomTab && normalizedRoomId === 'council') {
        // Council is intentionally removed from primary nav; surface council tools from Session.
        const sessionTab = document.querySelector('.room-tab[data-room="session"]');
        if (sessionTab) sessionTab.click();
        const askDetails = document.getElementById('ip-ask-council-details');
        const lensDetails = document.getElementById('ip-advanced-lenses-details');
        if (subtabId === 'ws-council-chat' || subtabId === 'ws-drafts') {
            if (askDetails) askDetails.open = true;
        }
        if (subtabId === 'ws-archetypes' || subtabId === 'ws-caches') {
            if (lensDetails) lensDetails.open = true;
        }
    }
    if (!subtabId) return;
    setTimeout(() => {
        const subtab = document.querySelector('.sub-tab[data-subtab="' + String(subtabId) + '"]');
        if (subtab) subtab.click();
    }, TAB_SWITCH_DELAY_MS);
}

function openFirstEmberOverlay() {
    const overlay = document.getElementById('first-ember-overlay');
    if (overlay) overlay.style.display = 'flex';
}

function closeFirstEmberOverlay() {
    const overlay = document.getElementById('first-ember-overlay');
    if (overlay) overlay.style.display = 'none';
}

/* ================================================================
   Phase 17D — Sentinel Trials (optional)
   ================================================================ */

let _sentinelTrialsSnapshot = null;
let _sentinelTrialsRefreshTimer = null;

function sentinelTrialsProgressText(payload) {
    const trials = payload && Array.isArray(payload.trials) ? payload.trials : [];
    const state = payload && payload.state && typeof payload.state === 'object' ? payload.state : {};
    const total = trials.length;
    const completed = trials.filter(trial => state[trial.id] && state[trial.id].completed).length;
    return total > 0 ? (completed + ' / ' + total) : '—';
}

function scheduleSentinelTrialsRefresh(delayMs = 220) {
    if (_sentinelTrialsRefreshTimer) clearTimeout(_sentinelTrialsRefreshTimer);
    _sentinelTrialsRefreshTimer = setTimeout(() => {
        _sentinelTrialsRefreshTimer = null;
        loadSentinelTrials();
    }, delayMs);
}

async function fetchSentinelTrialsPayload() {
    try {
        const res = await fetch('/api/system/sentinel-trials');
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data || data.success !== true) return null;
        return data;
    } catch {
        return null;
    }
}

async function markSentinelTrialStep(trialId, stepId) {
    const payload = {
        trialId: String(trialId || '').trim(),
        stepId: String(stepId || '').trim(),
    };
    if (!payload.trialId || !payload.stepId) return;
    try {
        await fetch('/api/system/sentinel-trials/step', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
    } catch { /* non-blocking */ }
    scheduleSentinelTrialsRefresh();
}

async function resetSentinelTrialsState() {
    try {
        const res = await fetch('/api/system/sentinel-trials/reset', { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data && data.success) {
            showFlashMessage('Sentinel Trials reset.');
            scheduleSentinelTrialsRefresh(50);
            return true;
        }
    } catch { /* ignore */ }
    showFlashMessage('Could not reset Sentinel Trials.');
    return false;
}

function openSentinelTrials() {
    openFirstEmberOverlay();
    setTimeout(() => {
        const details = document.getElementById('first-ember-sentinel-trials-details');
        if (details) details.open = true;
    }, 40);
}

function openTrialSurface(trialId) {
    const id = String(trialId || '').trim();
    if (id === 'first_ember') return openSentinelTrials();
    if (id === 'forge_reflection') return openRoomAndSubtab('hearth', 'hearth-chat');
    if (id === 'scribe_structuring') return openRoomAndSubtab('threshold', 'th-imports');
    if (id === 'distillation_trial') return openRoomAndSubtab('council', 'ws-caches');
    if (id === 'transmission_trial') return openRoomAndSubtab('threshold', 'th-imports');
    return openSentinelTrials();
}

function renderSentinelTrialsList(host, payload) {
    if (!host) return;
    const trials = payload && Array.isArray(payload.trials) ? payload.trials : [];
    const state = payload && payload.state && typeof payload.state === 'object' ? payload.state : {};

    host.innerHTML = '';
    const list = document.createElement('div');
    list.className = 'sentinel-trials-list';

    if (trials.length === 0) {
        const empty = document.createElement('span');
        empty.className = 'message-system';
        empty.textContent = 'No Sentinel Trials registered.';
        host.appendChild(empty);
        return;
    }

    trials.forEach(trial => {
        const row = document.createElement('div');
        row.className = 'sentinel-trial';
        const trialState = state[trial.id] && typeof state[trial.id] === 'object' ? state[trial.id] : {};
        const completed = Boolean(trialState.completed);
        const stepsState = trialState.steps && typeof trialState.steps === 'object' ? trialState.steps : {};

        const header = document.createElement('div');
        header.className = 'sentinel-trial-header';

        const title = document.createElement('div');
        title.className = 'sentinel-trial-title';
        title.textContent = (completed ? '✓ ' : '· ') + String(trial.title || trial.id);

        const actions = document.createElement('div');
        actions.className = 'sentinel-trial-actions';

        const openBtn = document.createElement('button');
        openBtn.className = 'secondary';
        openBtn.textContent = 'Open';
        openBtn.addEventListener('click', () => openTrialSurface(trial.id));

        const verifyBtn = document.createElement('button');
        verifyBtn.className = 'secondary';
        verifyBtn.textContent = 'Verify';

        const guidance = document.createElement('div');
        guidance.className = 'sentinel-trial-guidance';

        verifyBtn.addEventListener('click', async () => {
            guidance.style.display = 'none';
            guidance.textContent = '';
            try {
                const res = await fetch('/api/system/sentinel-trials/check', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ trialId: trial.id }),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || !data || data.success !== true) {
                    showFlashMessage('Capability check failed.');
                    return;
                }
                if (data.ok) {
                    showFlashMessage('Capability check passed.');
                } else {
                    const checks = Array.isArray(data.checks) ? data.checks : [];
                    const missing = checks.filter(c => c && c.ok === false && c.guidance);
                    if (missing.length > 0) {
                        guidance.textContent = missing.slice(0, 3).map(c => '• ' + c.guidance).join('\n');
                        guidance.style.display = '';
                    }
                    showFlashMessage('Capability check incomplete.');
                }
                scheduleSentinelTrialsRefresh(50);
            } catch {
                showFlashMessage('Could not reach server.');
            }
        });

        actions.appendChild(openBtn);
        actions.appendChild(verifyBtn);

        const status = document.createElement('div');
        status.className = 'sentinel-trial-status';
        status.textContent = completed
            ? ('completed ' + (trialState.completed_at ? formatRelativeTime(trialState.completed_at) : ''))
            : 'optional';

        header.appendChild(title);
        header.appendChild(actions);
        header.appendChild(status);

        const purpose = document.createElement('p');
        purpose.className = 'sentinel-trial-purpose';
        purpose.textContent = String(trial.purpose || '').trim();

        const stepsList = document.createElement('ol');
        stepsList.className = 'sentinel-trial-steps';
        const stepDefs = Array.isArray(trial.steps) ? trial.steps : [];
        stepDefs.forEach(step => {
            const li = document.createElement('li');
            const done = stepsState[step.id] && stepsState[step.id].completed;
            li.textContent = (done ? '✓ ' : '· ') + String(step.label || step.id);
            stepsList.appendChild(li);
        });

        row.appendChild(header);
        if (purpose.textContent) row.appendChild(purpose);
        if (stepDefs.length > 0) row.appendChild(stepsList);
        row.appendChild(guidance);

        list.appendChild(row);
    });

    host.appendChild(list);
}

async function loadSentinelTrials() {
    const payload = await fetchSentinelTrialsPayload();
    _sentinelTrialsSnapshot = payload;

    const sysProgress = document.getElementById('sys-sentinel-trials-progress');
    const sysStatus = document.getElementById('sys-sentinel-trials-status');
    if (sysProgress) sysProgress.textContent = payload ? sentinelTrialsProgressText(payload) : '—';
    if (sysStatus) sysStatus.textContent = payload ? 'Optional drills available.' : 'Sentinel Trials unavailable.';

    const overlayHost = document.getElementById('first-ember-sentinel-trials-list');
    if (overlayHost) {
        if (!payload) {
            overlayHost.innerHTML = '<span class="message-system">Sentinel Trials unavailable.</span>';
        } else {
            renderSentinelTrialsList(overlayHost, payload);
        }
    }
}

function recordSentinelDepthUsage(depthId) {
    const depth = String(depthId || '').trim().toLowerCase();
    if (depth === 'spark') {
        markSentinelTrialStep('first_ember', 'spark_question');
        return;
    }
    if (depth === 'ember') return markSentinelTrialStep('forge_reflection', 'ember_depth_used');
    if (depth === 'hearth') return markSentinelTrialStep('forge_reflection', 'hearth_depth_used');
    if (depth === 'archive') return markSentinelTrialStep('forge_reflection', 'archive_depth_used');
}

/* ================================================================
   Phase 17E — Signal Threads (meaning continuity)
   ================================================================ */

let _signalThreadsListSnapshot = [];
let _activeSignalThreadId = null;
let _activeSignalThread = null;

function parseTagsFromInput(text) {
    return String(text || '')
        .split(',')
        .map(t => t.trim())
        .filter(Boolean);
}

function renderSignalThreadEntries(host, entries) {
    if (!host) return;
    host.innerHTML = '';
    const list = Array.isArray(entries) ? entries : [];
    if (list.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'message-system';
        empty.textContent = 'No entries yet.';
        host.appendChild(empty);
        return;
    }
    list.slice().reverse().forEach(entry => {
        const row = document.createElement('div');
        row.className = 'signal-thread-entry';

        const time = document.createElement('div');
        time.className = 'signal-thread-entry-time';
        time.textContent = entry && entry.timestamp ? formatRelativeTime(entry.timestamp) : '';
        if (entry && entry.timestamp) time.title = String(entry.timestamp);

        const content = document.createElement('div');
        content.className = 'signal-thread-entry-content';
        content.textContent = entry && entry.content ? String(entry.content) : '';

        row.appendChild(time);
        row.appendChild(content);
        host.appendChild(row);
    });
}

function _parseSagaCycleObservation(entry) {
    const stamp = entry && entry.timestamp ? String(entry.timestamp) : '';
    const raw = entry && entry.content ? String(entry.content) : '';
    if (!raw.trim().startsWith('Saga Smith — Cycle')) return null;

    const lines = raw.split('\n');
    let mode = '';
    let section = '';
    const sections = { situation: [], application: [], observation: [] };
    lines.forEach((line, index) => {
        if (index === 0) return;
        const trimmed = String(line || '').trimEnd();
        if (!trimmed.trim()) return;
        if (trimmed.startsWith('Mode:')) {
            mode = trimmed.slice('Mode:'.length).trim();
            return;
        }
        if (trimmed === 'Situation') { section = 'situation'; return; }
        if (trimmed === 'Application') { section = 'application'; return; }
        if (trimmed === 'Observation') { section = 'observation'; return; }
        if (section && sections[section]) sections[section].push(trimmed);
    });

    return {
        timestamp: stamp,
        mode,
        situation: sections.situation.join('\n').trim(),
        application: sections.application.join('\n').trim(),
        observation: sections.observation.join('\n').trim(),
    };
}

function _parseSagaCycleReflection(entry) {
    const stamp = entry && entry.timestamp ? String(entry.timestamp) : '';
    const raw = entry && entry.content ? String(entry.content) : '';
    if (!raw.trim().startsWith('Saga Smith — Reflection')) return null;

    const lines = raw.split('\n');
    let mode = '';
    let inReflection = false;
    const reflectionLines = [];
    lines.forEach((line, index) => {
        if (index === 0) return;
        const trimmed = String(line || '').trimEnd();
        if (trimmed.startsWith('Mode:')) {
            mode = trimmed.slice('Mode:'.length).trim();
            return;
        }
        if (trimmed === 'Reflection') {
            inReflection = true;
            return;
        }
        if (!inReflection) return;
        reflectionLines.push(trimmed);
    });

    return {
        timestamp: stamp,
        mode,
        reflection: reflectionLines.join('\n').trim(),
    };
}

function deriveSagaCycles(thread) {
    const t = thread && typeof thread === 'object' ? thread : {};
    const map = new Map();

    (Array.isArray(t.observations) ? t.observations : []).forEach(entry => {
        const parsed = _parseSagaCycleObservation(entry);
        if (!parsed || !parsed.timestamp) return;
        const existing = map.get(parsed.timestamp) || { timestamp: parsed.timestamp };
        map.set(parsed.timestamp, Object.assign(existing, parsed));
    });

    (Array.isArray(t.reflections) ? t.reflections : []).forEach(entry => {
        const parsed = _parseSagaCycleReflection(entry);
        if (!parsed || !parsed.timestamp) return;
        const existing = map.get(parsed.timestamp) || { timestamp: parsed.timestamp };
        map.set(parsed.timestamp, Object.assign(existing, parsed));
    });

    return Array.from(map.values())
        .filter(row => row && row.timestamp)
        .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
}

function renderSignalThreadSagaCycles(host, thread) {
    if (!host) return;
    host.innerHTML = '';
    const cycles = deriveSagaCycles(thread);
    if (cycles.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'message-system';
        empty.textContent = 'No cycle history recorded yet. Recent cycle material may appear inside Observations / Reflections.';
        host.appendChild(empty);
        return;
    }

    cycles.forEach(cycle => {
        const card = document.createElement('div');
        card.className = 'signal-thread-cycle';

        const title = document.createElement('div');
        title.className = 'signal-thread-cycle-title';
        const stamp = cycle && cycle.timestamp ? String(cycle.timestamp) : '';
        title.textContent = stamp ? (formatRelativeTime(stamp) + (cycle.mode ? (' · ' + cycle.mode) : '')) : (cycle.mode || 'cycle');
        if (stamp) title.title = stamp;

        const body = document.createElement('div');
        body.className = 'signal-thread-cycle-body';
        const parts = [];
        if (cycle.situation) parts.push('situation:\n' + String(cycle.situation));
        if (cycle.application) parts.push('application:\n' + String(cycle.application));
        if (cycle.observation) parts.push('observation:\n' + String(cycle.observation));
        if (cycle.reflection) parts.push('reflection:\n' + String(cycle.reflection));
        body.textContent = parts.join('\n\n');

        card.appendChild(title);
        card.appendChild(body);
        host.appendChild(card);
    });
}

function renderSignalThreadOverviewMeta(host, thread) {
    if (!host) return;
    host.innerHTML = '';
    const t = thread && typeof thread === 'object' ? thread : {};
    const reflections = Array.isArray(t.reflections) ? t.reflections.length : 0;
    const observations = Array.isArray(t.observations) ? t.observations.length : 0;
    const cycles = deriveSagaCycles(t).length;
    const latestReflection = Array.isArray(t.reflections)
        ? t.reflections.slice().sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')))[0]
        : null;

    function previewText(text, fallback = '—') {
        const raw = String(text || '').trim();
        if (!raw) return fallback;
        const firstLine = raw.split('\n')[0].trim();
        const short = firstLine.length > 84 ? firstLine.slice(0, 84).trimEnd() + '…' : firstLine;
        return short || fallback;
    }

    const items = [
        ['purpose', previewText(t.purpose)],
        ['open pressures', Array.isArray(t.openPressures) && t.openPressures.length ? String(t.openPressures.length) : '0'],
        ['carry forward', Array.isArray(t.carryForwardEntries) ? String(t.carryForwardEntries.length) : '0'],
        ['recent reflection', previewText(latestReflection && latestReflection.content ? latestReflection.content : '')],
        ['sessions', Array.isArray(t.sessionIds) ? String(t.sessionIds.length) : '0'],
        ['created', t.createdAt ? String(t.createdAt) : '—'],
        ['last updated', t.updatedAt ? String(t.updatedAt) : '—'],
        ['observations', String(observations)],
        ['reflections', String(reflections)],
        ['cycles', cycles ? String(cycles) : '—'],
        ['thread note', previewText(t.summary)],
    ];

    items.forEach(([key, val]) => {
        const row = document.createElement('div');
        row.className = 'signal-thread-meta-item';
        const k = document.createElement('span');
        k.className = 'signal-thread-meta-key';
        k.textContent = key + ':';
        const v = document.createElement('span');
        v.className = 'signal-thread-meta-val';
        v.textContent = val;
        row.appendChild(k);
        row.appendChild(v);
        host.appendChild(row);
    });
}

function fillSignalThreadEditor(thread, { createMode = false } = {}) {
    _activeSignalThread = thread;
    _activeSignalThreadId = thread && thread.id ? thread.id : null;

    const empty = document.getElementById('signal-thread-empty');
    const editor = document.getElementById('signal-thread-editor');
    if (empty) empty.style.display = 'none';
    if (editor) editor.style.display = '';

    const titleInput = document.getElementById('signal-thread-title-input');
    const postureSelect = document.getElementById('signal-thread-posture-select');
    const statusSelect = document.getElementById('signal-thread-status-select');
    const tagsInput = document.getElementById('signal-thread-tags-input');
    const purposeInput = document.getElementById('signal-thread-purpose-input');
    const summaryInput = document.getElementById('signal-thread-summary-input');
    const situationInput = document.getElementById('signal-thread-current-situation-input');
    const pressureInput = document.getElementById('signal-thread-open-pressure-input');
    const compressionInput = document.getElementById('signal-thread-compression-input');
    const sourceNotesInput = document.getElementById('signal-thread-source-notes-input');
    const saveBtn = document.getElementById('signal-thread-save-btn');

    if (titleInput) titleInput.value = thread && thread.title ? thread.title : '';
    if (postureSelect) postureSelect.value = thread && thread.posture ? thread.posture : 'exploratory';
    if (statusSelect) statusSelect.value = thread && thread.status ? thread.status : 'active';
    if (tagsInput) tagsInput.value = thread && Array.isArray(thread.tags) ? thread.tags.join(', ') : '';
    if (purposeInput) purposeInput.value = thread && typeof thread.purpose === 'string' ? thread.purpose : '';
    if (summaryInput) summaryInput.value = thread && typeof thread.summary === 'string' ? thread.summary : '';
    if (situationInput) situationInput.value = thread && typeof thread.currentSituation === 'string' ? thread.currentSituation : '';
    if (pressureInput) pressureInput.value = thread && typeof thread.openPressure === 'string' ? thread.openPressure : '';
    if (compressionInput) compressionInput.value = thread && typeof thread.compression === 'string' ? thread.compression : '';
    if (sourceNotesInput) sourceNotesInput.value = thread && typeof thread.sourceNotes === 'string' ? thread.sourceNotes : '';
    if (saveBtn) saveBtn.textContent = createMode ? 'Create' : 'Save';
    if (createMode && titleInput) setTimeout(() => titleInput.focus(), 0);

    const overviewMetaHost = document.getElementById('signal-thread-overview-meta');
    renderSignalThreadOverviewMeta(overviewMetaHost, thread);

    const reflectionsHost = document.getElementById('signal-thread-reflections');
    const observationsHost = document.getElementById('signal-thread-observations');
    renderSignalThreadEntries(reflectionsHost, thread && Array.isArray(thread.reflections) ? thread.reflections : []);
    renderSignalThreadEntries(observationsHost, thread && Array.isArray(thread.observations) ? thread.observations : []);

    const sagaCyclesHost = document.getElementById('signal-thread-saga-cycles');
    renderSignalThreadSagaCycles(sagaCyclesHost, thread);

    clearSignalThreadCycleInputs();
}

function showSignalThreadEmptyState() {
    _activeSignalThreadId = null;
    _activeSignalThread = null;
    const empty = document.getElementById('signal-thread-empty');
    const editor = document.getElementById('signal-thread-editor');
    if (empty) empty.style.display = '';
    if (editor) editor.style.display = 'none';
}

function clearSignalThreadCycleInputs() {
    const modeEl = document.getElementById('signal-thread-cycle-mode-select');
    const situationEl = document.getElementById('signal-thread-cycle-situation-input');
    const applicationEl = document.getElementById('signal-thread-cycle-application-input');
    const observationEl = document.getElementById('signal-thread-cycle-observation-input');
    const reflectionEl = document.getElementById('signal-thread-cycle-reflection-input');

    if (modeEl) modeEl.value = 'real';
    if (situationEl) situationEl.value = '';
    if (applicationEl) applicationEl.value = '';
    if (observationEl) observationEl.value = '';
    if (reflectionEl) reflectionEl.value = '';
}

function _readSignalThreadEditorPayload() {
    const titleInput = document.getElementById('signal-thread-title-input');
    const postureSelect = document.getElementById('signal-thread-posture-select');
    const statusSelect = document.getElementById('signal-thread-status-select');
    const tagsInput = document.getElementById('signal-thread-tags-input');
    const purposeInput = document.getElementById('signal-thread-purpose-input');
    const summaryInput = document.getElementById('signal-thread-summary-input');
    const situationInput = document.getElementById('signal-thread-current-situation-input');
    const pressureInput = document.getElementById('signal-thread-open-pressure-input');
    const compressionInput = document.getElementById('signal-thread-compression-input');
    const sourceNotesInput = document.getElementById('signal-thread-source-notes-input');

    const title = titleInput ? titleInput.value : '';
    const posture = postureSelect ? postureSelect.value : 'exploratory';
    const status = statusSelect ? statusSelect.value : 'active';
    const purpose = purposeInput ? purposeInput.value : '';
    const summary = summaryInput ? summaryInput.value : '';
    const currentSituation = situationInput ? situationInput.value : '';
    const openPressure = pressureInput ? pressureInput.value : '';
    const compression = compressionInput ? compressionInput.value : '';
    const sourceNotes = sourceNotesInput ? sourceNotesInput.value : '';
    const tags = parseTagsFromInput(tagsInput ? tagsInput.value : '');

    return {
        title,
        posture,
        status,
        purpose,
        summary,
        currentSituation,
        openPressure,
        compression,
        sourceNotes,
        tags,
    };
}

async function persistActiveSignalThreadFromEditor({ createIfMissing = false } = {}) {
    const payload = _readSignalThreadEditorPayload();
    const title = String(payload.title || '').trim();
    if (!title) {
        showFlashMessage('Title is required.');
        return null;
    }

    try {
        if (!_activeSignalThreadId) {
            if (!createIfMissing) return null;
            const res = await fetch('/api/signal-threads', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title,
                    purpose: payload.purpose,
                    posture: payload.posture,
                    summary: payload.summary,
                    tags: payload.tags,
                    currentSituation: payload.currentSituation,
                    openPressure: payload.openPressure,
                    sourceNotes: payload.sourceNotes,
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data || !data.success || !data.thread) {
                showFlashMessage(data && data.error ? data.error : 'Could not create thread.');
                return null;
            }
            _activeSignalThreadId = data.thread.id;
        }

        const res = await fetch('/api/signal-threads/' + encodeURIComponent(_activeSignalThreadId), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title,
                purpose: payload.purpose,
                posture: payload.posture,
                status: payload.status,
                summary: payload.summary,
                currentSituation: payload.currentSituation,
                openPressure: payload.openPressure,
                compression: payload.compression,
                sourceNotes: payload.sourceNotes,
                tags: payload.tags,
            }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data || !data.success || !data.thread) {
            showFlashMessage(data && data.error ? data.error : 'Could not save thread.');
            return null;
        }
        return _activeSignalThreadId;
    } catch {
        showFlashMessage('Could not reach server.');
        return null;
    }
}

async function fetchSignalThreadsList() {
    try {
        const res = await fetch('/api/signal-threads');
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data || !Array.isArray(data.threads)) return null;
        return data.threads;
    } catch {
        return null;
    }
}

async function fetchSignalThread(threadId) {
    try {
        const res = await fetch('/api/signal-threads/' + encodeURIComponent(threadId));
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data || !data.thread) return null;
        return data.thread;
    } catch {
        return null;
    }
}

function renderSignalThreadsList(host, threads) {
    if (!host) return;
    host.innerHTML = '';
    const list = Array.isArray(threads) ? threads : [];
    if (list.length === 0) {
        host.innerHTML = '<span class="message-system">No Signal Threads yet.</span>';
        return;
    }

    list.forEach(t => {
        const row = document.createElement('div');
        row.className = 'signal-thread-list-item' + (t.id === _activeSignalThreadId ? ' active' : '');
        row.addEventListener('click', async () => {
            const thread = await fetchSignalThread(t.id);
            if (!thread) {
                showFlashMessage('Could not load Signal Thread.');
                return;
            }
            fillSignalThreadEditor(thread, { createMode: false });
            renderSignalThreadsList(host, _signalThreadsListSnapshot);
        });

        const title = document.createElement('div');
        title.className = 'signal-thread-list-title';
        title.textContent = String(t.title || 'Untitled');

        const meta = document.createElement('div');
        meta.className = 'signal-thread-list-meta';
        const posture = document.createElement('span');
        posture.textContent = 'posture: ' + String(t.posture || 'exploratory');
        const status = document.createElement('span');
        status.textContent = 'status: ' + String(t.status || 'active');
        const updated = document.createElement('span');
        updated.textContent = t.updatedAt ? ('updated ' + formatRelativeTime(t.updatedAt)) : '';
        meta.appendChild(posture);
        meta.appendChild(status);
        if (updated.textContent) meta.appendChild(updated);

        row.appendChild(title);
        row.appendChild(meta);
        host.appendChild(row);
    });
}

async function loadSignalThreadsSummary() {
    const threads = await fetchSignalThreadsList();
    _signalThreadsListSnapshot = threads || [];

    const countEl = document.getElementById('sys-signal-threads-count');
    const statusEl = document.getElementById('sys-signal-threads-status');
    const sagaStatusEl = document.getElementById('sys-saga-smith-status');
    if (countEl) countEl.textContent = threads ? String(threads.length) : '—';
    if (statusEl) statusEl.textContent = threads ? 'Meaning continuity available.' : 'Signal Threads unavailable.';
    if (sagaStatusEl) {
        if (!threads) sagaStatusEl.textContent = 'Saga Smith unavailable.';
        else sagaStatusEl.textContent = threads.length > 0 ? 'Ready for a continuity cycle.' : 'Create a Signal Thread to begin.';
    }
}

function openSignalThreadsOverlay() {
    const overlay = document.getElementById('signal-threads-overlay');
    if (overlay) overlay.style.display = 'flex';
}

function closeSignalThreadsOverlay() {
    const overlay = document.getElementById('signal-threads-overlay');
    if (overlay) overlay.style.display = 'none';
}

async function refreshSignalThreadsOverlay({ createNew = false } = {}) {
    const listHost = document.getElementById('signal-threads-list');
    const status = document.getElementById('signal-threads-list-status');
    if (status) status.textContent = 'Loading…';
    const threads = await fetchSignalThreadsList();
    _signalThreadsListSnapshot = threads || [];
    if (status) status.textContent = threads ? (threads.length + ' threads') : 'Unavailable';
    renderSignalThreadsList(listHost, _signalThreadsListSnapshot);
    loadSignalThreadsSummary();

    if (createNew) {
        fillSignalThreadEditor({
            id: null,
            title: '',
            purpose: '',
            posture: 'exploratory',
            status: 'active',
            summary: '',
            currentSituation: '',
            openPressure: '',
            compression: '',
            sourceNotes: '',
            tags: [],
            reflections: [],
            observations: [],
        }, { createMode: true });
        return;
    }

    if (_activeSignalThreadId) {
        const thread = await fetchSignalThread(_activeSignalThreadId);
        if (thread) {
            fillSignalThreadEditor(thread, { createMode: false });
            return;
        }
    }
    showSignalThreadEmptyState();
}

async function saveActiveSignalThread() {
    const { title, posture, status, purpose, summary, currentSituation, openPressure, compression, sourceNotes, tags } = _readSignalThreadEditorPayload();

    try {
        if (!_activeSignalThreadId) {
            const res = await fetch('/api/signal-threads', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title, purpose, posture, summary, tags, currentSituation, openPressure, sourceNotes }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data || !data.success || !data.thread) {
                showFlashMessage(data && data.error ? data.error : 'Could not create thread.');
                return;
            }
            _activeSignalThreadId = data.thread.id;
            showFlashMessage('Signal Thread created.');
            if (compression) await persistActiveSignalThreadFromEditor();
            await refreshSignalThreadsOverlay({ createNew: false });
            return;
        }

        const res = await fetch('/api/signal-threads/' + encodeURIComponent(_activeSignalThreadId), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, purpose, posture, status, summary, currentSituation, openPressure, compression, sourceNotes, tags }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data || !data.success || !data.thread) {
            showFlashMessage(data && data.error ? data.error : 'Could not save thread.');
            return;
        }
        showFlashMessage('Signal Thread saved.');
        await refreshSignalThreadsOverlay({ createNew: false });
    } catch {
        showFlashMessage('Could not reach server.');
    }
}

async function deleteActiveSignalThread() {
    if (!_activeSignalThreadId) return;
    if (!confirm('Delete this Signal Thread? This cannot be undone.')) return;
    try {
        const res = await fetch('/api/signal-threads/' + encodeURIComponent(_activeSignalThreadId), { method: 'DELETE' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data || !data.success) {
            showFlashMessage(data && data.error ? data.error : 'Could not delete thread.');
            return;
        }
        showFlashMessage('Signal Thread deleted.');
        _activeSignalThreadId = null;
        await refreshSignalThreadsOverlay({ createNew: false });
    } catch {
        showFlashMessage('Could not reach server.');
    }
}

async function addReflectionToActiveThread() {
    if (!_activeSignalThreadId) return;
    const input = document.getElementById('signal-thread-reflection-input');
    const content = input ? input.value : '';
    if (!String(content || '').trim()) return;
    try {
        const res = await fetch('/api/signal-threads/' + encodeURIComponent(_activeSignalThreadId) + '/reflections', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data || !data.success) {
            showFlashMessage(data && data.error ? data.error : 'Could not add reflection.');
            return;
        }
        if (input) input.value = '';
        await refreshSignalThreadsOverlay({ createNew: false });
    } catch {
        showFlashMessage('Could not reach server.');
    }
}

async function addObservationToActiveThread() {
    if (!_activeSignalThreadId) return;
    const input = document.getElementById('signal-thread-observation-input');
    const content = input ? input.value : '';
    if (!String(content || '').trim()) return;
    try {
        const res = await fetch('/api/signal-threads/' + encodeURIComponent(_activeSignalThreadId) + '/observations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data || !data.success) {
            showFlashMessage(data && data.error ? data.error : 'Could not add observation.');
            return;
        }
        if (input) input.value = '';
        await refreshSignalThreadsOverlay({ createNew: false });
    } catch {
        showFlashMessage('Could not reach server.');
    }
}

async function exportActiveSignalThread() {
    if (!_activeSignalThreadId) return;
    try {
        const res = await fetch('/api/signal-threads/' + encodeURIComponent(_activeSignalThreadId) + '/export');
        if (!res.ok) {
            showFlashMessage('Export failed.');
            return;
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const title = _activeSignalThread && _activeSignalThread.title ? String(_activeSignalThread.title) : 'signal-thread';
        const safe = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'signal-thread';
        a.download = safe + '.md';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        showFlashMessage('Export downloaded.');
    } catch {
        showFlashMessage('Could not reach server.');
    }
}

async function copyActiveSignalThreadBrief() {
    if (!_activeSignalThreadId) return;
    try {
        const res = await fetch('/api/signal-threads/' + encodeURIComponent(_activeSignalThreadId) + '/brief');
        if (!res.ok) {
            showFlashMessage('Copy Brief failed.');
            return;
        }
        const text = await res.text();
        await copyPlainText(text || '', 'Brief copied.', 'Could not copy brief.');
    } catch {
        showFlashMessage('Could not reach server.');
    }
}

async function saveSignalThreadWorkspaceCycle() {
    const modeEl = document.getElementById('signal-thread-cycle-mode-select');
    const cycleSituationEl = document.getElementById('signal-thread-cycle-situation-input');
    const applicationEl = document.getElementById('signal-thread-cycle-application-input');
    const observationEl = document.getElementById('signal-thread-cycle-observation-input');
    const reflectionEl = document.getElementById('signal-thread-cycle-reflection-input');

    const mode = modeEl ? String(modeEl.value || '').trim() : 'real';
    const cycleSituation = cycleSituationEl ? cycleSituationEl.value : '';
    const application = applicationEl ? applicationEl.value : '';
    const observation = observationEl ? observationEl.value : '';
    const reflection = reflectionEl ? reflectionEl.value : '';

    if (!String(observation || '').trim()) {
        showFlashMessage('Observation is required.');
        return;
    }
    if (!String(reflection || '').trim()) {
        showFlashMessage('Reflection is required.');
        return;
    }

    const editorPayload = _readSignalThreadEditorPayload();
    const situation = String(cycleSituation || '').trim() || String(editorPayload.currentSituation || '').trim();

    const threadId = await persistActiveSignalThreadFromEditor({ createIfMissing: true });
    if (!threadId) return;

    try {
        const res = await fetch('/api/signal-threads/' + encodeURIComponent(threadId) + '/saga-cycle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                mode,
                situation,
                application,
                observation,
                reflection,
                compression: editorPayload.compression,
            }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data || !data.success) {
            showFlashMessage(data && data.error ? data.error : 'Could not save cycle.');
            return;
        }

        clearSignalThreadCycleInputs();
        showFlashMessage('Cycle saved.');
        await refreshSignalThreadsOverlay({ createNew: false });
    } catch {
        showFlashMessage('Could not reach server.');
    }
}

/* ================================================================
   Phase 17F — Saga Smith (continuity practice)
   ================================================================ */

let _sagaSmithThreadId = null;
let _sagaSmithThread = null;

function openSagaSmithOverlay() {
    const overlay = document.getElementById('saga-smith-overlay');
    if (overlay) overlay.style.display = 'flex';
}

function closeSagaSmithOverlay() {
    const overlay = document.getElementById('saga-smith-overlay');
    if (overlay) overlay.style.display = 'none';
}

function _setSagaSmithStatus(text) {
    const el = document.getElementById('saga-smith-status');
    if (el) el.textContent = String(text || '').trim() || '—';
}

function _renderSagaSmithThreadOptions(selectEl, threads) {
    if (!selectEl) return;
    selectEl.innerHTML = '';
    const list = Array.isArray(threads) ? threads : [];
    if (list.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'No Signal Threads yet';
        selectEl.appendChild(opt);
        selectEl.disabled = true;
        return;
    }
    selectEl.disabled = false;
    list.forEach(t => {
        const opt = document.createElement('option');
        opt.value = String(t.id || '');
        opt.textContent = String(t.title || 'Untitled');
        selectEl.appendChild(opt);
    });
}

async function setSagaSmithActiveThread(threadId) {
    const id = String(threadId || '').trim();
    _sagaSmithThreadId = id || null;
    _sagaSmithThread = null;

    const compressionInput = document.getElementById('saga-smith-compression-input');
    if (compressionInput) compressionInput.value = '';

    if (!id) return;
    const thread = await fetchSignalThread(id);
    if (!thread) {
        _setSagaSmithStatus('Could not load Signal Thread.');
        return;
    }
    _sagaSmithThread = thread;
    if (compressionInput) compressionInput.value = typeof thread.compression === 'string' ? thread.compression : '';
}

async function refreshSagaSmithOverlay() {
    _setSagaSmithStatus('Loading…');
    const selectEl = document.getElementById('saga-smith-thread-select');
    const saveBtn = document.getElementById('saga-smith-save-btn');

    const threads = await fetchSignalThreadsList();
    if (!threads) {
        _renderSagaSmithThreadOptions(selectEl, []);
        if (saveBtn) saveBtn.disabled = true;
        _setSagaSmithStatus('Saga Smith unavailable.');
        return;
    }

    _signalThreadsListSnapshot = threads;
    _renderSagaSmithThreadOptions(selectEl, threads);
    if (saveBtn) saveBtn.disabled = threads.length === 0;

    if (threads.length === 0) {
        _setSagaSmithStatus('Create a Signal Thread to begin.');
        return;
    }

    const desiredId = (_sagaSmithThreadId && threads.some(t => t.id === _sagaSmithThreadId))
        ? _sagaSmithThreadId
        : String(threads[0].id || '');
    if (selectEl) selectEl.value = desiredId;
    await setSagaSmithActiveThread(desiredId);
    _setSagaSmithStatus('Ready.');
}

async function saveSagaSmithCycle() {
    const selectEl = document.getElementById('saga-smith-thread-select');
    const modeEl = document.getElementById('saga-smith-mode-select');
    const situationEl = document.getElementById('saga-smith-situation-input');
    const applicationEl = document.getElementById('saga-smith-application-input');
    const observationEl = document.getElementById('saga-smith-observation-input');
    const reflectionEl = document.getElementById('saga-smith-reflection-input');
    const compressionEl = document.getElementById('saga-smith-compression-input');

    const threadId = selectEl ? String(selectEl.value || '').trim() : '';
    if (!threadId) {
        _setSagaSmithStatus('Select or create a Signal Thread first.');
        return;
    }

    const mode = modeEl ? String(modeEl.value || '').trim() : 'exploratory';
    const situation = situationEl ? situationEl.value : '';
    const application = applicationEl ? applicationEl.value : '';
    const observation = observationEl ? observationEl.value : '';
    const reflection = reflectionEl ? reflectionEl.value : '';
    const compression = compressionEl ? compressionEl.value : '';

    _setSagaSmithStatus('Saving…');
    try {
        const res = await fetch('/api/signal-threads/' + encodeURIComponent(threadId) + '/saga-cycle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode, situation, application, observation, reflection, compression }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data || !data.success || !data.thread) {
            _setSagaSmithStatus(data && data.error ? data.error : 'Could not save cycle.');
            return;
        }

        if (situationEl) situationEl.value = '';
        if (applicationEl) applicationEl.value = '';
        if (observationEl) observationEl.value = '';
        if (reflectionEl) reflectionEl.value = '';

        _sagaSmithThread = data.thread;
        _sagaSmithThreadId = data.thread.id;
        if (compressionEl) compressionEl.value = typeof data.thread.compression === 'string' ? data.thread.compression : '';
        _setSagaSmithStatus('Saved to thread.');
        showFlashMessage('Cycle saved to Signal Thread.');
        loadSignalThreadsSummary();
    } catch {
        _setSagaSmithStatus('Could not reach server.');
    }
}

/**
 * Build a dismissible onboarding hint element.
 * Returns null when key is missing or the hint was already dismissed.
 */
function buildOnboardingHint(options = {}) {
    const key = String(options.key || '').trim();
    if (!key || isOnboardingDismissed(key)) return null;
    const wrap = document.createElement('div');
    wrap.className = 'onboarding-hint';

    const body = document.createElement('div');
    const copy = document.createElement('p');
    copy.className = 'onboarding-hint-copy';
    copy.textContent = String(options.text || '').trim();
    body.appendChild(copy);

    if (Array.isArray(options.actions) && options.actions.length > 0) {
        const actions = document.createElement('div');
        actions.className = 'onboarding-hint-actions';
        options.actions.forEach(action => {
            if (!action || typeof action.onClick !== 'function') return;
            const btn = document.createElement('button');
            btn.className = 'secondary threshold-action-btn';
            btn.textContent = String(action.label || 'Open');
            btn.addEventListener('click', action.onClick);
            actions.appendChild(btn);
        });
        if (actions.childNodes.length > 0) body.appendChild(actions);
    }

    const dismissBtn = document.createElement('button');
    dismissBtn.className = 'onboarding-hint-dismiss';
    dismissBtn.type = 'button';
    dismissBtn.textContent = '✕';
    dismissBtn.setAttribute('aria-label', 'Dismiss hint');
    dismissBtn.addEventListener('click', () => {
        dismissOnboardingHint(key);
        wrap.remove();
    });

    wrap.appendChild(body);
    wrap.appendChild(dismissBtn);
    return wrap;
}

function renderThresholdGatewayGuidance() {
    const host = document.getElementById('threshold-gateway-guidance');
    if (!host) return;
    const fallbackNotice = document.querySelector('#th-imports .threshold-notice');
    host.innerHTML = '';
    const hint = buildOnboardingHint({
        key: 'threshold-gateway-guidance',
        text: 'Threshold allows Sentinels to acquire and inspect continuity artifacts before carrying them into the Forge.',
        actions: [
            { label: 'Load into Cache Loadout', onClick: () => openRoomAndSubtab('council', 'ws-caches') },
            { label: 'Review First Ember', onClick: openFirstEmberOverlay },
        ],
    });
    if (hint) {
        host.appendChild(hint);
        if (fallbackNotice) fallbackNotice.style.display = 'none';
    } else if (fallbackNotice) {
        fallbackNotice.style.display = '';
    }
}

function initFirstEmberHintsDismissal() {
    const row = document.querySelector('.orientation-entry-row');
    const mapCard = document.querySelector('.first-ember-map-card');
    if (!row || !mapCard) return;
    const helperCopy = row.querySelector('.orientation-entry-copy');
    const key = 'first-ember-hints';

    if (isOnboardingDismissed(key)) {
        mapCard.style.display = 'none';
        if (helperCopy) helperCopy.style.display = 'none';
        return;
    }

    if (row.querySelector('#first-ember-hints-dismiss-btn')) return;
    const dismissBtn = document.createElement('button');
    dismissBtn.id = 'first-ember-hints-dismiss-btn';
    dismissBtn.className = 'secondary threshold-action-btn';
    dismissBtn.textContent = 'Dismiss Hints';
    dismissBtn.addEventListener('click', () => {
        dismissOnboardingHint(key);
        mapCard.style.display = 'none';
        if (helperCopy) helperCopy.style.display = 'none';
        dismissBtn.remove();
    });
    row.appendChild(dismissBtn);
}

function toArrayList(value) {
    if (Array.isArray(value)) return value.filter(Boolean).map(v => String(v).trim()).filter(Boolean);
    if (!value && value !== 0) return [];
    return [String(value).trim()].filter(Boolean);
}

function formatLabelValue(value) {
    const list = toArrayList(value);
    return list.length ? list.join(', ') : '—';
}

function uniqueCompactList(values, max = 4) {
    const seen = new Set();
    const out = [];
    toArrayList(values).forEach(item => {
        const key = String(item || '').trim().toLowerCase();
        if (!key || seen.has(key)) return;
        seen.add(key);
        out.push(String(item).trim());
    });
    return out.slice(0, max);
}

function deriveCacheThemes(cache) {
    const manifest = cache && cache.manifest && typeof cache.manifest === 'object'
        ? cache.manifest
        : {};
    return uniqueCompactList([
        ...(Array.isArray(cache && cache.continuity_themes) ? cache.continuity_themes : []),
        ...(Array.isArray(manifest.continuity_themes) ? manifest.continuity_themes : []),
    ], 6);
}

function deriveCacheRecommendedArchetypes(cache) {
    const manifest = cache && cache.manifest && typeof cache.manifest === 'object'
        ? cache.manifest
        : {};
    return uniqueCompactList([
        ...(Array.isArray(manifest.recommended_archetypes) ? manifest.recommended_archetypes : []),
        ...(Array.isArray(manifest.preferred_archetypes) ? manifest.preferred_archetypes : []),
        ...(Array.isArray(manifest.archetypes) ? manifest.archetypes : []),
    ], 4);
}

function describeCacheCarrySummary(cache) {
    const safeCache = cache && typeof cache === 'object' ? cache : {};
    const manifest = safeCache.manifest && typeof safeCache.manifest === 'object'
        ? safeCache.manifest
        : {};
    const description = String(
        (manifest.summary || manifest.description || safeCache.description || '').replace(/\s+/g, ' ').trim(),
    );
    if (description) {
        return compactTextSnippet(description, CACHE_CARRY_SUMMARY_MAX_CHARS);
    }
    const themes = deriveCacheThemes(safeCache);
    if (themes.length > 0) {
        return 'This cache focuses on ' + themes.slice(0, 3).join(', ') + '.';
    }
    return 'This cache carries practical continuity for the current loadout.';
}

function buildCompactCacheInspectionLines(cache) {
    const manifest = cache && cache.manifest && typeof cache.manifest === 'object'
        ? cache.manifest
        : {};
    const title = cache && (cache.title || cache.id) ? (cache.title || cache.id) : 'Unnamed Cache';
    const themes = deriveCacheThemes(cache);
    const recommendedArchetypes = deriveCacheRecommendedArchetypes(cache);
    const derivedFrom = uniqueCompactList(
        Array.isArray(manifest.derived_from) ? manifest.derived_from : (cache && cache.derived_from),
        4,
    );
    return [
        'Title: ' + title,
        'Level: ' + describeCacheLevel(cache && cache.level ? cache.level : DEFAULT_CACHE_LEVEL),
        'Summary: ' + describeCacheCarrySummary(cache),
        'Continuity Themes: ' + (themes.length ? themes.join(', ') : '—'),
        'Signal Density: ' + String(cache && cache.signal_density ? cache.signal_density : 'low'),
        'Document Count: ' + String(cache && Number.isFinite(cache.documentCount) ? cache.documentCount : 0),
        'Source: ' + String(cache && cache.source ? cache.source : DEFAULT_CACHE_SOURCE),
    ]
        .concat(derivedFrom.length ? ['Derived From: ' + derivedFrom.join(', ')] : [])
        .concat(recommendedArchetypes.length ? ['Recommended Archetypes: ' + recommendedArchetypes.join(', ')] : []);
}

function titleFromDocumentPath(relPath) {
    const input = String(relPath || '').replace(/\\/g, '/');
    const tail = input.split('/').pop() || input;
    const stem = tail.replace(/\.[^.]+$/, '');
    return stem.replace(/[_-]+/g, ' ').trim() || 'Untitled';
}

function sanitizeDraftIdInput(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/\.[^.]+$/, '')
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function compactTextSnippet(value, maxLength = 500) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    if (text.length <= maxLength) return text;
    const limit = Math.max(1, Math.floor(maxLength) - 1);
    return text.slice(0, limit).trimEnd() + '…';
}

function formatPurposeSummary(value, maxLength = CACHE_CARRY_SUMMARY_MAX_CHARS) {
    const lines = String(value || '')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .slice(0, 5);
    const fallback = 'Purpose summary not set yet. Add a 1–5 line continuity purpose before expanding this cache.';
    return compactTextSnippet(lines.length > 0 ? lines.join(' ') : fallback, maxLength);
}

function safeIsoTimestamp(value) {
    if (!value) return new Date().toISOString();
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return new Date().toISOString();
    return date.toISOString();
}

function toPortableSlug(value, fallback = 'handoff') {
    const slug = String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
    return slug || fallback;
}

function normalizeRuntimeTuningArchetype(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return RUNTIME_TUNING_ARCHETYPE_IDS.has(normalized) ? normalized : 'ember-prime';
}

function runtimeTuningArchetypeToApiMember(archetype) {
    const normalized = normalizeRuntimeTuningArchetype(archetype);
    return normalized === 'ember-prime' ? undefined : normalized;
}

function formatRuntimeTuningMetric(value, suffix = '') {
    if (value === null || value === undefined || value === '' || Number.isNaN(Number(value))) return '—';
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return '—';
    return String(Math.round(numeric * 100) / 100) + suffix;
}

function buildConversationFragmentMarkdown(options = {}) {
    const title = String(options.title || 'Conversation Fragment').trim() || 'Conversation Fragment';
    const source = String(options.source || 'ember-node').trim() || 'ember-node';
    const archetype = String(options.archetype || 'Ember Prime').trim() || 'Ember Prime';
    const context = String(options.context || '').trim();
    const userExchange = String(options.userExchange || '').trim();
    const assistantExchange = String(options.assistantExchange || '').trim();
    const reflectionNotes = String(options.reflectionNotes || '').trim();
    const suggestedNextSteps = String(options.suggestedNextSteps || '').trim();
    const created = safeIsoTimestamp(options.created);
    const exchangeBlocks = [];
    if (userExchange) exchangeBlocks.push('## Sentinel\n' + userExchange);
    if (assistantExchange) exchangeBlocks.push('## Ember Response\n' + assistantExchange);
    return [
        '---',
        'title: ' + title,
        'type: handoff',
        'source: ' + source,
        'archetype: ' + archetype,
        'created: ' + created,
        '---',
        '# Context',
        context || '-',
        '',
        '# Exchange',
        exchangeBlocks.length ? exchangeBlocks.join('\n\n') : '-',
        '',
        '# Reflection Notes',
        reflectionNotes || '-',
        '',
        '# Suggested Next Steps',
        suggestedNextSteps || '-',
        '',
    ].filter(Boolean).join('\n');
}

function buildExternalAiPrompt(options = {}) {
    const focus = compactTextSnippet(options.focus || 'Current Ember Node continuity context.', 900);
    const archetype = String(options.archetype || getCourtMemberDisplayLabel(getActiveCourtMemberId())).trim() || 'Ember Prime';
    const sourceLabel = String(options.sourceLabel || 'Ember Node').trim() || 'Ember Node';
    const cacheLoadoutLine = Array.isArray(options.cacheLoadout) && options.cacheLoadout.length > 0
        ? ('Loaded cache context: ' + options.cacheLoadout.join(', '))
        : 'Loaded cache context: (not provided)';
    return [
        '# External AI Prompt Bridge',
        '',
        'You are receiving continuity context from Ember Node.',
        'Return practical, grounded output in clean markdown.',
        '',
        '## Input Context',
        '- Source: ' + sourceLabel,
        '- Active archetype: ' + archetype,
        '- Objective: produce a reusable markdown handoff for Ember Node continuity.',
        '- ' + cacheLoadoutLine,
        '',
        '## Context Snapshot',
        focus || '(none)',
        '',
        '## Return Format Requirements',
        '- Return markdown only (no preface, no code fences around the whole file).',
        '- Prefer a portable handoff structure with concise frontmatter and clear section headings.',
        '- Include practical assumptions, open questions, and next tests.',
        '- Keep output cache-ready and easy to copy into .md files.',
        '',
        '## Preferred Deliverables',
        '- clean markdown handoff',
        '- concise summary',
        '- cache-ready document',
        '- research report or code review when applicable',
        '- distilled next-step options',
    ].join('\n');
}

function buildGreenFireHandoffPrompt(archetype) {
    const lens = String(archetype || '').trim().toLowerCase();
    const lensLine = lens
        ? `Apply a ${lens} lens and include that in frontmatter archetypes.`
        : 'Use the best-fit lens for the material.';
    return `You are preparing a Green Fire Markdown Handoff for Ember Node.

Return only one complete markdown document.
Do not include commentary before or after the markdown.

Requirements:
- Use this exact frontmatter key set:
  title
  type (research-brief | field-note | bootstrap | manual-summary | cache-readme | source-summary)
  source
  created
  status (unverified | reviewed | trusted | local)
  archetypes
  tags
  license
- Keep values concise and practical.
- Fill all sections with useful content.
- Preserve section order exactly:
  # Summary
  # Key Knowledge
  # Practical Use
  # Risks / Unknowns
  # Suggested Cache Placement
  # Sources
- Use markdown only.
- ${lensLine}

Template to follow:
${GREEN_FIRE_HANDOFF_TEMPLATE}`;
}

async function copyPlainText(text, successMessage, failureMessage) {
    try {
        if (!navigator.clipboard || !navigator.clipboard.writeText) {
            showFlashMessage('Clipboard unavailable.');
            return false;
        }
        await navigator.clipboard.writeText(text || '');
        if (successMessage) showFlashMessage(successMessage);
        return true;
    } catch {
        if (failureMessage) showFlashMessage(failureMessage);
        return false;
    }
}

function downloadPlainText(filename, content, contentType = 'text/plain') {
    const safeName = String(filename || 'download.txt').trim() || 'download.txt';
    const blob = new Blob([content || ''], { type: contentType + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = safeName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

/* ================================================================
   Room Tab Switching
   ================================================================ */

let _activeRoomId = 'session';

(function initRoomTabs() {
    const tabs   = document.querySelectorAll('.room-tab');
    const panels = document.querySelectorAll('.room-panel');

    function activateRoom(roomId) {
        const previousRoomId = _activeRoomId;
        _activeRoomId = roomId;
        if (_isChatGenerating && previousRoomId && previousRoomId !== roomId) {
            stillTheSignal();
        }
        tabs.forEach(t => {
            const isActive = t.dataset.room === roomId;
            t.classList.toggle('active', isActive);
            t.setAttribute('aria-selected', String(isActive));
        });
        panels.forEach(p => {
            p.classList.toggle('active', p.id === 'room-' + roomId);
        });

        if (roomId === 'council' && !window._councilLoaded) {
            loadCouncilPanel();
        }
        if (roomId === 'threshold') {
            loadThresholdList();
            loadThresholdCacheDrafts();
        }
        if (roomId === 'hearth') {
            // Local-data reads only. Hosted Archive package/signal requests
            // and Advanced System status are loaded lazily when the user
            // opens the relevant hearth-archive / hearth-system sub-tab
            // (see initSubTabs below) — not merely from opening Hearth.
            loadHearthThreads();
            loadHearthArchive();
            loadHearthTrustedArchive();
            loadHearthRememberedThreads();
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
                if (panelId === 'ws-council-chat') {
                    updateCouncilChatActiveArchetype();
                }
                if (panelId === 'ws-archetypes') {
                    loadCouncilArchetypes();
                }
                if (panelId === 'ws-caches' && !window._cachesLoaded) {
                    loadCacheShelf();
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
                    loadHearthRuntimeRegistry();
                    loadContextMemoryStatus();
                    loadBootstrapStatus();
                    loadLoadoutForgePanel();
                    loadMemoryCompressionStatus();
                    syncRuntimeTuningControls();
                    loadRuntimeTuningHistory();
                }
                if (panelId === 'th-ai') {
                    loadThresholdRuntimes();
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

function openCouncilChatWithPrompt(promptText, courtMemberId, options = {}) {
    const councilTab = document.querySelector('.room-tab[data-room="council"]');
    if (councilTab) councilTab.click();
    const councilChatTab = document.querySelector('.sub-tab[data-subtab="ws-council-chat"]');
    if (councilChatTab) councilChatTab.click();
    setPendingCouncilDistillationGuidance(Boolean(options && options.distillationGuidance));
    const normalizedMemberId = normalizeCourtMemberId(courtMemberId);
    if (normalizedMemberId) {
        setActiveCourtMemberId(normalizedMemberId);
        updateCouncilChatActiveArchetype();
        loadCouncilArchetypes();
    }
    const inputEl = document.getElementById('ws-council-input');
    if (inputEl) {
        inputEl.value = String(promptText || '').trim();
        inputEl.focus();
    }
}

const CACHE_LEVEL_MEANINGS = Object.freeze({
    spark: 'raw fragment / discovery',
    ember: 'refined synthesis',
    flame: 'integrated cross-domain continuity',
    hearth: 'foundational continuity structure',
});

function normalizeCacheLevel(value) {
    const raw = String(value || 'spark').trim().toLowerCase();
    return CACHE_LEVEL_MEANINGS[raw] ? raw : 'spark';
}

function describeCacheLevel(value) {
    const normalized = normalizeCacheLevel(value);
    return normalized + ' — ' + CACHE_LEVEL_MEANINGS[normalized];
}

function getCacheLevelMeaning(value) {
    return CACHE_LEVEL_MEANINGS[normalizeCacheLevel(value)];
}

function buildDocumentDiscussionPrompt(options = {}) {
    const title = String(options.title || 'Document').trim() || 'Document';
    const source = String(options.source || 'Unknown source').trim() || 'Unknown source';
    const excerpt = compactTextSnippet(options.content || '', 1200);
    return [
        'Discuss this document with me:',
        '',
        '- Title: ' + title,
        '- Source: ' + source,
        '',
        'Context excerpt:',
        excerpt || '(no excerpt)',
        '',
        'Please help me surface assumptions, key tensions, and practical next steps.',
    ].join('\n');
}

function summarizeDistillationThemes(list) {
    const themes = Array.isArray(list)
        ? list.map(item => String(item || '').trim()).filter(Boolean)
        : [];
    if (themes.length === 0) return 'none listed yet';
    return themes.slice(0, MAX_DISTILLATION_THEME_DISPLAY).join(', ');
}

function normalizeSignalToken(value) {
    return String(value || '').trim().toLowerCase();
}

function normalizeSignalList(value) {
    const input = Array.isArray(value) ? value : (value ? [value] : []);
    return Array.from(new Set(
        input
            .map(normalizeSignalToken)
            .filter(Boolean),
    ));
}

function normalizeSignalDocuments(value) {
    if (!Array.isArray(value)) return [];
    return value
        .map(item => {
            if (!item) return '';
            if (typeof item === 'string') return item;
            if (typeof item === 'object') {
                return item.title || item.path || item.relativePath || '';
            }
            return '';
        })
        .map(text => String(text || '').trim())
        .filter(Boolean);
}

function collectTitleKeywords(text) {
    const normalized = String(text || '').toLowerCase();
    const keywordPattern = new RegExp(`[a-z0-9][a-z0-9_-]{${Math.max(0, MIN_SIGNAL_KEYWORD_LENGTH - 1)},}`, 'g');
    const words = normalized.match(keywordPattern) || [];
    return Array.from(new Set(words.slice(0, MAX_SIGNAL_KEYWORDS)));
}

function countSharedSignals(left, right) {
    const rightSet = new Set(right || []);
    return (left || []).filter(item => rightSet.has(item)).length;
}

function collectSignalProfile(input) {
    const source = input && typeof input === 'object' ? input : {};
    const manifest = source && source.manifest && typeof source.manifest === 'object'
        ? source.manifest
        : source;
    const title = String(
        source.title || manifest.title || manifest.name || source.id || manifest.id || 'cache',
    ).trim() || 'cache';
    const documents = normalizeSignalDocuments(
        manifest.documents || source.documents || source.readerEntries || [],
    );
    const tags = normalizeSignalList(manifest.tags || source.tags || []);
    const archetypes = normalizeSignalList(
        manifest.archetypes || manifest.preferred_archetypes || source.archetypes || [],
    );
    const continuityThemes = normalizeSignalList(
        manifest.continuity_themes || source.continuity_themes || [],
    );
    const purposeSummary = String(
        manifest.purpose_summary || manifest.purposeSummary || source.purpose_summary || source.purposeSummary || source.description || '',
    ).trim();
    const level = normalizeSignalToken(manifest.level || source.level || 'spark') || 'spark';
    const titleKeywords = collectTitleKeywords([title].concat(documents).join(' '));
    return {
        id: String(source.id || manifest.id || title).trim(),
        title,
        level,
        purposeSummary,
        tags,
        archetypes,
        continuityThemes,
        documents,
        titleKeywords,
        signalDensity: normalizeSignalToken(manifest.signal_density || source.signal_density || 'low') || 'low',
    };
}

function scoreSignalOverlap(baseProfile, otherProfile) {
    const sharedThemes = countSharedSignals(baseProfile.continuityThemes, otherProfile.continuityThemes);
    const sharedTags = countSharedSignals(baseProfile.tags, otherProfile.tags);
    const sharedArchetypes = countSharedSignals(baseProfile.archetypes, otherProfile.archetypes);
    const sharedKeywords = countSharedSignals(baseProfile.titleKeywords, otherProfile.titleKeywords);
    const sharedDocuments = countSharedSignals(
        normalizeSignalList(baseProfile.documents),
        normalizeSignalList(otherProfile.documents),
    );
    const sameLevel = baseProfile.level === otherProfile.level ? SIGNAL_OVERLAP_LEVEL_WEIGHT : 0;
    const score = (sharedThemes * SIGNAL_OVERLAP_THEME_WEIGHT) +
        (sharedTags * SIGNAL_OVERLAP_TAG_WEIGHT) +
        (sharedArchetypes * SIGNAL_OVERLAP_ARCHETYPE_WEIGHT) +
        (sharedKeywords * SIGNAL_OVERLAP_KEYWORD_WEIGHT) +
        (sharedDocuments * SIGNAL_OVERLAP_DOCUMENT_WEIGHT) +
        sameLevel;
    let level = 'low';
    if (score >= HIGH_SIGNAL_OVERLAP_THRESHOLD) level = 'high';
    else if (score >= MODERATE_SIGNAL_OVERLAP_THRESHOLD) level = 'moderate';
    const focusSet = new Set();
    const addFocus = (items) => {
        (items || []).forEach(item => {
            const label = String(item || '').trim();
            if (!label) return;
            focusSet.add(label);
        });
    };
    addFocus(baseProfile.continuityThemes.filter(item => otherProfile.continuityThemes.includes(item)).slice(0, 2));
    addFocus(baseProfile.tags.filter(item => otherProfile.tags.includes(item)).slice(0, 2));
    addFocus(baseProfile.titleKeywords.filter(item => otherProfile.titleKeywords.includes(item)).slice(0, 2));
    return { score, level, focus: Array.from(focusSet).slice(0, 3) };
}

function buildMissingPerspectiveHints(profile) {
    const lenses = new Set((profile.archetypes || []).map(normalizeSignalToken));
    const hints = [];
    if (!lenses.has('builder')) hints.push('Builder review may add practical steps.');
    if (!lenses.has('scholar')) hints.push('Scholar review may add source comparison.');
    if (!lenses.has('scribe')) hints.push('Scribe review may tighten clarity.');
    if (!lenses.has('warrior')) hints.push('Warrior review may pressure-test risk.');
    if (!lenses.has('mystic')) hints.push('Mystic review may surface symbolic patterns.');
    return hints.slice(0, 3);
}

function buildSignalDisciplineHints(target, peers = []) {
    const profile = collectSignalProfile(target);
    const peerProfiles = Array.isArray(peers)
        ? peers
            .filter(entry => entry && String(entry.id || '').trim() !== String(profile.id || '').trim())
            .map(collectSignalProfile)
        : [];
    const overlaps = peerProfiles
        .map(peer => ({ peer, overlap: scoreSignalOverlap(profile, peer) }))
        .sort((a, b) => b.overlap.score - a.overlap.score);
    const strongestOverlap = overlaps[0] || null;
    const overlapHint = strongestOverlap && strongestOverlap.overlap.level !== 'low'
        ? ('This cache overlaps with ' +
            strongestOverlap.peer.title +
            ' around ' +
            (strongestOverlap.overlap.focus.length > 0
                ? strongestOverlap.overlap.focus.join(', ')
                : 'shared continuity signals') +
            '.')
        : null;
    const missingPerspectives = buildMissingPerspectiveHints(profile);
    const highOverlap = Boolean(strongestOverlap && strongestOverlap.overlap.level === 'high');
    const moderateOverlap = Boolean(strongestOverlap && strongestOverlap.overlap.level === 'moderate');
    const redundancyRisk = highOverlap
        ? 'High overlap signal; review before adding more cache volume.'
        : moderateOverlap
            ? 'Moderate overlap signal; selective distillation may reduce repetition.'
            : 'Low overlap signal; continue with focused additions.';
    const compressionOpportunity = highOverlap || moderateOverlap
        ? 'These Spark caches may carry related signal. Distillation could preserve the strongest continuity while reducing repetition.'
        : 'Compression opportunity is optional; refine clarity before expanding breadth.';
    const distillationReadiness = highOverlap || moderateOverlap
        ? 'These caches preserve overlapping continuity. Distillation may strengthen clarity while reducing repetition.'
        : 'Distillation readiness is moderate; tighten purpose and source grounding before compressing further.';
    const hasPurposeSummary = Boolean(String(profile.purposeSummary || '').trim());
    const hasThemes = profile.continuityThemes.length > 0;
    const hasSources = profile.documents.length > 0;
    const weakSignalNotes = [];
    if (!hasPurposeSummary) weakSignalNotes.push('Purpose summary is unclear or missing.');
    if (!hasThemes) weakSignalNotes.push('Continuity themes are broad or under-defined.');
    if (!hasSources) weakSignalNotes.push('Source grounding is thin; add reviewed material.');
    if (profile.signalDensity === 'low') weakSignalNotes.push('Synthesis is still sparse; compress less and clarify more.');
    const weakSignalGuidance = weakSignalNotes.length > 0
        ? weakSignalNotes.slice(0, 2).join(' ')
        : 'No major weak signal patterns detected at this time.';
    const highSignalNotes = [];
    if (hasPurposeSummary) highSignalNotes.push('clear purpose summary');
    if (hasThemes) highSignalNotes.push('distinct continuity themes');
    if (hasSources) highSignalNotes.push('source-grounded synthesis');
    if (profile.signalDensity === 'high' || profile.signalDensity === 'moderate') {
        highSignalNotes.push('compact signal density');
    }
    const highSignalReinforcement = highSignalNotes.length > 0
        ? 'This cache carries strong signal through ' + highSignalNotes.slice(0, 3).join(', ') + '.'
        : 'Build stronger signal with compact summaries, practical grounding, and clearer purpose.';
    const suggestedStewardAction = highOverlap
        ? 'Review for Distillation · Generate Distillation Recommendation · Create an Ember-level synthesis.'
        : moderateOverlap
            ? 'Review for Distillation and consider an Ember-level synthesis if repetition grows.'
            : 'Keep this cache compact, source-grounded, and stewarded by Sentinel judgment.';
    const strongestSignal = profile.continuityThemes.length > 0
        ? profile.continuityThemes.slice(0, 3).join(', ')
        : (profile.tags.length > 0 ? profile.tags.slice(0, 3).join(', ') : profile.title);
    let signalDensityHint = 'Low continuity density; identify one core throughline to strengthen carry weight.';
    if (profile.signalDensity === 'high') {
        signalDensityHint = 'Dense continuity signal; maintain compact framing to keep it legible.';
    } else if (profile.signalDensity === 'moderate') {
        signalDensityHint = 'Moderate continuity density; tighten repeated phrasing as themes recur.';
    }
    const qualityGuidance = [
        'Useful signs: clear purpose, specific sources, compact summary, low redundancy.',
        'Noise signs: scope drift, repeated content, missing source notes.',
    ];
    const suggestedNextSteps = highOverlap
        ? ['Distill overlapping Sparks', 'Compress repeated summaries', 'Review through Scholar']
        : ['Load into Forge', 'Add practical field notes', 'Review through Scholar'];
    const stewardship = 'The Sentinel decides what to keep, refine, distill, load, or transmit. The Node recommends, not commands.';
    return {
        profile,
        strongestSignal,
        overlapHint,
        signalDensityHint,
        redundancyRisk,
        distillationReadiness,
        weakSignalGuidance,
        highSignalReinforcement,
        missingPerspectives,
        compressionOpportunity,
        suggestedStewardAction,
        suggestedNextSteps,
        qualityGuidance,
        stewardship,
        highOverlap,
    };
}

function buildSignalDisciplineNoteMarkdown(hints) {
    const safeHints = hints && typeof hints === 'object' ? hints : {};
    const {
        strongestSignal,
        signalDensityHint,
        redundancyRisk,
        overlapHint,
        missingPerspectives,
        compressionOpportunity,
        suggestedStewardAction,
        qualityGuidance,
        stewardship,
    } = safeHints;
    const signal = strongestSignal || 'No dominant continuity signal identified yet.';
    const risk = redundancyRisk || 'Redundancy risk not assessed.';
    const missing = Array.isArray(missingPerspectives) && missingPerspectives.length > 0
        ? missingPerspectives.join('\n')
        : 'No major missing perspective flagged yet.';
    const compression = compressionOpportunity
        ? compressionOpportunity
        : 'Compression opportunity not assessed.';
    const action = suggestedStewardAction
        ? suggestedStewardAction
        : 'Sentinel stewardship review recommended.';
    return [
        '# Signal Discipline Note',
        '',
        '## Strongest Signal',
        signal,
        'Signal Density: ' + (signalDensityHint || 'Not assessed.'),
        '',
        '## Redundancy Risk',
        risk,
        overlapHint || '',
        '',
        '## Distillation Readiness',
        safeHints.distillationReadiness || 'Not assessed.',
        '',
        '## Weak Signal Guidance',
        safeHints.weakSignalGuidance || 'Not assessed.',
        '',
        '## High Signal Reinforcement',
        safeHints.highSignalReinforcement || 'Not assessed.',
        '',
        '## Missing Perspectives',
        missing,
        '',
        '## Compression Opportunity',
        compression,
        '',
        '## Suggested Steward Action',
        action,
        Array.isArray(safeHints.suggestedNextSteps) ? ('Suggested Next Steps: ' + safeHints.suggestedNextSteps.join(' · ')) : '',
        Array.isArray(qualityGuidance) ? qualityGuidance.join('\n') : '',
        '',
        stewardship || '',
        '',
    ].filter(Boolean).join('\n');
}

function buildCacheCompressionPrompt(options = {}) {
    const title = String(options.title || options.id || 'Cache').trim() || 'Cache';
    const source = String(options.source || 'archive').trim() || 'archive';
    const themes = summarizeDistillationThemes(options.continuityThemes);
    const scope = String(options.scopeHint || '').trim();
    const lines = [
        'Discuss cache compression with me.',
        '',
        '- Cache: ' + title,
        '- Source: ' + source,
        '- Continuity themes: ' + themes,
    ];
    if (scope) lines.push('- Scope: ' + scope);
    lines.push(
        '',
        'Focus on overlap, redundancy, strongest signal, and compact mentor guidance.',
        'Evaluate distillation readiness across overlap, clarity, redundancy, signal density, and missing perspectives.',
        'Surface missing perspectives, missing archetype reviews, missing continuity domains, practical grounding gaps, and narrative cohesion gaps.',
        'Mentor weak-signal patterns constructively and reinforce high-signal patterns when present.',
        'Treat cache creation as distilled continuity: gather → review → summarize → distill → structure → package.',
        'Clarify lifecycle continuity: conversation → markdown → cache → distillation.',
        'End with concise Suggested Next Steps (for example: Load into Forge, Review through Scholar, Distill overlapping Sparks).',
        'If one lens dominates, name what comparison lens is missing (for example Builder-heavy lacking Scholar comparison).',
        'Keep Sentinel agency central: no automatic merge or deletion.',
    );
    return lines.join('\n');
}

function buildCacheThemeComparisonPrompt(options = {}) {
    const title = String(options.title || options.id || 'Cache Set').trim() || 'Cache Set';
    const source = String(options.source || 'archive').trim() || 'archive';
    const themes = summarizeDistillationThemes(options.continuityThemes);
    const candidateInput = options.candidateCaches;
    const candidates = Array.isArray(candidateInput)
        ? candidateInput.filter(Boolean).join(', ')
        : String(candidateInput || '').trim();
    return [
        'Compare cache themes with me.',
        '',
        '- Context: ' + title,
        '- Source: ' + source,
        '- Candidate caches: ' + (candidates || title),
        '- Continuity themes: ' + themes,
        '',
        'Identify shared continuity threads, repeated concepts, strongest signal, and weak continuity domains.',
        'Assess distillation readiness: overlap, clarity, redundancy, signal density, and missing perspectives.',
        'Reinforce high-signal continuity and name weak-signal patterns constructively.',
        'Keep continuity lifecycle explicit: conversation → markdown → cache → distillation.',
        'Close with concise Suggested Next Steps.',
        'Highlight missing perspectives before distillation.',
        'Keep guidance concise. The Sentinel decides what to distill.',
    ].join('\n');
}

function buildDistillationRecommendationPrompt(options = {}) {
    const title = String(options.title || options.id || 'Cache Set').trim() || 'Cache Set';
    const candidateCaches = Array.isArray(options.candidateCaches) ? options.candidateCaches : [];
    const themes = Array.isArray(options.continuityThemes) ? options.continuityThemes : [];
    const sourceHint = String(options.sourceHint || '').trim();
    const candidateLines = candidateCaches.length > 0
        ? candidateCaches.map((item, idx) => (idx + 1) + '. ' + item).join('\n')
        : '1. (No specific cache list provided)';
    const themeLines = themes.length > 0
        ? themes.map(item => '- ' + item).join('\n')
        : '- none listed yet';
    const promptLines = [
        'Create a Distillation Recommendation for continuity compression.',
        '',
        'Context title: ' + title,
    ];
    if (sourceHint) promptLines.push('Source context: ' + sourceHint);
    promptLines.push(
        'Candidate caches:',
        candidateLines,
        '',
        'Known continuity themes:',
        themeLines,
        '',
        'Use this exact structure and headings:',
        '# Distillation Recommendation',
        '## Candidate Caches',
        '## Shared Continuity Themes',
        '## Repeated Concepts',
        '## Strongest Signal',
        '## Distillation Readiness',
        '## Weak Signal Guidance',
        '## High Signal Reinforcement',
        '## Missing Perspectives',
        '## Suggested Compression Direction',
        '## Recommended Archetype Review',
        '## Suggested Next Step',
        '',
        'Shared Continuity Themes = recurring threads across multiple caches.',
        'Repeated Concepts = specific ideas or terms that keep repeating.',
        '',
        'Tone: mentor-guided, practical, reflective, concise, and non-gamey.',
        'When relevant, name missing archetype comparison, continuity domains, practical grounding, or narrative cohesion.',
        'Mention cache purpose and markdown handoff continuity where useful (conversation → markdown → cache → distillation).',
        'Keep the Sentinel central: no auto-merge, no auto-delete, no automatic tier distillation.',
    );
    return promptLines.filter(Boolean).join('\n');
}

function buildDistillationRecommendationMarkdown(answer, options = {}) {
    const content = String(answer || '').trim();
    if (!content) return '# Distillation Recommendation\n\n_No recommendation generated._\n';
    const disciplineHints = buildSignalDisciplineHints({
        title: options.title || 'Distillation Recommendation',
        level: options.level || 'spark',
        continuity_themes: options.continuityThemes || [],
        tags: options.tags || [],
        archetypes: options.archetypes || [],
        signal_density: options.signalDensity || 'moderate',
        documents: options.documents || [],
    }, options.peerCaches || []);
    const disciplineNote = buildSignalDisciplineNoteMarkdown(disciplineHints);
    if (/^#\s+Distillation Recommendation\b/im.test(content)) {
        return content + '\n\n' + disciplineNote + '\n';
    }
    const title = String(options.title || 'Distillation Recommendation').trim();
    return [
        '# Distillation Recommendation',
        '',
        '## Candidate Caches',
        '- Context: ' + title,
        '',
        '## Shared Continuity Themes',
        content,
        '',
        '## Repeated Concepts',
        '- _to be refined_',
        '',
        '## Strongest Signal',
        '- _to be refined_',
        '',
        '## Missing Perspectives',
        '- _to be refined_',
        '',
        '## Suggested Compression Direction',
        '- _to be refined_',
        '',
        '## Recommended Archetype Review',
        '- _to be refined_',
        '',
        '## Suggested Next Step',
        '- _to be refined_',
        '',
        disciplineNote,
        '',
    ].join('\n');
}

async function requestDistillationRecommendation(options = {}) {
    const query = buildDistillationRecommendationPrompt(options);
    const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            query,
            room: 'council',
            responseDepth: getActiveResponseDepth(),
            runtimeProfile: getActiveRuntimeProfile(),
            loadoutFocus: getActiveLoadoutFocus(),
            distillationGuidance: true,
            courtMember: undefined,
        }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data || typeof data.answer !== 'string') {
        throw new Error((data && data.error) || 'Could not generate distillation recommendation.');
    }
    const markdown = buildDistillationRecommendationMarkdown(data.answer, options);
    const title = (options.title ? String(options.title) : 'Distillation Recommendation') + ' · Recommendation';
    getGreenFireReader().open({
        title,
        sourcePath: options.sourceHint || 'distillation/recommendation',
        sourceLabel: 'Distillation Recommendation',
        content: markdown,
        contentType: 'text/markdown',
        entryId: 'distillation-recommendation:' + Date.now(),
        stripFrontmatter: false,
        rawOnly: false,
        initialRawView: false,
    });
    showFlashMessage('Distillation recommendation generated.');
    markSentinelTrialStep('distillation_trial', 'distillation_recommendation_generated');
}

function createCouncilDiscussActions(resolvePrompt, resolveLabel) {
    const wrap = document.createElement('div');
    wrap.className = 'bridge-discuss-actions';
    COURT_DISCUSS_ACTIONS.forEach(action => {
        const btn = document.createElement('button');
        btn.className = 'secondary threshold-action-btn';
        btn.textContent = action.label;
        btn.addEventListener('click', () => {
            Promise.resolve(typeof resolvePrompt === 'function' ? resolvePrompt(action.id) : '')
                .then(prompt => {
                    openCouncilChatWithPrompt(prompt, action.id);
                    const label = typeof resolveLabel === 'function' ? resolveLabel() : 'document';
                    showFlashMessage(action.label + ' · context sent from ' + label + '.');
                })
                .catch(() => {
                    showFlashMessage('Could not prepare discussion context.');
                });
        });
        wrap.appendChild(btn);
    });
    return wrap;
}

function createCollapsibleActionPanel(title, body, className = 'gf-collapsible-panel') {
    const panel = document.createElement('details');
    panel.className = className;
    const summary = document.createElement('summary');
    summary.textContent = String(title || 'Actions');
    panel.appendChild(summary);
    const content = document.createElement('div');
    content.className = 'gf-collapsible-panel-body';
    if (body) content.appendChild(body);
    panel.appendChild(content);
    return panel;
}

async function saveMarkdownToThresholdInbox(markdown, filename, successMessage) {
    const body = {
        markdown: String(markdown || ''),
        filename: String(filename || '').trim() || undefined,
    };
    const res = await fetch('/api/threshold/inbox/markdown', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
        throw new Error(data.error || 'Could not save markdown handoff.');
    }
    if (successMessage) showFlashMessage(successMessage);
    await loadThresholdList();
    markSentinelTrialStep('scribe_structuring', 'handoff_saved');
    return data.file || null;
}

function buildExchangeContextSummary(options = {}) {
    const room = String(options.room || 'hearth');
    const archetype = getCourtMemberDisplayLabel(getActiveCourtMemberId());
    const userText = compactTextSnippet(options.user || '', 280);
    const assistantText = compactTextSnippet(options.assistant || '', 320);
    return [
        'Room: ' + room,
        'Active archetype: ' + archetype,
        userText ? ('Sentinel: ' + userText) : '',
        assistantText ? ('Ember: ' + assistantText) : '',
    ].filter(Boolean).join('\n');
}

function buildResponseBridgeActions(options = {}) {
    const wrapper = document.createElement('div');
    wrapper.className = 'bridge-action-stack';
    const room = String(options.room || 'hearth');
    const userText = String(options.user || '').trim();
    const assistantText = String(options.assistant || '').trim();
    const sourceTitle = String(options.sourceTitle || 'Conversation Exchange').trim() || 'Conversation Exchange';
    const sourceLabel = String(options.sourceLabel || 'chat').trim() || 'chat';
    const contextSummary = buildExchangeContextSummary({
        room,
        user: userText,
        assistant: assistantText,
    });
    const exchangeMarkdown = buildConversationFragmentMarkdown({
        title: sourceTitle,
        source: sourceLabel,
        archetype: getCourtMemberDisplayLabel(getActiveCourtMemberId()),
        context: contextSummary,
        userExchange: userText,
        assistantExchange: assistantText,
        reflectionNotes: 'What assumptions in this exchange should be tested next?',
        suggestedNextSteps: 'Study: Compare this with relevant loaded caches.\nCompression: Distill into a compact handoff if needed.',
    });

    const makeActionButton = (action) => {
        const btn = document.createElement('button');
        btn.className = 'secondary threshold-action-btn';
        btn.textContent = action.label;
        btn.addEventListener('click', () => action.run());
        return btn;
    };

    const bridgeActionsWrap = document.createElement('div');
    bridgeActionsWrap.className = 'bridge-action-row';
    [
        {
            label: 'Copy Prompt for External AI',
            run: async () => {
                const prompt = buildExternalAiPrompt({
                    sourceLabel,
                    focus: [contextSummary, assistantText].filter(Boolean).join('\n\n'),
                });
                await copyPlainText(prompt, 'External AI prompt copied.', 'Could not copy prompt.');
            },
        },
        {
            label: 'Copy Context Summary',
            run: async () => {
                await copyPlainText(contextSummary, 'Context summary copied.', 'Could not copy context summary.');
            },
        },
    ].forEach(action => bridgeActionsWrap.appendChild(makeActionButton(action)));

    const exportActionsWrap = document.createElement('div');
    exportActionsWrap.className = 'bridge-action-row';
    [
        {
            label: 'Save Response as .md',
            run: () => {
                const markdown = [
                    '# ' + sourceTitle,
                    '',
                    assistantText || '(no response)',
                    '',
                ].join('\n');
                downloadPlainText(toPortableSlug(sourceTitle, 'ember-response') + '.md', markdown, 'text/markdown');
                showFlashMessage('Response saved as markdown.');
            },
        },
        {
            label: 'Save Exchange as .md Handoff',
            run: () => {
                downloadPlainText(toPortableSlug(sourceTitle, 'exchange-handoff') + '.md', exchangeMarkdown, 'text/markdown');
                showFlashMessage('Exchange handoff saved.');
            },
        },
        {
            label: 'Save Conversation Fragment as .md',
            run: () => {
                const fragmentMarkdown = buildConversationFragmentMarkdown({
                    title: sourceTitle + ' Fragment',
                    source: sourceLabel,
                    archetype: getCourtMemberDisplayLabel(getActiveCourtMemberId()),
                    context: contextSummary,
                    userExchange: userText,
                    assistantExchange: assistantText,
                    reflectionNotes: 'What should be validated before integrating this into continuity memory?',
                    suggestedNextSteps: 'Integration: Decide where this fragment belongs.\nTransmission: Export a compact prompt bridge if needed.',
                });
                downloadPlainText(
                    toPortableSlug(sourceTitle, 'conversation-fragment') + '.md',
                    fragmentMarkdown,
                    'text/markdown',
                );
                showFlashMessage('Conversation fragment saved.');
            },
        },
    ].forEach(action => exportActionsWrap.appendChild(makeActionButton(action)));

    const councilActionsWrap = createCouncilDiscussActions(
        () => [
            'Discuss this exchange with me:',
            '',
            'Room: ' + room,
            'Archetype: ' + getCourtMemberDisplayLabel(getActiveCourtMemberId()),
            userText ? ('Sentinel: ' + compactTextSnippet(userText, 520)) : '',
            assistantText ? ('Ember: ' + compactTextSnippet(assistantText, 720)) : '',
            '',
            'Surface assumptions, tensions, and one practical next step.',
        ].filter(Boolean).join('\n'),
        () => room + ' exchange',
    );

    wrapper.appendChild(createCollapsibleActionPanel('Council Discussion', councilActionsWrap));
    wrapper.appendChild(createCollapsibleActionPanel('Bridge Actions', bridgeActionsWrap));
    wrapper.appendChild(createCollapsibleActionPanel('Export / Save', exportActionsWrap));
    return wrapper;
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
let _stopExtendedRuneAettirLoop = null;
let _chatRequestSeq = 0;
let _chatCancelledByUser = false;
let _lastDiscussionExchange = null;
let _lastInspectedCacheSummary = null;

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
    const hearthSendButton = document.getElementById('send-button');
    const hearthStopButton = document.getElementById('stop-response-button');
    const councilSendButton = document.getElementById('ws-council-send-button');
    const councilStopButton = document.getElementById('ws-stop-response-button');
    if (hearthSendButton) hearthSendButton.disabled = _isChatGenerating;
    if (hearthStopButton) hearthStopButton.style.display = _isChatGenerating ? '' : 'none';
    if (councilSendButton) councilSendButton.disabled = _isChatGenerating;
    if (councilStopButton) councilStopButton.style.display = _isChatGenerating ? '' : 'none';
}

function clearChatLongWaitTimer() {
    if (_activeChatLongWaitTimer) {
        clearTimeout(_activeChatLongWaitTimer);
        _activeChatLongWaitTimer = null;
    }
}

function resetActiveChatState() {
    clearChatLongWaitTimer();
    stopExtendedRuneAettirAnimation();
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
    stopExtendedRuneAettirAnimation();
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
    stopExtendedRuneAettirAnimation();
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

const EXTENDED_AETTIR_ROWS = Object.freeze([
    '᛬ᚠᚢᚦᚨᚱᚲᚷᚹ᛬',
    '᛬ᚺᚾᛁᛃᛇᛈᛉᛋ᛬',
    '᛬ᛏᛒᛖᛗᛚᛝᛞᛟ᛬',
]);

/** Stop and clean up any active extended rune ættir animation loop. */
function stopExtendedRuneAettirAnimation() {
    if (typeof _stopExtendedRuneAettirLoop === 'function') {
        _stopExtendedRuneAettirLoop();
    }
    _stopExtendedRuneAettirLoop = null;
}

/**
 * Start the extended rune ættir animation in the provided container.
 * @param {HTMLElement} containerEl
 * @returns {() => void} cleanup function
 */
function startExtendedRuneAettirAnimation(containerEl) {
    if (!containerEl) return () => {};
    stopExtendedRuneAettirAnimation();

    const wrapper = document.createElement('div');
    wrapper.className = 'extended-rune-aettir';
    const allRunes = [];
    EXTENDED_AETTIR_ROWS.forEach(rowText => {
        const row = document.createElement('div');
        row.className = 'rune-aettir-row';
        Array.from(rowText).forEach(ch => {
            const span = document.createElement('span');
            span.className = 'rune-aettir-char';
            span.textContent = ch;
            row.appendChild(span);
            allRunes.push(span);
        });
        wrapper.appendChild(row);
    });
    containerEl.appendChild(wrapper);

    let index = 0;
    let mode = 'show';
    const stepMs = 165;
    const timer = setInterval(() => {
        if (mode === 'show') {
            if (index < allRunes.length) {
                allRunes[index].classList.add('visible');
                index += 1;
            } else {
                // Once fully visible, traverse the same rune order to fade out.
                mode = 'hide';
                index = 0;
            }
        } else if (index < allRunes.length) {
            allRunes[index].classList.remove('visible');
            index += 1;
        } else {
            mode = 'show';
            index = 0;
        }
    }, stepMs);

    const stop = () => {
        clearInterval(timer);
        if (wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);
    };
    _stopExtendedRuneAettirLoop = stop;
    return stop;
}


function setTraceStatus(text) {
    const el = document.getElementById('signal-trace-status');
    if (el) el.textContent = text;
}

function formatMemoryFlow(memoryFlow) {
    if (!memoryFlow) return null;
    return [
        'Rolling Bootstrap: ' + (memoryFlow.rollingBootstrap || 'unavailable'),
        'Archetype Memory: ' + (memoryFlow.archetypeMemory || 'ember_prime'),
        'Cache Summaries: ' + String(memoryFlow.cacheSummaries || 0),
        'Document Summaries: ' + String(memoryFlow.documentSummaries || 0),
        'Raw Chunks: ' + String(memoryFlow.rawChunks || 0),
    ].join(' · ');
}

function renderSignalTrace(sources, signalTrace = null) {
    const MAX_SOURCE_LIST_DISPLAY_CHARS = 180;
    const MIN_TRUNCATION_POSITION = 40;
    const traceSources = document.getElementById('signal-trace-sources');
    if (!traceSources) return;
    traceSources.innerHTML = '';

    const metadata = signalTrace && typeof signalTrace === 'object' ? signalTrace : null;
    const compactTraceText = metadata && metadata.compact ? String(metadata.compact) : '';
    const contextStatus = metadata && metadata.contextStatus ? String(metadata.contextStatus) : null;
    const sourcesUsed = metadata && Number.isFinite(metadata.sourcesUsed) ? metadata.sourcesUsed : null;
    const sourceList = metadata && Array.isArray(metadata.sourceList) ? metadata.sourceList : [];
    const conceptRoute = metadata && metadata.conceptRoute ? String(metadata.conceptRoute) : null;
    const courtLens = metadata && metadata.courtLens ? String(metadata.courtLens) : null;
    const courtDomains = metadata && Array.isArray(metadata.courtDomains) ? metadata.courtDomains : [];
    const depth = metadata && metadata.depth ? String(metadata.depth) : null;
    const runtimeProfile = metadata && metadata.runtimeProfile ? String(metadata.runtimeProfile) : null;
    const loadoutFocus = metadata && typeof metadata.loadoutFocus === 'boolean'
        ? metadata.loadoutFocus
        : null;
    const distillationGuidance = metadata && typeof metadata.distillationGuidance === 'boolean'
        ? metadata.distillationGuidance
        : null;
    const model = metadata && metadata.model ? String(metadata.model) : null;
    const provider = metadata && metadata.provider ? String(metadata.provider) : null;
    const rollingBootstrapStatus = metadata && metadata.rollingBootstrapStatus
        ? String(metadata.rollingBootstrapStatus)
        : null;
    const rollingBootstrapThemes = metadata && Array.isArray(metadata.rollingBootstrapThemes)
        ? metadata.rollingBootstrapThemes.map(String).slice(0, 5)
        : [];
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
    const memoryFlow = metadata && metadata.memoryFlow && typeof metadata.memoryFlow === 'object'
        ? metadata.memoryFlow
        : null;
    const loadedCacheCount = metadata && Number.isFinite(metadata.loadedCacheCount)
        ? Number(metadata.loadedCacheCount)
        : null;
    const cacheLoadout = metadata && Array.isArray(metadata.cacheLoadout)
        ? metadata.cacheLoadout.map(String).slice(0, 5)
        : [];

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
        if (rollingBootstrapStatus) parts.push('Rolling Bootstrap ' + rollingBootstrapStatus);
        setTraceStatus(parts.join(' · '));
    } else if (!sources || sources.length === 0) {
        if (rollingBootstrapStatus) {
            setTraceStatus('Rolling Bootstrap ' + rollingBootstrapStatus + ' · base model — no local sources');
        } else {
            setTraceStatus('base model — no local sources');
        }
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
    const rows = compactTraceText
        ? [
            {
                key: 'Trace',
                value: compactTraceText,
            },
        ]
        : [
            {
                key: 'Memory',
                value: formatMemoryFlow(memoryFlow),
            },
            {
                key: 'Bootstrap',
                value: rollingBootstrapStatus
                    ? (
                        rollingBootstrapThemes.length > 0
                            ? rollingBootstrapStatus + ' — ' + boundedListText(rollingBootstrapThemes.slice(0, 5))
                            : rollingBootstrapStatus
                    )
                    : null,
            },
            {
                key: 'Loadout',
                value: loadedCacheCount !== null
                    ? (
                        cacheLoadout.length > 0
                            ? String(loadedCacheCount) + ' · ' + boundedListText(cacheLoadout)
                            : String(loadedCacheCount)
                    )
                    : null,
            },
            { key: 'Lens', value: courtLens || 'Ember Prime' },
            { key: 'Depth', value: depth },
            { key: 'Profile', value: runtimeProfile },
            { key: 'Carry', value: loadoutFocus === null ? null : (loadoutFocus ? 'ON' : 'OFF') },
            { key: 'Distill', value: distillationGuidance === null ? null : (distillationGuidance ? 'ON' : 'OFF') },
            { key: 'Bridge', value: compactRoute },
            { key: 'Context', value: dedupedContextSummary.length > 0 ? boundedListText(dedupedContextSummary) : null },
            { key: 'Model', value: model },
            { key: 'Provider', value: provider },
        ];

    rows.forEach(row => {
        if (!row.value) return;
        const item = document.createElement('div');
        item.className = 'signal-trace-item';
        item.innerHTML =
            '<span class="trace-badge" title="' + escapeHtml(row.key + ': ' + row.value) + '"><span class="trace-key">' +
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
        if (!isCollapsed) {
            markSentinelTrialStep('first_ember', 'signal_trace_opened');
        }
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
            thinkingLabel.textContent = 'Ember Prime is taking longer than usual. You may wait or still the signal.';
            const stopExtendedAnim = startExtendedRuneAettirAnimation(thinking);
            if (typeof stopExtendedAnim === 'function') _stopExtendedRuneAettirLoop = stopExtendedAnim;
            chatContainer.scrollTop = chatContainer.scrollHeight;
        }
    }, LONG_WAIT_THRESHOLD_MS);

    const responseDepth = getActiveResponseDepth();
    try {
        const response = await fetch('/api/chat', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: _activeChatAbortController.signal,
            body:    JSON.stringify({
                query:     message,
                room:      'hearth',
                sourceIds: _chatRefs.length > 0 ? _chatRefs.map(r => r.sourceId) : undefined,
                courtMember: getEffectiveCourtMemberForApi(),
                responseDepth,
                runtimeProfile: getActiveRuntimeProfile(),
                loadoutFocus: getActiveLoadoutFocus(),
                distillationGuidance: false,
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
                glyphEffect: _glyphResolveEnabled && responseDepth !== 'spark',
                onFrame: () => { chatContainer.scrollTop = chatContainer.scrollHeight; },
                shouldStop: () => _activeChatRevealToken.cancelled,
            });

            if (revealResult && revealResult.interrupted) {
                displayMessage(chatContainer, 'Signal stilled by user.', 'message-system');
                setTraceStatus('response interrupted');
                setChatState(CHAT_STATES.INTERRUPTED);
            } else {
                const bridgeActions = buildResponseBridgeActions({
                    room: 'hearth',
                    user: message,
                    assistant: data.answer,
                    sourceTitle: 'Hearth Exchange ' + new Date().toISOString().slice(0, 10),
                    sourceLabel: 'hearth-chat',
                });
                chatContainer.appendChild(bridgeActions);
                renderSignalTrace(data.sources || [], data.signalTrace || null);
                setChatState(CHAT_STATES.COMPLETE);
                recordSentinelDepthUsage(responseDepth);
                _lastDiscussionExchange = {
                    room: 'hearth',
                    user: message,
                    assistant: data.answer,
                    created: new Date().toISOString(),
                };

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

/* ================================================================
   Ember Council — Council Chat
   ================================================================ */

(function initCouncilChat() {
    const sendButton = document.getElementById('ws-council-send-button');
    const stopButton = document.getElementById('ws-stop-response-button');
    const input = document.getElementById('ws-council-input');
    if (sendButton) sendButton.addEventListener('click', sendCouncilMessage);
    if (stopButton) stopButton.addEventListener('click', () => { stillTheSignal(); });
    if (input) {
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (!_isChatGenerating) sendCouncilMessage();
            }
        });
    }
})();

/** Update Council Chat with the currently active archetype label. */
function updateCouncilChatActiveArchetype() {
    const statusEl = document.getElementById('ws-council-active-archetype');
    if (!statusEl) return;
    const memberId = getActiveCourtMemberId();
    const memberLabel = getCourtMemberDisplayLabel(memberId);
    statusEl.textContent = 'Active archetype: ' + memberLabel;
}

/** Send a Council Chat message through /api/chat using the active archetype lens. */
async function sendCouncilMessage() {
    const chatContainer = document.getElementById('ws-council-messages');
    const messageInput = document.getElementById('ws-council-input');
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

    _activeChatLongWaitTimer = setTimeout(() => {
        if (_isChatGenerating && _chatState === CHAT_STATES.THINKING) {
            thinkingLabel.textContent = 'Ember Prime is taking longer than usual. You may wait or still the signal.';
            const stopExtendedAnim = startExtendedRuneAettirAnimation(thinking);
            if (typeof stopExtendedAnim === 'function') _stopExtendedRuneAettirLoop = stopExtendedAnim;
            chatContainer.scrollTop = chatContainer.scrollHeight;
        }
    }, LONG_WAIT_THRESHOLD_MS);

    const responseDepth = getActiveResponseDepth();
    try {
        const response = await fetch('/api/chat', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: _activeChatAbortController.signal,
            body: JSON.stringify({
                query: message,
                room: 'council',
                courtMember: getEffectiveCourtMemberForApi(),
                responseDepth,
                runtimeProfile: getActiveRuntimeProfile(),
                loadoutFocus: getActiveLoadoutFocus(),
                distillationGuidance: consumePendingCouncilDistillationGuidance(),
                requestId: _activeChatRequestId,
            }),
        });
        const data = await response.json().catch(() => ({}));
        cleanupThinkingIndicator(chatContainer, thinking, cancelAnim);
        clearChatLongWaitTimer();

        if (response.status === 499 || (data && data.cancelled)) {
            displayMessage(chatContainer, 'Signal stilled by user.', 'message-system');
            setChatState(CHAT_STATES.INTERRUPTED);
        } else if (response.status === 504 || (data && data.timeout)) {
            displayMessage(
                chatContainer,
                data.message || 'Ember Prime is taking longer than usual. You may wait or still the signal.',
                'message-system',
            );
            setChatState(CHAT_STATES.ERROR);
        } else if (data && typeof data.answer === 'string') {
            const responseEl = displayMessage(chatContainer, '', 'message-heart message-heart-live');
            _activeChatResponseEl = responseEl;
            _activeChatRevealToken = { cancelled: false };
            setChatState(CHAT_STATES.RESOLVING);
            chatContainer.scrollTop = chatContainer.scrollHeight;
            setChatState(CHAT_STATES.RESPONDING);
            const revealResult = await resolveGlyphText(responseEl, data.answer, {
                glyphEffect: _glyphResolveEnabled && responseDepth !== 'spark',
                onFrame: () => { chatContainer.scrollTop = chatContainer.scrollHeight; },
                shouldStop: () => _activeChatRevealToken.cancelled,
            });
            if (revealResult && revealResult.interrupted) {
                displayMessage(chatContainer, 'Signal stilled by user.', 'message-system');
                setChatState(CHAT_STATES.INTERRUPTED);
            } else {
                const bridgeActions = buildResponseBridgeActions({
                    room: 'council',
                    user: message,
                    assistant: data.answer,
                    sourceTitle: 'Council Exchange ' + new Date().toISOString().slice(0, 10),
                    sourceLabel: 'council-chat',
                });
                chatContainer.appendChild(bridgeActions);
                setChatState(CHAT_STATES.COMPLETE);
                _lastDiscussionExchange = {
                    room: 'council',
                    user: message,
                    assistant: data.answer,
                    created: new Date().toISOString(),
                };
                recordSentinelDepthUsage(responseDepth);
            }
        } else {
            displayMessage(chatContainer, HEART_TECHNICAL_ERROR, 'message-system');
            setChatState(CHAT_STATES.ERROR);
        }
    } catch (err) {
        clearChatLongWaitTimer();
        cleanupThinkingIndicator(chatContainer, thinking, cancelAnim);
        if (_chatCancelledByUser || (err && err.name === 'AbortError')) {
            displayMessage(chatContainer, 'Signal stilled by user.', 'message-system');
            setChatState(CHAT_STATES.INTERRUPTED);
        } else {
            displayMessage(chatContainer, HEART_TECHNICAL_ERROR, 'message-system');
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
                '<span class="ws-source-type">' + escapeHtml(s.sourceType || '') + '</span>' +
                (s.abstract && Array.isArray(s.abstract.themes) && s.abstract.themes.length > 0
                    ? '<span class="source-card-description">Themes: ' + escapeHtml(s.abstract.themes.slice(0, 3).join(', ')) + '</span>'
                    : '') +
                (s.abstract && Array.isArray(s.abstract.preferred_archetypes) && s.abstract.preferred_archetypes.length > 0
                    ? '<span class="source-card-description">Preferred archetypes: ' + escapeHtml(s.abstract.preferred_archetypes.slice(0, 3).join(', ')) + '</span>'
                    : '');
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
   Ember Council — Draft / Notepad
   ================================================================ */

(function initCouncil() {
    const saveNoteBtn = document.getElementById('save-note-btn');
    const clearBtn    = document.getElementById('clear-draft-btn');
    const draftArea   = document.getElementById('council-draft');
    const statusEl    = document.getElementById('council-status');

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
                const res  = await fetch('/api/council/drafts', {
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

function loadCouncilPanel() {
    window._councilLoaded = true;
    loadCouncilArchetypes();
    updateCouncilChatActiveArchetype();
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
                courtMember: getEffectiveCourtMemberForApi(),
                responseDepth: getActiveResponseDepth(),
                runtimeProfile: getActiveRuntimeProfile(),
                loadoutFocus: getActiveLoadoutFocus(),
                distillationGuidance: false,
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

/** Build a source card element using Phase 4 metadata fields, with action row. */
function buildSourceCard(s) {
    const card = document.createElement('div');
    card.className = 'source-card';

    const title       = s.title || s.file || '(untitled)';
    const statusClass = s.status || (s.room === 'hearth' ? 'remembered' : s.room === 'council' ? 'indexed' : 'waiting');
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
    if (s.abstract && (s.abstract.summary || (Array.isArray(s.abstract.themes) && s.abstract.themes.length > 0))) {
        const abstractParts = [];
        if (Array.isArray(s.abstract.themes) && s.abstract.themes.length > 0) {
            abstractParts.push('Themes: ' + s.abstract.themes.slice(0, 3).join(', '));
        }
        if (Array.isArray(s.abstract.preferred_archetypes) && s.abstract.preferred_archetypes.length > 0) {
            abstractParts.push('Preferred archetypes: ' + s.abstract.preferred_archetypes.slice(0, 3).join(', '));
        }
        const abstractText = abstractParts.length > 0
            ? abstractParts.join(' · ')
            : String(s.abstract.summary || '').slice(0, 140);
        if (abstractText) {
            html += '<div class="source-card-description">' + escapeHtml(abstractText) + '</div>';
        }
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
        menuItems.push({ label: '→ Council Drafts', fn: () => sendSourceToCouncilDrafts(s) });

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
   Ember Council — Caches sub-tab
   ================================================================ */

async function loadCacheShelf() {
    window._cachesLoaded = true;

    const listEl    = document.getElementById('cache-list');
    const loadingEl = document.getElementById('cache-loading');
    if (!listEl) return;

    try {
        const res = await fetch('/api/caches/installed');
        const data = await res.json();
        const caches = Array.isArray(data.caches) ? data.caches : [];
        _installedCachesSnapshot = caches.slice();

        if (loadingEl) loadingEl.remove();

        if (caches.length === 0) {
            listEl.innerHTML = '<div class="message-system">No continuity caches are currently loaded.</div>';
            const hint = buildOnboardingHint({
                key: 'cache-shelf-empty',
                text: 'Threshold allows Sentinels to acquire and inspect continuity artifacts before carrying them into the Forge.',
                actions: [
                    { label: 'Load into Cache Loadout', onClick: () => openRoomAndSubtab('threshold', 'th-imports') },
                    { label: 'Start Here · First Ember', onClick: openFirstEmberOverlay },
                ],
            });
            if (hint) listEl.appendChild(hint);
            updateSystemCacheCount(0);
            return;
        }

        listEl.innerHTML = '';
        const installedHeader = document.createElement('div');
        installedHeader.className = 'message-system';
        installedHeader.textContent = 'Installed Caches';
        listEl.appendChild(installedHeader);
        caches.forEach(cache => listEl.appendChild(buildInstalledCacheItem(cache)));

        const loaded = caches.filter(cache => cache.loaded);
        const loadoutHeader = document.createElement('div');
        loadoutHeader.className = 'message-system';
        loadoutHeader.style.marginTop = '0.6rem';
        loadoutHeader.textContent = 'Cache Loadout — Continuity carried into Forge (' + loaded.length + ')';
        listEl.appendChild(loadoutHeader);
        if (loaded.length > 0) {
            const loadoutActions = document.createElement('div');
            loadoutActions.className = 'threshold-file-actions';
            loadoutActions.style.marginBottom = '0.45rem';

            const reviewLoadoutBtn = document.createElement('button');
            reviewLoadoutBtn.className = 'secondary threshold-action-btn';
            reviewLoadoutBtn.textContent = 'Review for Distillation';
            reviewLoadoutBtn.addEventListener('click', async () => {
                try {
                    const themes = loaded.flatMap(cache => {
                        const manifest = cache && cache.manifest && typeof cache.manifest === 'object'
                            ? cache.manifest
                            : {};
                        return Array.isArray(manifest.continuity_themes) ? manifest.continuity_themes : [];
                    });
                    await requestDistillationRecommendation({
                        title: 'Cache Loadout',
                        sourceHint: 'loaded cache loadout',
                        candidateCaches: loaded.map(cache => cache.title || cache.id).filter(Boolean),
                        continuityThemes: Array.from(new Set(themes.map(item => String(item || '').trim()).filter(Boolean))),
                        peerCaches: loaded,
                    });
                } catch (error) {
                    showFlashMessage(error.message || 'Could not generate distillation recommendation.');
                }
            });

            const discussLoadoutBtn = document.createElement('button');
            discussLoadoutBtn.className = 'secondary threshold-action-btn';
            discussLoadoutBtn.textContent = 'Discuss Cache Compression';
            discussLoadoutBtn.addEventListener('click', () => {
                const themePool = loaded.flatMap(cache => {
                    const manifest = cache && cache.manifest && typeof cache.manifest === 'object'
                        ? cache.manifest
                        : {};
                    return Array.isArray(manifest.continuity_themes) ? manifest.continuity_themes : [];
                });
                openCouncilChatWithPrompt(
                    buildCacheCompressionPrompt({
                        title: 'Cache Loadout',
                        source: 'loaded cache loadout',
                        continuityThemes: Array.from(new Set(themePool.map(item => String(item || '').trim()).filter(Boolean))),
                    }),
                    EMBER_PRIME_MEMBER_ID,
                    { distillationGuidance: true },
                );
                showFlashMessage('Compression discussion opened in Council Chat.');
            });

            const compareLoadoutBtn = document.createElement('button');
            compareLoadoutBtn.className = 'secondary threshold-action-btn';
            compareLoadoutBtn.textContent = 'Compare Cache Themes';
            compareLoadoutBtn.addEventListener('click', () => {
                const titleList = loaded.map(cache => cache.title || cache.id).filter(Boolean);
                const themePool = loaded.flatMap(cache => {
                    const manifest = cache && cache.manifest && typeof cache.manifest === 'object'
                        ? cache.manifest
                        : {};
                    return Array.isArray(manifest.continuity_themes) ? manifest.continuity_themes : [];
                });
                openCouncilChatWithPrompt(
                    buildCacheThemeComparisonPrompt({
                        title: 'Cache Loadout',
                        source: 'loaded cache loadout',
                        candidateCaches: titleList,
                        continuityThemes: Array.from(new Set(themePool.map(item => String(item || '').trim()).filter(Boolean))),
                    }),
                    EMBER_PRIME_MEMBER_ID,
                    { distillationGuidance: true },
                );
                showFlashMessage('Theme comparison opened in Council Chat.');
            });

            loadoutActions.appendChild(reviewLoadoutBtn);
            loadoutActions.appendChild(discussLoadoutBtn);
            loadoutActions.appendChild(compareLoadoutBtn);
            listEl.appendChild(loadoutActions);
        }
        if (loaded.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'message-system';
            empty.textContent = 'No continuity caches are currently loaded.';
            listEl.appendChild(empty);
            const hint = buildOnboardingHint({
                key: 'empty-loadout',
                text: 'Loaded Caches shape the continuity available to the Node. Inspect a cache, then carry it into the Forge.',
                actions: [
                    { label: 'Inspect Installed', onClick: () => openRoomAndSubtab('council', 'ws-caches') },
                    { label: 'Load into Cache Loadout', onClick: () => openRoomAndSubtab('threshold', 'th-imports') },
                    { label: 'Explore Forge', onClick: () => openRoomAndSubtab('hearth', 'hearth-system') },
                    {
                        label: 'First Ember',
                        onClick: openFirstEmberOverlay,
                    },
                ],
            });
            if (hint) listEl.appendChild(hint);
            if (!isOnboardingDismissed('suggested-first-caches')) {
                const suggestions = [
                    { label: 'Core Cache', match: 'core' },
                    { label: 'Grimoire', match: 'grimoire' },
                    { label: 'First Spark', match: 'spark' },
                    { label: 'Living Sagas', match: 'saga' },
                ];
                const suggestedWrap = document.createElement('div');
                suggestedWrap.className = 'onboarding-hint';

                const body = document.createElement('div');
                const copy = document.createElement('p');
                copy.className = 'onboarding-hint-copy';
                copy.textContent = 'Suggested First Caches: inspect one before loading. No auto-load is applied.';
                body.appendChild(copy);

                const actions = document.createElement('div');
                actions.className = 'onboarding-hint-actions';
                suggestions.forEach(suggestion => {
                    const btn = document.createElement('button');
                    btn.className = 'secondary threshold-action-btn';
                    btn.textContent = suggestion.label;
                    btn.addEventListener('click', () => {
                        const token = String(suggestion.match || '').trim().toLowerCase();
                        const match = caches.find(cache => {
                            const haystack = (cache.title || cache.id || '').toLowerCase();
                            if (!token) return false;
                            const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                            return new RegExp('(^|[^a-z0-9])' + escaped + '([^a-z0-9]|$)', 'i').test(haystack);
                        });
                        if (match) {
                            const item = Array.from(listEl.querySelectorAll('.cache-item'))
                                .find(entry => entry && entry.dataset && entry.dataset.cacheId === match.id);
                            if (item) item.click();
                        } else {
                            openRoomAndSubtab('threshold', 'th-imports');
                        }
                    });
                    actions.appendChild(btn);
                });
                body.appendChild(actions);

                const dismissBtn = document.createElement('button');
                dismissBtn.className = 'onboarding-hint-dismiss';
                dismissBtn.type = 'button';
                dismissBtn.textContent = '✕';
                dismissBtn.setAttribute('aria-label', 'Dismiss suggested first caches');
                dismissBtn.addEventListener('click', () => {
                    dismissOnboardingHint('suggested-first-caches');
                    suggestedWrap.remove();
                });

                suggestedWrap.appendChild(body);
                suggestedWrap.appendChild(dismissBtn);
                listEl.appendChild(suggestedWrap);
            }
        } else {
            const distillationHint = buildOnboardingHint({
                key: 'distillation-view',
                text: 'Distillation preserves signal while reducing redundancy.',
            });
            if (distillationHint) listEl.appendChild(distillationHint);
            loaded.forEach(cache => {
                const row = document.createElement('div');
                row.className = 'cache-item';
                row.innerHTML =
                    '<div class="cache-item-name">' + escapeHtml(cache.title || cache.id) + '</div>' +
                    '<div class="cache-item-type">' + escapeHtml(describeCacheLevel(cache.level)) + '</div>';
                row.addEventListener('click', () => inspectInstalledCache(cache, row));
                listEl.appendChild(row);
            });
        }

        updateSystemCacheCount(caches.length);
    } catch {
        if (loadingEl) loadingEl.remove();
        if (listEl) listEl.innerHTML = '<div class="message-system">Could not load caches.</div>';
    }

    // Also load user caches
    loadUserCaches();
    loadArchiveReaderCatalog();
}

function formatCacheScope(scope) {
    if (!Array.isArray(scope) || scope.length === 0) return 'practical';
    return scope.map(String).slice(0, 4).join(', ');
}

function extractCacheLineageMetadata(cache) {
    const manifest = cache && cache.manifest && typeof cache.manifest === 'object'
        ? cache.manifest
        : {};
    return {
        manifest,
        derivedFrom: Array.isArray(manifest.derived_from) ? manifest.derived_from : [],
        distilledInto: Array.isArray(manifest.distilled_into) ? manifest.distilled_into : [],
        continuityThemes: Array.isArray(manifest.continuity_themes) ? manifest.continuity_themes : [],
        signalDensity: manifest.signal_density ? String(manifest.signal_density) : 'low',
    };
}

function installedCacheMetaBadges(cache) {
    const badges = [];
    const lineage = extractCacheLineageMetadata(cache);
    const levelMeaning = getCacheLevelMeaning(cache.level);
    badges.push('<span class="meta-badge"><strong>' + escapeHtml(String(cache.level || 'spark')) + '</strong>&nbsp;level</span>');
    badges.push('<span class="meta-badge"><strong>' + escapeHtml(levelMeaning) + '</strong>&nbsp;meaning</span>');
    badges.push('<span class="meta-badge"><strong>' + escapeHtml(String(cache.status || 'unverified')) + '</strong>&nbsp;status</span>');
    badges.push('<span class="meta-badge"><strong>' + escapeHtml(formatCacheScope(cache.scope)) + '</strong>&nbsp;scope</span>');
    badges.push('<span class="meta-badge"><strong>' + escapeHtml(lineage.signalDensity) + '</strong>&nbsp;signal</span>');
    badges.push('<span class="meta-badge"><strong>' + escapeHtml(String(lineage.continuityThemes.length)) + '</strong>&nbsp;themes</span>');
    badges.push('<span class="meta-badge"><strong>' + escapeHtml(String(cache.documentCount || 0)) + '</strong>&nbsp;documents</span>');
    badges.push('<span class="meta-badge"><strong>' + (cache.loaded ? 'loaded' : 'not loaded') + '</strong>&nbsp;state</span>');
    return badges.join('');
}

function compactCacheRelationshipText(cache) {
    const lineage = extractCacheLineageMetadata(cache);
    return [
        'Derived From: ' + (lineage.derivedFrom.length > 0 ? lineage.derivedFrom.join(', ') : '—'),
        'Distilled Into: ' + (lineage.distilledInto.length > 0 ? lineage.distilledInto.join(', ') : '—'),
        'Related Themes: ' + (lineage.continuityThemes.length > 0 ? lineage.continuityThemes.join(', ') : '—'),
        'Signal Density: ' + lineage.signalDensity,
    ];
}

function buildInstalledCacheDistillationActions(cache, disciplineHints = null) {
    const wrapper = document.createElement('div');
    wrapper.className = 'threshold-file-actions';
    const lineage = extractCacheLineageMetadata(cache);
    const hints = disciplineHints || buildSignalDisciplineHints(
        cache,
        _installedCachesSnapshot.filter(entry => entry && entry.id !== cache.id),
    );

    const reviewBtn = document.createElement('button');
    reviewBtn.className = 'secondary threshold-action-btn';
    reviewBtn.textContent = 'Generate Distillation Recommendation';
    reviewBtn.addEventListener('click', async () => {
        try {
            await requestDistillationRecommendation({
                title: cache.title || cache.id,
                sourceHint: cache.source || 'archive/cache',
                candidateCaches: [cache.title || cache.id],
                continuityThemes: lineage.continuityThemes,
                peerCaches: _installedCachesSnapshot.filter(entry => entry && entry.id !== cache.id),
                level: cache.level,
                signalDensity: hints.profile.signalDensity,
                tags: hints.profile.tags,
                archetypes: hints.profile.archetypes,
                documents: hints.profile.documents,
            });
        } catch (error) {
            showFlashMessage(error.message || 'Could not generate distillation recommendation.');
        }
    });

    const discussBtn = document.createElement('button');
    discussBtn.className = 'secondary threshold-action-btn';
    discussBtn.textContent = 'Discuss Cache Compression';
    discussBtn.addEventListener('click', () => {
        openCouncilChatWithPrompt(
            buildCacheCompressionPrompt({
                id: cache.id,
                title: cache.title,
                source: cache.source,
                continuityThemes: lineage.continuityThemes,
            }),
            EMBER_PRIME_MEMBER_ID,
            { distillationGuidance: true },
        );
        showFlashMessage('Compression discussion opened in Council Chat.');
    });

    const compareBtn = document.createElement('button');
    compareBtn.className = 'secondary threshold-action-btn';
    compareBtn.textContent = 'Compare Cache Themes';
    compareBtn.addEventListener('click', () => {
        openCouncilChatWithPrompt(
            buildCacheThemeComparisonPrompt({
                id: cache.id,
                title: cache.title,
                source: cache.source,
                candidateCaches: [cache.title || cache.id],
                continuityThemes: lineage.continuityThemes,
            }),
            EMBER_PRIME_MEMBER_ID,
            { distillationGuidance: true },
        );
        showFlashMessage('Theme comparison opened in Council Chat.');
    });

    const noteBtn = document.createElement('button');
    noteBtn.className = 'secondary threshold-action-btn';
    noteBtn.textContent = 'Signal Discipline Note';
    noteBtn.addEventListener('click', () => {
        const markdown = buildSignalDisciplineNoteMarkdown(hints);
        getGreenFireReader().open({
            title: (cache.title || cache.id || 'Cache') + ' · Signal Discipline',
            sourcePath: cache.source || 'cache/signal-discipline',
            sourceLabel: 'Signal Discipline Note',
            content: markdown,
            contentType: 'text/markdown',
            entryId: 'signal-discipline-note:' + (cache.id || Date.now()),
            stripFrontmatter: false,
            rawOnly: false,
            initialRawView: false,
        });
        showFlashMessage('Signal Discipline Note opened in Reader.');
    });

    wrapper.appendChild(reviewBtn);
    wrapper.appendChild(discussBtn);
    wrapper.appendChild(compareBtn);
    wrapper.appendChild(noteBtn);
    return wrapper;
}

async function setCacheLoadedState(cacheId, shouldLoad) {
    const endpoint = shouldLoad ? '/api/caches/load' : '/api/caches/unload';
    const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cacheId }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
        throw new Error(data.error || 'Could not update cache loadout.');
    }
    if (shouldLoad) {
        markSentinelTrialStep('first_ember', 'cache_loaded');
    }
}

function syncCacheInspectorSections() {
    const sections = [
        ['inspector-meta-section', 'inspector-meta'],
        ['inspector-perms-section', 'inspector-perms'],
        ['inspector-content-section', 'inspector-content'],
    ];
    sections.forEach(([sectionId, contentId]) => {
        const sectionEl = document.getElementById(sectionId);
        const contentEl = document.getElementById(contentId);
        if (!sectionEl || !contentEl) return;
        const hasText = String(contentEl.textContent || '').trim().length > 0;
        const hasChildren = contentEl.children && contentEl.children.length > 0;
        const shouldShow = hasText || hasChildren;
        sectionEl.style.display = shouldShow ? '' : 'none';
        if (!shouldShow) sectionEl.open = false;
    });
}

function inspectInstalledCache(cache, itemEl) {
    document.querySelectorAll('.cache-item').forEach(el => {
        el.classList.toggle('active', el === itemEl);
    });
    const emptyEl = document.getElementById('inspector-empty');
    const contentArea = document.getElementById('inspector-content-area');
    const nameEl = document.getElementById('inspector-name');
    const descEl = document.getElementById('inspector-description');
    const metaEl = document.getElementById('inspector-meta');
    const permsEl = document.getElementById('inspector-perms');
    const contentEl = document.getElementById('inspector-content');
    const disciplineHints = buildSignalDisciplineHints(
        cache,
        _installedCachesSnapshot.filter(entry => entry && entry.id !== cache.id),
    );
    if (emptyEl) emptyEl.style.display = 'none';
    if (contentArea) contentArea.style.display = 'flex';
    if (nameEl) nameEl.textContent = cache.title || cache.id;
    if (descEl) {
        descEl.textContent = describeCacheCarrySummary(cache);
    }
    if (metaEl) {
        metaEl.innerHTML = installedCacheMetaBadges(cache);
    }
    if (permsEl) permsEl.innerHTML = '';
    if (contentEl) {
        contentEl.textContent = buildCompactCacheInspectionLines(cache).join('\n');
    }
    if (permsEl) {
        permsEl.innerHTML = '';
        permsEl.appendChild(buildInstalledCacheDistillationActions(cache, disciplineHints));
    }
    syncCacheInspectorSections();
}

async function openInstalledCacheInReader(cache) {
    if (!cache || !cache.firstReaderEntryId) {
        showFlashMessage('No markdown reader entry found for this cache.');
        return;
    }
    try {
        const res = await fetch('/api/archive/reader/document/' + encodeURIComponent(cache.firstReaderEntryId));
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'Could not open cache in reader.');
        getGreenFireReader().open({
            title: data.title || cache.title || cache.id,
            sourcePath: data.sourcePath || cache.source,
            content: data.content || '',
            contentType: data.contentType || 'text/markdown',
            entryId: data.entryId || cache.firstReaderEntryId,
            sourceLabel: data.sourceLabel || 'Archive Cache',
            stripFrontmatter: true,
            rawOnly: false,
            initialRawView: false,
        });
    } catch (error) {
        showFlashMessage(error.message || 'Could not open cache in reader.');
    }
}

function buildInstalledCacheItem(cache) {
    const lineage = extractCacheLineageMetadata(cache);
    const item = document.createElement('div');
    item.className = 'cache-item';
    item.dataset.cacheId = cache.id;
    item.innerHTML =
        '<div class="cache-item-name">' + escapeHtml(cache.title || cache.id) + '</div>' +
        '<div class="cache-item-type">' +
        escapeHtml(describeCacheLevel(cache.level)) + ' · ' +
        escapeHtml(String(cache.status || 'unverified')) + ' · ' +
        escapeHtml(String(cache.documentCount || 0)) + ' docs' +
        '</div>' +
        '<div class="cache-item-carry">' + escapeHtml(describeCacheCarrySummary(cache)) + '</div>';
    item.addEventListener('click', () => inspectInstalledCache(cache, item));

    const actions = document.createElement('div');
    actions.className = 'source-card-actions';

    const loadBtn = document.createElement('button');
    loadBtn.className = 'secondary source-action-btn';
    loadBtn.textContent = cache.loaded ? 'Unload from Loadout' : 'Carry into Forge';
    loadBtn.addEventListener('click', async (event) => {
        event.stopPropagation();
        loadBtn.disabled = true;
        try {
            await setCacheLoadedState(cache.id, !cache.loaded);
            await loadCacheShelf();
            const nextStateLabel = cache.loaded ? 'Removed from Loadout' : 'Carried into Forge';
            showFlashMessage(nextStateLabel + ': ' + (cache.title || cache.id));
        } catch (error) {
            showFlashMessage(error.message || 'Could not update loadout.');
        } finally {
            loadBtn.disabled = false;
        }
    });

    const openBtn = document.createElement('button');
    openBtn.className = 'secondary source-action-btn';
    openBtn.textContent = 'Inspect';
    openBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        inspectInstalledCache(cache, item);
    });

    const openReaderBtn = document.createElement('button');
    openReaderBtn.className = 'secondary source-action-btn';
    openReaderBtn.textContent = 'Open in Reader';
    openReaderBtn.addEventListener('click', async (event) => {
        event.stopPropagation();
        await openInstalledCacheInReader(cache);
    });
    const reviewBtn = document.createElement('button');
    reviewBtn.className = 'secondary source-action-btn';
    reviewBtn.textContent = 'Generate Distillation Recommendation';
    reviewBtn.addEventListener('click', async (event) => {
        event.stopPropagation();
        try {
            await requestDistillationRecommendation({
                title: cache.title || cache.id,
                sourceHint: cache.source || 'archive/cache',
                candidateCaches: [cache.title || cache.id],
                continuityThemes: lineage.continuityThemes,
                peerCaches: _installedCachesSnapshot.filter(entry => entry && entry.id !== cache.id),
                level: cache.level,
                signalDensity: lineage.signalDensity,
                tags: (cache.manifest && cache.manifest.tags) || [],
                archetypes: (cache.manifest && (cache.manifest.archetypes || cache.manifest.preferred_archetypes)) || [],
                documents: Array.isArray(cache.readerEntries) ? cache.readerEntries : [],
            });
        } catch (error) {
            showFlashMessage(error.message || 'Could not generate distillation recommendation.');
        }
    });

    const compareBtn = document.createElement('button');
    compareBtn.className = 'secondary source-action-btn';
    compareBtn.textContent = 'Compare Cache Themes';
    compareBtn.addEventListener('click', event => {
        event.stopPropagation();
        openCouncilChatWithPrompt(
            buildCacheThemeComparisonPrompt({
                id: cache.id,
                title: cache.title,
                source: cache.source,
                candidateCaches: [cache.title || cache.id],
                continuityThemes: lineage.continuityThemes,
            }),
            EMBER_PRIME_MEMBER_ID,
            { distillationGuidance: true },
        );
        showFlashMessage('Theme comparison opened in Council Chat.');
    });

    actions.appendChild(loadBtn);
    actions.appendChild(openBtn);
    actions.appendChild(openReaderBtn);
    actions.appendChild(reviewBtn);
    actions.appendChild(compareBtn);
    item.appendChild(actions);
    return item;
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
    syncCacheInspectorSections();
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
    syncCacheInspectorSections();

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
        _lastInspectedCacheSummary = [
            'Cache: ' + (m.name || data.name || id),
            m.description ? ('Description: ' + m.description) : '',
            m.version ? ('Version: ' + m.version) : '',
            compactTextSnippet(data.content || '', 900),
        ].filter(Boolean).join('\n');
        syncCacheInspectorSections();
    } catch {
        if (contentEl) contentEl.textContent = 'Error loading cache content.';
        syncCacheInspectorSections();
    }
}

const GF_READER_PROGRESS_KEY = 'gf-reader-progress';
// Only show resume prompts once the user has made meaningful progress through a document.
const GF_READER_RESUME_THRESHOLD = 8;
// Ignore tiny documents where scrolling is effectively negligible.
const GF_READER_MIN_SCROLLABLE_HEIGHT = 80;
let _greenFireReader = null;

function stripLeadingFrontmatter(text) {
    if (typeof text !== 'string') return '';
    return text.replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*(\r?\n)?/, '');
}

function loadReaderProgressMap() {
    try {
        const raw = window.localStorage.getItem(GF_READER_PROGRESS_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

function saveReaderProgressMap(map) {
    try {
        window.localStorage.setItem(GF_READER_PROGRESS_KEY, JSON.stringify(map));
    } catch { /* ignore storage failures */ }
}

function getReaderProgress(entryId) {
    if (!entryId) return null;
    const map = loadReaderProgressMap();
    const value = map[entryId];
    if (!value || typeof value !== 'object') return null;
    return value;
}

function persistReaderProgress(entryId, scrollPercent) {
    if (!entryId || !Number.isFinite(scrollPercent)) return;
    if (scrollPercent < 1) return;
    const map = loadReaderProgressMap();
    const current = map[entryId];
    if (
        current &&
        Number.isFinite(current.scrollPercent) &&
        Math.abs(current.scrollPercent - scrollPercent) < 2
    ) {
        return;
    }
    map[entryId] = {
        scrollPercent: Math.max(0, Math.min(100, Math.round(scrollPercent))),
        lastRead: new Date().toISOString(),
    };
    saveReaderProgressMap(map);
}

function sanitizeReaderHref(href) {
    const value = typeof href === 'string' ? href.trim() : '';
    if (!value) return '#';
    if (/^(https?:|mailto:|#)/i.test(value)) return value;
    return '#';
}

function renderInlineMarkdown(input) {
    const text = escapeHtml(input || '');
    const codeTokens = [];
    const tokenized = text.replace(/`([^`]+)`/g, function(_m, code) {
        const token = '__GF_CODE_' + codeTokens.length + '__';
        codeTokens.push('<code>' + code + '</code>');
        return token;
    });
    const linked = tokenized.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function(_m, label, href) {
        const safeHref = escapeHtml(sanitizeReaderHref(href));
        return '<a href="' + safeHref + '" target="_blank" rel="noopener noreferrer">' +
            escapeHtml(label) + '</a>';
    });
    const bolded = linked
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/__([^_]+)__/g, '<strong>$1</strong>');
    const italicized = bolded
        .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
        .replace(/_([^_\n]+)_/g, '<em>$1</em>');
    return codeTokens.reduce(function(out, html, idx) {
        return out.replace('__GF_CODE_' + idx + '__', html);
    }, italicized);
}

function renderMarkdownLightweight(markdown) {
    const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
    const html = [];
    let paragraph = [];
    let inCodeBlock = false;
    let codeLines = [];
    let listType = null;
    let listItems = [];
    let quoteLines = [];

    function flushParagraph() {
        if (!paragraph.length) return;
        html.push('<p>' + renderInlineMarkdown(paragraph.join(' ')) + '</p>');
        paragraph = [];
    }
    function flushList() {
        if (!listItems.length || !listType) return;
        html.push('<' + listType + '>' + listItems.map(item =>
            '<li>' + renderInlineMarkdown(item) + '</li>'
        ).join('') + '</' + listType + '>');
        listType = null;
        listItems = [];
    }
    function flushQuote() {
        if (!quoteLines.length) return;
        html.push('<blockquote>' + quoteLines.map(renderInlineMarkdown).join('<br>') + '</blockquote>');
        quoteLines = [];
    }
    function flushAll() {
        flushParagraph();
        flushList();
        flushQuote();
    }

    lines.forEach(line => {
        if (/^```/.test(line)) {
            flushAll();
            if (!inCodeBlock) {
                inCodeBlock = true;
                codeLines = [];
            } else {
                html.push('<pre><code>' + escapeHtml(codeLines.join('\n')) + '</code></pre>');
                inCodeBlock = false;
                codeLines = [];
            }
            return;
        }
        if (inCodeBlock) {
            codeLines.push(line);
            return;
        }

        if (/^\s*$/.test(line)) {
            flushAll();
            return;
        }

        const hrMatch = /^(\*{3,}|-{3,}|_{3,})\s*$/.test(line.trim());
        if (hrMatch) {
            flushAll();
            html.push('<hr>');
            return;
        }

        const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
        if (headingMatch) {
            flushAll();
            const level = headingMatch[1].length;
            html.push('<h' + level + '>' + renderInlineMarkdown(headingMatch[2].trim()) + '</h' + level + '>');
            return;
        }

        const quoteMatch = line.match(/^>\s?(.*)$/);
        if (quoteMatch) {
            flushParagraph();
            flushList();
            quoteLines.push(quoteMatch[1]);
            return;
        }
        flushQuote();

        const ulMatch = line.match(/^[-*+]\s+(.+)$/);
        if (ulMatch) {
            flushParagraph();
            if (listType && listType !== 'ul') flushList();
            listType = 'ul';
            listItems.push(ulMatch[1]);
            return;
        }

        const olMatch = line.match(/^\d+\.\s+(.+)$/);
        if (olMatch) {
            flushParagraph();
            if (listType && listType !== 'ol') flushList();
            listType = 'ol';
            listItems.push(olMatch[1]);
            return;
        }

        flushList();
        paragraph.push(line.trim());
    });

    if (inCodeBlock) {
        html.push('<pre><code>' + escapeHtml(codeLines.join('\n')) + '</code></pre>');
    }
    flushAll();
    return html.join('\n');
}

function getGreenFireReader() {
    if (_greenFireReader) return _greenFireReader;

    const overlay = document.getElementById('gf-reader-overlay');
    const bodyEl = document.getElementById('gf-reader-body');
    const metadataEl = document.getElementById('gf-reader-metadata');
    const titleEl = document.getElementById('gf-reader-title');
    const sourceEl = document.getElementById('gf-reader-source');
    const toggleBtn = document.getElementById('gf-reader-toggle-btn');
    const copyBtn = document.getElementById('gf-reader-copy-btn');
    const downloadBtn = document.getElementById('gf-reader-download-btn');
    const copyPromptBtn = document.getElementById('gf-reader-copy-prompt-btn');
    const copyContextBtn = document.getElementById('gf-reader-copy-context-btn');
    const saveResponseBtn = document.getElementById('gf-reader-save-response-btn');
    const saveExchangeBtn = document.getElementById('gf-reader-save-exchange-btn');
    const reviewDistillationBtn = document.getElementById('gf-reader-review-distillation-btn');
    const discussCompressionBtn = document.getElementById('gf-reader-discuss-compression-btn');
    const compareThemesBtn = document.getElementById('gf-reader-compare-themes-btn');
    const discussPrimeBtn = document.getElementById('gf-reader-discuss-ember-prime-btn');
    const discussBuilderBtn = document.getElementById('gf-reader-discuss-builder-btn');
    const discussScholarBtn = document.getElementById('gf-reader-discuss-scholar-btn');
    const discussScribeBtn = document.getElementById('gf-reader-discuss-scribe-btn');
    const discussWarriorBtn = document.getElementById('gf-reader-discuss-warrior-btn');
    const discussMysticBtn = document.getElementById('gf-reader-discuss-mystic-btn');
    const backBtn = document.getElementById('gf-reader-back-btn');
    const closeBtn = document.getElementById('gf-reader-close-btn');
    const resumePanel = document.getElementById('gf-reader-resume-panel');
    const resumeBar = document.getElementById('gf-reader-resume');
    const resumeText = document.getElementById('gf-reader-resume-text');
    const resumeBtn = document.getElementById('gf-reader-resume-btn');
    const startBtn = document.getElementById('gf-reader-start-btn');

    const state = {
        title: 'Green Fire Reader',
        sourcePath: '',
        content: '',
        contentType: 'text/markdown',
        entryId: '',
        rawView: false,
        rawOnly: false,
        stripFrontmatter: true,
        backAction: null,
        pendingResumePercent: 0,
        sourceLabel: '',
        handoff: null,
    };

    let scrollSaveTimer = null;

    function readerContextSummary() {
        return [
            'Title: ' + (state.title || 'Green Fire Reader'),
            state.sourceLabel ? ('Source: ' + state.sourceLabel) : '',
            state.sourcePath ? ('Path: ' + state.sourcePath) : '',
            'Content type: ' + (state.contentType || 'text/plain'),
            '',
            'Excerpt:',
            compactTextSnippet(state.content || '', 800) || '(empty)',
        ].filter(Boolean).join('\n');
    }

    function readerDiscussionPrompt() {
        return buildDocumentDiscussionPrompt({
            title: state.title || 'Reader Document',
            source: state.sourceLabel || state.sourcePath || 'Reader',
            content: state.content || '',
        });
    }

    function setResumePrompt(percent) {
        state.pendingResumePercent = percent;
        if (!resumeBar || !resumeText) return;
        if (!Number.isFinite(percent) || percent < GF_READER_RESUME_THRESHOLD) {
            resumeBar.style.display = 'none';
            if (resumePanel) {
                resumePanel.style.display = 'none';
                resumePanel.open = false;
            }
            return;
        }
        resumeText.textContent = 'Resume from ' + Math.round(percent) + '%?';
        resumeBar.style.display = 'flex';
        if (resumePanel) {
            resumePanel.style.display = '';
            resumePanel.open = true;
        }
    }

    function renderBody() {
        if (!bodyEl) return;
        if (metadataEl) {
            const meta = state.handoff && state.handoff.detected ? state.handoff : null;
            if (meta && !state.rawView) {
                metadataEl.style.display = '';
                metadataEl.innerHTML =
                    '<details class="gf-reader-meta-details">' +
                    '<summary>Reader Metadata</summary>' +
                    '<div class="gf-reader-meta-grid">' +
                    '<div class="gf-reader-meta-row"><span class="trace-key">Type</span><span>' + escapeHtml(meta.type || '—') + '</span></div>' +
                    '<div class="gf-reader-meta-row"><span class="trace-key">Status</span><span>' + escapeHtml(meta.status || '—') + '</span></div>' +
                    '<div class="gf-reader-meta-row"><span class="trace-key">Source</span><span>' + escapeHtml(meta.source || '—') + '</span></div>' +
                    '<div class="gf-reader-meta-row"><span class="trace-key">Archetypes</span><span>' + escapeHtml(formatLabelValue(meta.archetypes)) + '</span></div>' +
                    '<div class="gf-reader-meta-row"><span class="trace-key">Tags</span><span>' + escapeHtml(formatLabelValue(meta.tags)) + '</span></div>' +
                    '<div class="gf-reader-meta-row"><span class="trace-key">License</span><span>' + escapeHtml(meta.license || '—') + '</span></div>' +
                    '</div>' +
                    '</details>';
            } else {
                metadataEl.style.display = 'none';
                metadataEl.innerHTML = '';
            }
        }
        if (state.rawView) {
            const pre = document.createElement('pre');
            pre.className = 'gf-reader-raw';
            pre.textContent = state.content;
            bodyEl.innerHTML = '';
            bodyEl.appendChild(pre);
        } else {
            const div = document.createElement('div');
            div.className = 'gf-reader-rendered';
            div.innerHTML = renderMarkdownLightweight(state.content);
            bodyEl.innerHTML = '';
            bodyEl.appendChild(div);
        }
        if (toggleBtn) {
            toggleBtn.style.display = state.rawOnly ? 'none' : '';
            toggleBtn.textContent = state.rawView ? 'Rendered View' : 'Raw Markdown';
        }
        if (copyBtn) {
            copyBtn.textContent = state.contentType === 'text/markdown' ? 'Copy Markdown' : 'Copy Text';
        }
        if (downloadBtn) {
            downloadBtn.textContent = state.contentType === 'text/markdown' ? 'Download .md' : 'Download File';
        }
        bodyEl.scrollTop = 0;
    }

    function close() {
        if (overlay) overlay.style.display = 'none';
    }

    function open(opts) {
        const options = opts || {};
        state.title = options.title || 'Green Fire Reader';
        state.sourcePath = options.sourcePath || '';
        state.stripFrontmatter = options.stripFrontmatter !== false;
        state.content = state.stripFrontmatter
            ? stripLeadingFrontmatter(options.content || '')
            : (options.content || '');
        state.contentType = options.contentType || 'text/markdown';
        state.entryId = options.entryId || '';
        state.backAction = typeof options.backAction === 'function' ? options.backAction : null;
        state.rawOnly = options.rawOnly === true;
        state.rawView = state.rawOnly ? true : options.initialRawView === true;
        state.sourceLabel = options.sourceLabel || '';
        state.handoff = options.handoff || null;

        if (titleEl) titleEl.textContent = state.title;
        if (sourceEl) sourceEl.textContent = state.sourceLabel ? ('Source: ' + state.sourceLabel) : '';
        renderBody();

        const saved = getReaderProgress(state.entryId);
        const savedPercent = saved && Number.isFinite(saved.scrollPercent) ? saved.scrollPercent : 0;
        setResumePrompt(savedPercent);
        if (overlay) overlay.style.display = 'flex';
    }

    function applyResume(percent) {
        if (!bodyEl || !Number.isFinite(percent)) return;
        const maxScroll = bodyEl.scrollHeight - bodyEl.clientHeight;
        if (maxScroll <= 0) return;
        bodyEl.scrollTop = Math.round(maxScroll * Math.max(0, Math.min(100, percent)) / 100);
        setResumePrompt(0);
    }

    if (overlay) {
        overlay.addEventListener('click', e => {
            if (e.target === overlay) close();
        });
    }
    if (closeBtn) closeBtn.addEventListener('click', close);
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            close();
            if (state.backAction) state.backAction();
        });
    }
    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            state.rawView = !state.rawView;
            renderBody();
        });
    }
    if (copyBtn) {
        copyBtn.addEventListener('click', async () => {
            await copyPlainText(state.content || '', 'Markdown copied.', 'Could not copy markdown.');
        });
    }
    if (downloadBtn) {
        downloadBtn.addEventListener('click', () => {
            const safeBase = (state.title || 'green-fire-entry')
                .toLowerCase()
                .replace(/[^a-z0-9._-]+/g, '-')
                .replace(/-+/g, '-')
                .replace(/^-|-$/g, '') || 'green-fire-entry';
            const ext = state.contentType === 'application/json'
                ? '.json'
                : state.contentType === 'text/plain'
                    ? '.txt'
                    : '.md';
            downloadPlainText(safeBase + ext, state.content || '', state.contentType || 'text/plain');
        });
    }
    if (copyPromptBtn) {
        copyPromptBtn.addEventListener('click', async () => {
            const prompt = buildExternalAiPrompt({
                sourceLabel: state.sourceLabel || state.sourcePath || 'Green Fire Reader',
                archetype: getCourtMemberDisplayLabel(getActiveCourtMemberId()),
                focus: readerContextSummary(),
            });
            await copyPlainText(prompt, 'External AI prompt copied.', 'Could not copy prompt.');
        });
    }
    if (copyContextBtn) {
        copyContextBtn.addEventListener('click', async () => {
            await copyPlainText(readerContextSummary(), 'Context summary copied.', 'Could not copy context summary.');
        });
    }
    if (saveResponseBtn) {
        saveResponseBtn.addEventListener('click', () => {
            const filename = toPortableSlug(state.title || 'reader-response', 'reader-response') + '.md';
            const markdown = [
                '# ' + (state.title || 'Reader Response'),
                '',
                state.content || '',
                '',
            ].join('\n');
            downloadPlainText(filename, markdown, 'text/markdown');
            showFlashMessage('Reader markdown saved.');
        });
    }
    if (saveExchangeBtn) {
        saveExchangeBtn.addEventListener('click', () => {
            const markdown = buildConversationFragmentMarkdown({
                title: (state.title || 'Reader Exchange') + ' Handoff',
                source: state.sourceLabel || state.sourcePath || 'green-fire-reader',
                archetype: getCourtMemberDisplayLabel(getActiveCourtMemberId()),
                context: readerContextSummary(),
                userExchange: 'Please analyze and discuss this document context.',
                assistantExchange: compactTextSnippet(state.content || '', 2200),
                reflectionNotes: 'What assumptions in this document need validation?',
                suggestedNextSteps: 'Study: Compare with loaded caches.\nCompression: Distill into a smaller handoff.',
            });
            downloadPlainText(toPortableSlug(state.title || 'reader-exchange', 'reader-exchange') + '-handoff.md', markdown, 'text/markdown');
            showFlashMessage('Reader exchange handoff saved.');
        });
    }
    if (reviewDistillationBtn) {
        reviewDistillationBtn.addEventListener('click', async () => {
            try {
                await requestDistillationRecommendation({
                    title: state.title || 'Reader Context',
                    sourceHint: state.sourceLabel || state.sourcePath || 'Green Fire Reader',
                    candidateCaches: [state.title || 'Reader Context'],
                    continuityThemes: [],
                    documents: [state.title || 'Reader Context'],
                });
            } catch (error) {
                showFlashMessage(error.message || 'Could not generate distillation recommendation.');
            }
        });
    }
    if (discussCompressionBtn) {
        discussCompressionBtn.addEventListener('click', () => {
            openCouncilChatWithPrompt(
                buildCacheCompressionPrompt({
                    title: state.title || 'Reader Context',
                    source: state.sourceLabel || state.sourcePath || 'Green Fire Reader',
                    continuityThemes: [],
                }),
                EMBER_PRIME_MEMBER_ID,
                { distillationGuidance: true },
            );
            showFlashMessage('Compression discussion opened in Council Chat.');
        });
    }
    if (compareThemesBtn) {
        compareThemesBtn.addEventListener('click', () => {
            openCouncilChatWithPrompt(
                buildCacheThemeComparisonPrompt({
                    title: state.title || 'Reader Context',
                    source: state.sourceLabel || state.sourcePath || 'Green Fire Reader',
                    candidateCaches: [state.title || 'Reader Context'],
                    continuityThemes: [],
                }),
                EMBER_PRIME_MEMBER_ID,
                { distillationGuidance: true },
            );
            showFlashMessage('Theme comparison opened in Council Chat.');
        });
    }
    const readerDiscussButtons = [
        [discussPrimeBtn, EMBER_PRIME_MEMBER_ID],
        [discussBuilderBtn, 'builder'],
        [discussScholarBtn, 'scholar'],
        [discussScribeBtn, 'scribe'],
        [discussWarriorBtn, 'warrior'],
        [discussMysticBtn, 'mystic'],
    ];
    readerDiscussButtons.forEach(([button, memberId]) => {
        if (!button) return;
        button.addEventListener('click', () => {
            openCouncilChatWithPrompt(readerDiscussionPrompt(), memberId);
            showFlashMessage('Document context opened in Council Chat.');
        });
    });
    if (resumeBtn) {
        resumeBtn.addEventListener('click', () => applyResume(state.pendingResumePercent));
    }
    if (startBtn) {
        startBtn.addEventListener('click', () => {
            if (bodyEl) bodyEl.scrollTop = 0;
            setResumePrompt(0);
        });
    }
    if (bodyEl) {
        bodyEl.addEventListener('scroll', () => {
            if (!state.entryId) return;
            clearTimeout(scrollSaveTimer);
            scrollSaveTimer = setTimeout(() => {
                const maxScroll = bodyEl.scrollHeight - bodyEl.clientHeight;
                if (maxScroll <= GF_READER_MIN_SCROLLABLE_HEIGHT) return;
                const percent = (bodyEl.scrollTop / maxScroll) * 100;
                persistReaderProgress(state.entryId, percent);
            }, 450);
        });
    }

    _greenFireReader = {
        open,
        close,
        getState: function() { return { ...state }; },
        buildDiscussionPrompt: readerDiscussionPrompt,
    };
    return _greenFireReader;
}

async function openArchiveReaderEntry(entry) {
    if (!entry || !entry.entryId) return;
    try {
        const res = await fetch('/api/archive/reader/document/' + encodeURIComponent(entry.entryId));
        const data = await res.json();
        if (!res.ok || !data.success) {
            showFlashMessage(data.error || 'Could not open markdown entry.');
            return;
        }
        getGreenFireReader().open({
            title: data.title || entry.title || 'Green Fire Reader',
            sourcePath: data.sourcePath || entry.sourcePath || '',
            content: data.content || '',
            contentType: data.contentType || 'text/markdown',
            entryId: data.entryId || entry.entryId,
            sourceLabel: data.sourceLabel || entry.sourceLabel || 'Archive Cache',
            stripFrontmatter: true,
        });
    } catch {
        showFlashMessage('Could not open markdown entry.');
    }
}

function buildArchiveReaderFileButton(entry) {
    const btn = document.createElement('button');
    btn.className = 'archive-reader-file';
    btn.innerHTML = escapeHtml(entry.title || entry.relativePath || 'entry') +
        '<span class="archive-reader-file-path">' + escapeHtml(entry.relativePath || '') + '</span>' +
        (entry.abstract && Array.isArray(entry.abstract.themes) && entry.abstract.themes.length > 0
            ? '<span class="archive-reader-file-path">Themes: ' + escapeHtml(entry.abstract.themes.slice(0, 3).join(', ')) + '</span>'
            : '') +
        (entry.abstract && Array.isArray(entry.abstract.preferred_archetypes) && entry.abstract.preferred_archetypes.length > 0
            ? '<span class="archive-reader-file-path">Preferred archetypes: ' + escapeHtml(entry.abstract.preferred_archetypes.slice(0, 3).join(', ')) + '</span>'
            : '');
    btn.addEventListener('click', () => openArchiveReaderEntry(entry));
    return btn;
}

async function loadArchiveReaderCatalog() {
    const listEl = document.getElementById('archive-reader-catalog');
    if (!listEl) return;
    listEl.innerHTML = '<span class="message-system">Loading archive markdown…</span>';
    try {
        const res = await fetch('/api/archive/reader/catalog');
        const data = await res.json();
        if (!res.ok || !data.success) {
            listEl.innerHTML = '<span class="message-system">Could not load archive markdown.</span>';
            return;
        }

        const roots = Array.isArray(data.roots) ? data.roots : [];
        const coreRoot = roots.find(r => r && r.id === 'archive-core') || { files: [] };
        const cachesRoot = roots.find(r => r && r.id === 'archive-caches') || { caches: [] };
        const coreFiles = Array.isArray(coreRoot.files) ? coreRoot.files : [];
        const cacheGroups = Array.isArray(cachesRoot.caches) ? cachesRoot.caches : [];

        if (
            coreFiles.length === 0 &&
            (cacheGroups.length === 0 || cacheGroups.every(group => !group.files || group.files.length === 0))
        ) {
            listEl.innerHTML = '<span class="message-system">No archive markdown is ready in Reader yet.</span>';
            const hint = buildOnboardingHint({
                key: 'archive-reader-empty',
                text: 'Loaded Caches shape the continuity available to the Node. Inspect, load, then explore in Reader.',
                actions: [
                    { label: 'Load into Cache Loadout', onClick: () => openRoomAndSubtab('threshold', 'th-imports') },
                    { label: 'Guided Orientation', onClick: openFirstEmberOverlay },
                ],
            });
            if (hint) listEl.appendChild(hint);
            return;
        }

        listEl.innerHTML = '';

        const coreTitle = document.createElement('div');
        coreTitle.className = 'archive-reader-group-title';
        coreTitle.textContent = 'archive/core';
        listEl.appendChild(coreTitle);
        if (coreFiles.length === 0) {
            const none = document.createElement('span');
            none.className = 'message-system';
            none.textContent = 'No core markdown files.';
            listEl.appendChild(none);
        } else {
            coreFiles.forEach(entry => listEl.appendChild(buildArchiveReaderFileButton(entry)));
        }

        const cacheTitle = document.createElement('div');
        cacheTitle.className = 'archive-reader-group-title';
        cacheTitle.textContent = 'archive/caches';
        listEl.appendChild(cacheTitle);

        if (cacheGroups.length === 0) {
            const none = document.createElement('span');
            none.className = 'message-system';
            none.textContent = 'No installed archive caches.';
            listEl.appendChild(none);
            return;
        }

        cacheGroups.forEach(group => {
            const details = document.createElement('details');
            details.className = 'archive-reader-cache';
            const summary = document.createElement('summary');
            const fileCount = Array.isArray(group.files) ? group.files.length : 0;
            summary.textContent = (group.title || group.cacheId || 'cache') + ' (' + fileCount + ')';
            details.appendChild(summary);
            if (group.abstract && Array.isArray(group.abstract.themes) && group.abstract.themes.length > 0) {
                const abstract = document.createElement('div');
                abstract.className = 'archive-reader-file-path';
                abstract.textContent = 'Themes: ' + group.abstract.themes.slice(0, 3).join(', ');
                details.appendChild(abstract);
            }
            if (group.abstract && Array.isArray(group.abstract.preferred_archetypes) && group.abstract.preferred_archetypes.length > 0) {
                const abstractArchetypes = document.createElement('div');
                abstractArchetypes.className = 'archive-reader-file-path';
                abstractArchetypes.textContent = 'Preferred archetypes: ' + group.abstract.preferred_archetypes.slice(0, 3).join(', ');
                details.appendChild(abstractArchetypes);
            }

            const filesWrap = document.createElement('div');
            filesWrap.className = 'archive-reader-files';
            if (fileCount === 0) {
                const none = document.createElement('span');
                none.className = 'message-system';
                none.textContent = 'No markdown files in this cache.';
                filesWrap.appendChild(none);
            } else {
                group.files.forEach(entry => filesWrap.appendChild(buildArchiveReaderFileButton(entry)));
            }
            details.appendChild(filesWrap);
            listEl.appendChild(details);
        });
    } catch {
        listEl.innerHTML = '<span class="message-system">Could not load archive markdown.</span>';
    }
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

// Keep this list aligned with THRESHOLD_IMPORT_EXTS in app/routes/threshold.js.
const INTAKE_SUPPORTED = new Set(['.txt', '.md', '.json', '.pdf']);

/** Derive a readable title from a filename. */
function fileBaseName(name) {
    const parts = name.split('.');
    const base  = parts.length > 1 && parts[0] !== '' ? parts.slice(0, -1).join('.') : name;
    return base.replace(/[_-]+/g, ' ').trim();
}

/** POST a single queue entry to /api/threshold/import. Updates entry.status in place. */
async function ingestQueueEntry(entry) {
    entry.status = 'importing';
    renderIntakeQueue();

    try {
        const form = new FormData();
        form.append('files', entry.file, entry.file.name);
        const res  = await fetch('/api/threshold/import', {
            method:  'POST',
            body:    form,
        });
        const data = await res.json();
        if (res.ok && Array.isArray(data.imported) && data.imported.length > 0) {
            entry.status = 'imported';
            entry.error  = null;
        } else {
            entry.status = 'failed';
            entry.error  = data.error || 'Import failed';
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

    const total    = _intakeQueue.length;
    const imported = _intakeQueue.filter(e => e.status === 'imported').length;
    const failed   = _intakeQueue.filter(e => e.status === 'failed').length;
    const active   = _intakeQueue.filter(e => e.status === 'importing').length;

    if (progressEl) {
        if (active > 0) {
            progressEl.textContent = (imported + failed) + ' of ' + total + ' processing…';
        } else if (total > 0 && imported + failed === total) {
            const msg = failed > 0
                ? imported + ' imported, ' + failed + ' failed'
                : imported + ' imported';
            progressEl.textContent = msg;
        } else {
            progressEl.textContent = total + ' file' + (total === 1 ? '' : 's') + ' queued';
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

        if (entry.status === 'pending') {
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
        if (['pending', 'failed', 'imported'].includes(entry.status) && !_importingAll) {
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

function renderThresholdPromptGuides() {
    const listEl = document.getElementById('th-handoff-prompt-guides');
    if (!listEl) return;
    listEl.innerHTML = '';

    GREEN_FIRE_PROMPT_GUIDES.forEach(guide => {
        const row = document.createElement('div');
        row.className = 'threshold-file-row';

        const metaEl = document.createElement('div');
        metaEl.className = 'threshold-file-meta';
        metaEl.innerHTML =
            '<div class="threshold-file-title-row"><span class="threshold-file-icon">ᚲ</span><span class="threshold-file-title">' +
            escapeHtml(guide.label) + '</span></div>' +
            '<div class="threshold-file-detail">Outputs a complete Green Fire Markdown Handoff file.</div>' +
            '<div class="threshold-file-detail">Download: ' + escapeHtml(guide.filename) + '</div>';

        const statusEl = document.createElement('span');
        statusEl.className = 'threshold-file-state';
        statusEl.textContent = 'Prompt ready';

        const actions = document.createElement('div');
        actions.className = 'threshold-file-actions';

        const copyBtn = document.createElement('button');
        copyBtn.className = 'secondary threshold-action-btn';
        copyBtn.textContent = 'Copy Prompt';
        copyBtn.addEventListener('click', async () => {
            const prompt = buildGreenFireHandoffPrompt(guide.archetype);
            await copyPlainText(prompt, 'Prompt copied.', 'Could not copy prompt.');
        });

        const downloadBtn = document.createElement('button');
        downloadBtn.className = 'secondary threshold-action-btn';
        downloadBtn.textContent = 'Download Prompt .md';
        downloadBtn.addEventListener('click', () => {
            const prompt = buildGreenFireHandoffPrompt(guide.archetype);
            downloadPlainText(guide.filename, prompt, 'text/markdown');
        });

        actions.appendChild(copyBtn);
        actions.appendChild(downloadBtn);

        row.appendChild(metaEl);
        row.appendChild(statusEl);
        row.appendChild(actions);
        listEl.appendChild(row);
    });
}

function ensureMarkdownHandoffFromInput(rawInput, titleHint = 'External AI Response') {
    const input = String(rawInput || '').trim();
    if (!input) return '';
    const normalized = input.replace(/\r\n/g, '\n');
    const hasFrontmatter = normalized.startsWith('---\n') && normalized.indexOf('\n---\n', 4) > 0;
    if (hasFrontmatter) return input;
    const today = new Date().toISOString().slice(0, 10);
    return [
        '---',
        'title: ' + titleHint,
        'type: research-brief',
        'source: external-ai',
        'created: ' + today,
        'status: unverified',
        'archetypes: ember-prime',
        'tags: external-ai, handoff',
        'license: unknown',
        '---',
        '# Summary',
        input,
        '',
        '# Key Knowledge',
        '-',
        '',
        '# Practical Use',
        '-',
        '',
        '# Risks / Unknowns',
        '-',
        '',
        '# Suggested Cache Placement',
        '-',
        '',
        '# Sources',
        '- external-ai-copy-paste',
        '',
    ].join('\n');
}

function getExternalAiInputText() {
    const inputEl = document.getElementById('th-external-ai-response-input');
    return inputEl ? String(inputEl.value || '').trim() : '';
}

function clearExternalAiInput() {
    const inputEl = document.getElementById('th-external-ai-response-input');
    if (inputEl) inputEl.value = '';
}

async function saveExternalAiResponseAsHandoff() {
    const raw = getExternalAiInputText();
    if (!raw) {
        showFlashMessage('Paste external response text first.');
        return;
    }
    const markdown = ensureMarkdownHandoffFromInput(raw, 'External AI Response');
    try {
        await saveMarkdownToThresholdInbox(markdown, 'external-ai-response.md', 'Saved to threshold/inbox/');
        markSentinelTrialStep('transmission_trial', 'external_response_saved');
        markSentinelTrialStep('scribe_structuring', 'handoff_saved');
    } catch (error) {
        showFlashMessage(error.message || 'Could not save external response.');
    }
}

async function addExternalAiResponseToCacheDraft() {
    const raw = getExternalAiInputText();
    if (!raw) {
        showFlashMessage('Paste external response text first.');
        return;
    }
    const payload = {
        markdown: ensureMarkdownHandoffFromInput(raw, 'External AI Response'),
        markdownFilename: 'external-ai-response.md',
    };
    if (_activeThresholdDraftId) payload.draftId = _activeThresholdDraftId;
    try {
        const res = await fetch('/api/threshold/cache-drafts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'Could not add to cache draft.');
        await loadThresholdCacheDrafts();
        await openThresholdCacheDraft(data.draft.id);
        _activeThresholdDraftId = data.draft.id;
        showFlashMessage('External response added to cache draft.');
        markSentinelTrialStep('transmission_trial', 'external_response_added_to_draft');
        markSentinelTrialStep('scribe_structuring', 'cache_draft_created');
    } catch (error) {
        showFlashMessage(error.message || 'Could not add to cache draft.');
    }
}

function discussExternalAiResponseWithCouncil() {
    const raw = getExternalAiInputText();
    if (!raw) {
        showFlashMessage('Paste external response text first.');
        return;
    }
    const prompt = [
        'Discuss this pasted external AI response with me:',
        '',
        compactTextSnippet(raw, 1400),
        '',
        'Please highlight assumptions, verification points, and practical next steps.',
    ].join('\n');
    openCouncilChatWithPrompt(prompt, getActiveCourtMemberId() || EMBER_PRIME_MEMBER_ID);
}

async function buildExternalPromptFromSelectedSource(sourceId) {
    const source = String(sourceId || '').trim().toLowerCase();
    if (!EXTERNAL_PROMPT_SOURCE_IDS.includes(source)) {
        return buildExternalAiPrompt({});
    }
    if (source === 'discussion') {
        const latest = _lastDiscussionExchange;
        return buildExternalAiPrompt({
            sourceLabel: 'Current discussion',
            focus: latest
                ? buildExchangeContextSummary({
                    room: latest.room,
                    user: latest.user,
                    assistant: latest.assistant,
                })
                : 'No completed exchange yet.',
        });
    }
    if (source === 'reader-document') {
        const reader = getGreenFireReader();
        const state = reader && typeof reader.getState === 'function' ? reader.getState() : null;
        return buildExternalAiPrompt({
            sourceLabel: 'Reader document',
            focus: state
                ? [
                    'Title: ' + (state.title || 'Reader Document'),
                    'Path: ' + (state.sourcePath || ''),
                    '',
                    compactTextSnippet(state.content || '', 1200),
                ].join('\n')
                : 'Reader is not active.',
        });
    }
    if (source === 'selected-cache') {
        return buildExternalAiPrompt({
            sourceLabel: 'Selected cache',
            focus: _lastInspectedCacheSummary || 'No cache selected in Ember Council → Caches.',
        });
    }
    if (source === 'cache-loadout') {
        try {
            const res = await fetch('/api/caches/loaded');
            const data = await res.json().catch(() => ({}));
            const loaded = Array.isArray(data.loaded) ? data.loaded : [];
            const names = loaded
                .map(entry => String(entry.title || entry.name || entry.id || '').trim())
                .filter(Boolean);
            return buildExternalAiPrompt({
                sourceLabel: 'Cache loadout',
                cacheLoadout: names,
                focus: names.length > 0
                    ? ('Loaded caches: ' + names.join(', '))
                    : 'No caches are currently loaded.',
            });
        } catch {
            return buildExternalAiPrompt({
                sourceLabel: 'Cache loadout',
                focus: 'Could not load cache loadout state.',
            });
        }
    }
    if (source === 'active-archetype') {
        const member = getCourtMemberDisplayLabel(getActiveCourtMemberId());
        return buildExternalAiPrompt({
            sourceLabel: 'Active archetype',
            archetype: member,
            focus: 'Generate output tuned to the active archetype: ' + member + '.',
        });
    }
    return buildExternalAiPrompt({});
}

async function generateThresholdExternalPrompt() {
    const sourceSelect = document.getElementById('th-external-prompt-source');
    const output = document.getElementById('th-external-prompt-output');
    const sourceId = sourceSelect ? sourceSelect.value : 'discussion';
    const prompt = await buildExternalPromptFromSelectedSource(sourceId);
    if (output) output.value = prompt;
}

(function initThreshold() {
    const dropZone      = document.getElementById('threshold-drop-zone');
    const fileInput     = document.getElementById('threshold-file-input');
    const importAllBtn  = document.getElementById('threshold-import-all-btn');
    const clearQueueBtn = document.getElementById('threshold-clear-queue-btn');
    const createDraftSelectedBtn = document.getElementById('threshold-create-draft-selected-btn');
    const addSelectedToDraftBtn = document.getElementById('threshold-add-draft-selected-btn');
    const closeDraftViewBtn = document.getElementById('threshold-cache-draft-close-btn');
    const copyTemplateBtn = document.getElementById('th-handoff-copy-template-btn');
    const downloadTemplateBtn = document.getElementById('th-handoff-download-template-btn');
    const openTemplateBtn = document.getElementById('th-handoff-open-template-btn');
    const saveExternalBtn = document.getElementById('th-external-save-btn');
    const addExternalToDraftBtn = document.getElementById('th-external-add-to-draft-btn');
    const discussExternalBtn = document.getElementById('th-external-discuss-btn');
    const externalPromptGenerateBtn = document.getElementById('th-external-prompt-generate-btn');
    const externalPromptCopyBtn = document.getElementById('th-external-prompt-copy-btn');
    const externalPromptDownloadBtn = document.getElementById('th-external-prompt-download-btn');

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

    if (createDraftSelectedBtn) {
        createDraftSelectedBtn.addEventListener('click', createCacheDraftFromSelectedThresholdFiles);
    }
    if (addSelectedToDraftBtn) {
        addSelectedToDraftBtn.addEventListener('click', addSelectedThresholdFilesToDraft);
    }
    if (closeDraftViewBtn) {
        closeDraftViewBtn.addEventListener('click', () => {
            _activeThresholdDraftId = null;
            renderThresholdCacheDraftDetail(null);
        });
    }

    if (copyTemplateBtn) {
        copyTemplateBtn.addEventListener('click', async () => {
            await copyPlainText(
                GREEN_FIRE_HANDOFF_TEMPLATE,
                'Handoff template copied.',
                'Could not copy template.',
            );
        });
    }

    if (downloadTemplateBtn) {
        downloadTemplateBtn.addEventListener('click', () => {
            downloadPlainText('green-fire-markdown-handoff-template.md', GREEN_FIRE_HANDOFF_TEMPLATE, 'text/markdown');
        });
    }

    if (openTemplateBtn) {
        openTemplateBtn.addEventListener('click', () => {
            getGreenFireReader().open({
                title: 'Blank Green Fire Handoff',
                sourcePath: 'threshold/template',
                content: GREEN_FIRE_HANDOFF_TEMPLATE,
                contentType: 'text/markdown',
                entryId: 'threshold:template:green-fire-handoff',
                sourceLabel: 'Threshold',
                stripFrontmatter: false,
                rawOnly: false,
                initialRawView: true,
                handoff: {
                    detected: true,
                    type: null,
                    status: null,
                    source: null,
                    archetypes: [],
                    tags: [],
                    license: null,
                },
            });
        });
    }

    if (saveExternalBtn) {
        saveExternalBtn.addEventListener('click', saveExternalAiResponseAsHandoff);
    }
    if (addExternalToDraftBtn) {
        addExternalToDraftBtn.addEventListener('click', addExternalAiResponseToCacheDraft);
    }
    if (discussExternalBtn) {
        discussExternalBtn.addEventListener('click', discussExternalAiResponseWithCouncil);
    }
    if (externalPromptGenerateBtn) {
        externalPromptGenerateBtn.addEventListener('click', generateThresholdExternalPrompt);
    }
    if (externalPromptCopyBtn) {
        externalPromptCopyBtn.addEventListener('click', async () => {
            const output = document.getElementById('th-external-prompt-output');
            await copyPlainText(
                output ? output.value : '',
                'Prompt bridge copied.',
                'Could not copy prompt bridge.',
            );
            const text = output ? String(output.value || '').trim() : '';
            if (text) markSentinelTrialStep('transmission_trial', 'prompt_bridge_exported');
        });
    }
    if (externalPromptDownloadBtn) {
        externalPromptDownloadBtn.addEventListener('click', () => {
            const output = document.getElementById('th-external-prompt-output');
            downloadPlainText('external-ai-prompt-bridge.md', output ? output.value : '', 'text/markdown');
            showFlashMessage('Prompt bridge downloaded.');
            const text = output ? String(output.value || '').trim() : '';
            if (text) markSentinelTrialStep('transmission_trial', 'prompt_bridge_exported');
        });
    }

    renderThresholdPromptGuides();
    renderThresholdGatewayGuidance();
    generateThresholdExternalPrompt();
    loadThresholdCacheDrafts();
})();

let _thresholdImportedFiles = [];
let _selectedThresholdPaths = new Set();
let _thresholdCacheDrafts = [];
let _activeThresholdDraftId = null;
let _installedCachesSnapshot = [];
const THRESHOLD_DRAFT_ALLOWED_LABEL = '.md/.txt/.json';

function isThresholdDraftSelectableFile(file) {
    const kind = String(file?.type || '').toLowerCase();
    return kind === 'markdown' || kind === 'text' || kind === 'json';
}

function selectedThresholdDraftFiles(files) {
    const available = Array.isArray(files) ? files : [];
    return available.filter(file => isThresholdDraftSelectableFile(file) && _selectedThresholdPaths.has(file.path));
}

function refreshThresholdSelectionActions(files) {
    const actionsEl = document.getElementById('threshold-selection-actions');
    const countEl = document.getElementById('threshold-selection-count');
    const createBtn = document.getElementById('threshold-create-draft-selected-btn');
    const addBtn = document.getElementById('threshold-add-draft-selected-btn');
    const selected = selectedThresholdDraftFiles(files);
    const count = selected.length;
    if (countEl) {
        countEl.textContent = count + ' selected (' + THRESHOLD_DRAFT_ALLOWED_LABEL + ')';
    }
    if (createBtn) createBtn.disabled = count === 0;
    if (addBtn) addBtn.disabled = count === 0;
    if (actionsEl) {
        actionsEl.style.display = files.some(isThresholdDraftSelectableFile) ? '' : 'none';
    }
}

async function loadThresholdList() {
    const listEl = document.getElementById('threshold-file-list');
    if (!listEl) return;
    try {
        const listRes = await fetch('/api/threshold/files');
        const listData = await listRes.json();
        const files = listData.files || [];
        if (!listRes.ok) throw new Error(listData.error || 'Could not load Threshold files.');
        _thresholdImportedFiles = files;
        const availablePaths = new Set(files.filter(isThresholdDraftSelectableFile).map(file => file.path));
        _selectedThresholdPaths = new Set([..._selectedThresholdPaths].filter(path => availablePaths.has(path)));
        refreshThresholdSelectionActions(files);

        if (files.length === 0) {
            listEl.innerHTML = '<span class="message-system">No continuity artifacts have crossed Threshold yet.</span>';
            const hint = buildOnboardingHint({
                key: 'first-cache-threshold',
                text: 'Threshold allows Sentinels to acquire and inspect continuity artifacts before carrying them into the Forge.',
                actions: [
                    {
                        label: 'Load into Cache Loadout',
                        onClick: () => openRoomAndSubtab('council', 'ws-caches'),
                    },
                    { label: 'Start Here · First Ember', onClick: openFirstEmberOverlay },
                ],
            });
            if (hint) listEl.appendChild(hint);
            return;
        }

        listEl.innerHTML = '';
        files.forEach(file => listEl.appendChild(buildThresholdImportedRow(file)));
    } catch {
        listEl.innerHTML = '<span class="message-system threshold-error">Could not load Threshold files.</span>';
        _thresholdImportedFiles = [];
        _selectedThresholdPaths = new Set();
        refreshThresholdSelectionActions([]);
    }
}

function thresholdTypeIcon(type) {
    if (type === 'markdown') return 'ᚲ';
    if (type === 'text') return 'ᚱ';
    if (type === 'json') return 'ᚾ';
    if (type === 'pdf') return 'ᚠ';
    return 'ᚦ';
}

function formatRelativeTime(isoString) {
    const value = new Date(isoString || '');
    const diffMs = Date.now() - value.getTime();
    if (!Number.isFinite(diffMs)) return 'just now';
    const minutes = Math.max(1, Math.floor(diffMs / 60000));
    if (minutes < 60) return minutes + ' minute' + (minutes === 1 ? '' : 's') + ' ago';
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + ' hour' + (hours === 1 ? '' : 's') + ' ago';
    const days = Math.floor(hours / 24);
    return days + ' day' + (days === 1 ? '' : 's') + ' ago';
}

function thresholdStatusLabel(file) {
    if (file && file.sentinelLoadoutDetected) {
        return 'Sentinel Loadout Bootstrap detected';
    }
    if (file && file.bootstrapDetected) {
        return 'Bootstrap detected';
    }
    if (file.type === 'markdown' && file.handoff && file.handoff.detected) {
        return 'Handoff detected';
    }
    return file.type === 'pdf'
        ? 'PDF stored — support pending'
        : 'Ready in Reader';
}

async function useThresholdBootstrap(file) {
    if (!file || !file.path) return;
    const overwrite = window.confirm(
        'Use this file as Active Bootstrap?\n\nPress OK to overwrite an existing summary. Press Cancel to send a no-overwrite import request (the server may reject it if summary confirmation is required).',
    );
    try {
        const res = await fetch('/api/threshold/bootstrap/use', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: file.path, overwrite }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
            throw new Error(data.error || 'Bootstrap import failed.');
        }
        showFlashMessage(file.sentinelLoadoutDetected
            ? 'Sentinel Loadout Bootstrap imported.'
            : 'Bootstrap imported.');
        if (typeof loadBootstrapStatus === 'function') loadBootstrapStatus();
        if (typeof loadLoadoutForgePanel === 'function') loadLoadoutForgePanel();
    } catch (error) {
        showFlashMessage(error.message || 'Bootstrap import failed.');
    }
}

async function discussThresholdBootstrap(file) {
    if (!file || !file.path) return;
    const MAX_BOOTSTRAP_DISCUSSION_CHARS = 1200;
    const GENERIC_BOOTSTRAP_DISCUSSION_PROMPT_PREFIX = 'Review this bootstrap and discuss how to apply it as active continuity posture:';
    const SENTINEL_BOOTSTRAP_DISCUSSION_PROMPT_PREFIX = 'Review this Sentinel Loadout Bootstrap and discuss how to apply it as active continuity posture:';
    try {
        const res = await fetch('/api/threshold/files/content?path=' + encodeURIComponent(file.path));
        const data = await res.json();
        if (!res.ok || !data.success) {
            throw new Error(data.error || 'Could not load bootstrap content.');
        }
        const hearthTab = document.querySelector('.room-tab[data-room="hearth"]');
        if (hearthTab) hearthTab.click();
        const messageInput = document.getElementById('message-input');
        if (!messageInput) return;
        const excerpt = String(data.content || '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, MAX_BOOTSTRAP_DISCUSSION_CHARS);
        const promptPrefix = file.sentinelLoadoutDetected
            ? SENTINEL_BOOTSTRAP_DISCUSSION_PROMPT_PREFIX
            : GENERIC_BOOTSTRAP_DISCUSSION_PROMPT_PREFIX;
        messageInput.value = promptPrefix + '\n\n' + excerpt;
        messageInput.focus();
        showFlashMessage('Bootstrap loaded into Hearth input for discussion.');
    } catch (error) {
        showFlashMessage(error.message || 'Could not prepare bootstrap discussion.');
    }
}

async function openThresholdImportedFile(file) {
    if (!file || !file.path) return;
    if (file.type === 'pdf') {
        getGreenFireReader().open({
            title: file.name || 'PDF file',
            sourcePath: file.path,
            content: 'PDF support is not yet active.\nThe file is safely stored in Threshold.',
            contentType: 'text/plain',
            entryId: 'threshold:' + file.path,
            sourceLabel: file.sourceLabel || 'Threshold',
            rawOnly: true,
            initialRawView: true,
        });
        return;
    }
    try {
        const res = await fetch('/api/threshold/files/content?path=' + encodeURIComponent(file.path));
        const data = await res.json();
        if (!res.ok || !data.success) {
            const errorText = String(data.error || '');
            if (/unsupported/i.test(errorText)) {
                showFlashMessage('This file type is not yet readable within the Node.');
            } else {
                showFlashMessage(data.error || 'The signal could not be resolved.');
            }
            return;
        }
        const isMarkdown = data.contentType === 'text/markdown';
        getGreenFireReader().open({
            title: data.title || file.name || 'Green Fire Reader',
            sourcePath: data.path || file.path,
            content: data.content || '',
            contentType: data.contentType || 'text/plain',
            entryId: 'threshold:' + (data.path || file.path),
            sourceLabel: data.sourceLabel || 'Threshold',
            handoff: data.handoff || file.handoff || null,
            stripFrontmatter: isMarkdown,
            rawOnly: !isMarkdown,
            initialRawView: !isMarkdown,
        });
    } catch {
        showFlashMessage('The signal could not be resolved.');
    }
}

async function copyThresholdPath(pathText) {
    await copyPlainText(pathText || '', 'Path copied.', 'Could not copy path.');
}

async function deleteThresholdImportedFile(file) {
    if (!file || !file.path) return;
    const ok = window.confirm('Delete "' + (file.name || file.path) + '" from Threshold inbox?');
    if (!ok) return;
    try {
        const res = await fetch('/api/threshold/files', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: file.path }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
            showFlashMessage(data.error || 'Delete failed.');
            return;
        }
        showFlashMessage('File deleted.');
        loadThresholdList();
    } catch {
        showFlashMessage('Could not delete file.');
    }
}

function buildThresholdImportedRow(file) {
    const row = document.createElement('div');
    row.className = 'threshold-file-row';

    const type = (file.type || 'unknown').toLowerCase();
    const extension = file.extension || ((file.name || '').split('.').pop() || type);
    const displayName = file.name || 'unknown';
    const title = file.title || file.name || 'unknown';

    const metaEl = document.createElement('div');
    metaEl.className = 'threshold-file-meta';
    metaEl.innerHTML =
        '<div class="threshold-file-title-row"><span class="threshold-file-icon">' + escapeHtml(thresholdTypeIcon(type)) +
        '</span><span class="threshold-file-title">' + escapeHtml(title) + '</span><span class="threshold-file-extension">.' +
        escapeHtml(String(extension).replace(/^\./, '')) + '</span></div>' +
        '<div class="threshold-file-name">' + escapeHtml(displayName) + '</div>' +
        '<div class="threshold-file-detail">' + escapeHtml((file.type || 'unknown').toUpperCase()) + ' • ' +
        escapeHtml(formatBytes(file.size)) + '</div>' +
        '<div class="threshold-file-detail">Imported ' + escapeHtml(formatRelativeTime(file.imported_at)) + '</div>' +
        '<div class="threshold-file-detail">Source: ' + escapeHtml(file.sourceLabel || 'Threshold') + '</div>';

    if (isThresholdDraftSelectableFile(file)) {
        const ariaName = String(file.name || file.path || 'file').replace(/\s+/g, ' ').trim().slice(0, 80);
        const selectorWrap = document.createElement('label');
        selectorWrap.className = 'threshold-file-selector';
        const selector = document.createElement('input');
        selector.type = 'checkbox';
        selector.checked = _selectedThresholdPaths.has(file.path);
        selector.setAttribute('aria-label', 'Select ' + ariaName + ' for cache draft');
        selector.addEventListener('change', () => {
            if (selector.checked) _selectedThresholdPaths.add(file.path);
            else _selectedThresholdPaths.delete(file.path);
            refreshThresholdSelectionActions(_thresholdImportedFiles);
        });
        const label = document.createElement('span');
        label.textContent = 'Select for Draft';
        selectorWrap.appendChild(selector);
        selectorWrap.appendChild(label);
        metaEl.appendChild(selectorWrap);
    }

    if (type === 'markdown') {
        const handoff = file.handoff || {};

        const handoffEl = document.createElement('div');
        handoffEl.className = 'threshold-file-detail';
        handoffEl.textContent = 'Handoff: ' + (handoff.detected ? 'detected' : 'not detected');
        metaEl.appendChild(handoffEl);

        const handoffTypeEl = document.createElement('div');
        handoffTypeEl.className = 'threshold-file-detail';
        handoffTypeEl.textContent = 'Type: ' + formatLabelValue(handoff.type);
        metaEl.appendChild(handoffTypeEl);

        const handoffStatusEl = document.createElement('div');
        handoffStatusEl.className = 'threshold-file-detail';
        handoffStatusEl.textContent = 'Status: ' + formatLabelValue(handoff.status);
        metaEl.appendChild(handoffStatusEl);

        const handoffArchetypesEl = document.createElement('div');
        handoffArchetypesEl.className = 'threshold-file-detail';
        handoffArchetypesEl.textContent = 'Archetypes: ' + formatLabelValue(handoff.archetypes);
        metaEl.appendChild(handoffArchetypesEl);

        const handoffTagsEl = document.createElement('div');
        handoffTagsEl.className = 'threshold-file-detail';
        handoffTagsEl.textContent = 'Tags: ' + formatLabelValue(handoff.tags);
        metaEl.appendChild(handoffTagsEl);
    }

    const statusEl = document.createElement('span');
    statusEl.className = 'threshold-file-state';
    statusEl.textContent = thresholdStatusLabel(file);

    const actions = document.createElement('div');
    actions.className = 'threshold-file-actions';

    const openBtn = document.createElement('button');
    openBtn.className = 'secondary threshold-action-btn';
    openBtn.textContent = file.type === 'pdf' ? 'Reveal File' : 'Inspect in Reader';
    openBtn.addEventListener('click', () => openThresholdImportedFile(file));

    const copyBtn = document.createElement('button');
    copyBtn.className = 'secondary threshold-action-btn';
    copyBtn.textContent = 'Copy Path';
    copyBtn.addEventListener('click', () => copyThresholdPath(file.path || ''));

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'secondary threshold-action-btn threshold-reject-btn';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => deleteThresholdImportedFile(file));

    if (file.bootstrapDetected) {
        const reviewBtn = document.createElement('button');
        reviewBtn.className = 'secondary threshold-action-btn';
        reviewBtn.textContent = 'Review Bootstrap';
        reviewBtn.addEventListener('click', () => openThresholdImportedFile(file));

        const discussBtn = document.createElement('button');
        discussBtn.className = 'secondary threshold-action-btn';
        discussBtn.textContent = 'Discuss Bootstrap';
        discussBtn.addEventListener('click', () => discussThresholdBootstrap(file));

        const useBtn = document.createElement('button');
        useBtn.className = 'secondary threshold-action-btn';
        useBtn.textContent = 'Use as Active Bootstrap';
        useBtn.addEventListener('click', () => useThresholdBootstrap(file));
        actions.appendChild(reviewBtn);
        actions.appendChild(discussBtn);
        actions.appendChild(useBtn);
    }

    actions.appendChild(openBtn);
    actions.appendChild(copyBtn);
    actions.appendChild(deleteBtn);

    row.appendChild(metaEl);
    row.appendChild(statusEl);
    row.appendChild(actions);
    return row;
}

async function createCacheDraftFromSelectedThresholdFiles() {
    const selected = selectedThresholdDraftFiles(_thresholdImportedFiles);
    if (selected.length === 0) {
        showFlashMessage('Select ' + THRESHOLD_DRAFT_ALLOWED_LABEL + ' files first.');
        return;
    }
    const suggestedId = selected[0] && selected[0].name
        ? sanitizeDraftIdInput(selected[0].name)
        : '';
    const draftIdInput = window.prompt('Draft ID (optional)', suggestedId || '');
    if (draftIdInput === null) return;
    try {
        const res = await fetch('/api/threshold/cache-drafts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                draftId: draftIdInput || undefined,
                paths: selected.map(file => file.path),
            }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
            throw new Error(data.error || 'Could not create draft.');
        }
        _selectedThresholdPaths = new Set();
        refreshThresholdSelectionActions(_thresholdImportedFiles);
        showFlashMessage('Cache draft created.');
        markSentinelTrialStep('scribe_structuring', 'cache_draft_created');
        await loadThresholdCacheDrafts();
        if (data.draft && data.draft.id) {
            await openThresholdCacheDraft(data.draft.id);
        }
    } catch (error) {
        showFlashMessage(error.message || 'Could not create draft.');
    }
}

async function addSelectedThresholdFilesToDraft() {
    const selected = selectedThresholdDraftFiles(_thresholdImportedFiles);
    if (selected.length === 0) {
        showFlashMessage('Select ' + THRESHOLD_DRAFT_ALLOWED_LABEL + ' files first.');
        return;
    }
    const input = window.prompt('Draft ID to add selected files');
    const draftId = input ? String(input).trim() : '';
    if (!draftId) return;
    try {
        const res = await fetch('/api/threshold/cache-drafts/' + encodeURIComponent(draftId) + '/documents/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                paths: selected.map(file => file.path),
            }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
            throw new Error(data.error || 'Could not add files to draft.');
        }
        _selectedThresholdPaths = new Set();
        refreshThresholdSelectionActions(_thresholdImportedFiles);
        showFlashMessage('Selected files added to draft.');
        markSentinelTrialStep('scribe_structuring', 'cache_draft_created');
        await loadThresholdCacheDrafts();
        await openThresholdCacheDraft(draftId);
    } catch (error) {
        showFlashMessage(error.message || 'Could not add files to draft.');
    }
}

function draftUpdatedLabel(draft) {
    const updated = draft && draft.updatedAt ? draft.updatedAt : draft && draft.manifest && draft.manifest.updated_at;
    return updated ? formatRelativeTime(updated) : 'just now';
}

function buildThresholdCacheDraftRow(draft) {
    const row = document.createElement('div');
    row.className = 'threshold-file-row';
    const manifest = draft && draft.manifest ? draft.manifest : {};
    const documents = Array.isArray(manifest.documents) ? manifest.documents : [];
    const continuityThemes = Array.isArray(manifest.continuity_themes) ? manifest.continuity_themes : [];
    const sourceLabel = manifest.source || 'threshold';
    const recommendedArchetypes = deriveCacheRecommendedArchetypes({ manifest });
    const carrySummary = describeCacheCarrySummary({ manifest, continuity_themes: continuityThemes });
    const purposeSummary = formatPurposeSummary(manifest.purpose_summary || manifest.description || '');
    const disciplineHints = buildSignalDisciplineHints(
        {
            id: draft.id,
            title: manifest.title || draft.id || 'Cache Draft',
            level: manifest.level || 'spark',
            signal_density: manifest.signal_density || 'low',
            continuity_themes: continuityThemes,
            tags: manifest.tags || [],
            archetypes: manifest.archetypes || [],
            documents,
            manifest,
        },
        (_thresholdCacheDrafts || []).filter(entry => entry && entry.id !== draft.id),
    );

    const metaEl = document.createElement('div');
    metaEl.className = 'threshold-file-meta';
    metaEl.innerHTML =
        '<div class="threshold-file-title-row"><span class="threshold-file-icon">ᚠ</span><span class="threshold-file-title">' +
        escapeHtml(manifest.title || draft.id || 'Cache Draft') + '</span></div>' +
        '<div class="threshold-file-detail">Level: ' + escapeHtml(describeCacheLevel(manifest.level || 'spark')) + '</div>' +
        '<div class="threshold-file-detail">Purpose: ' + escapeHtml(purposeSummary) + '</div>' +
        '<div class="threshold-file-detail">Carries: ' + escapeHtml(carrySummary) + '</div>' +
        '<div class="threshold-file-detail">Source: ' + escapeHtml(sourceLabel) + '</div>' +
        '<div class="threshold-file-detail">Recommended Archetypes: ' + escapeHtml(recommendedArchetypes.length ? recommendedArchetypes.join(', ') : '—') + '</div>' +
        '<div class="threshold-file-detail">Documents: ' + escapeHtml(String(documents.length)) + '</div>' +
        '<div class="threshold-file-detail">Status: ' + escapeHtml(manifest.status || 'draft') + '</div>' +
        '<div class="threshold-file-detail">Themes: ' + escapeHtml(summarizeDistillationThemes(continuityThemes)) + '</div>' +
        '<div class="threshold-file-detail">Distillation Readiness: ' + escapeHtml(disciplineHints.distillationReadiness) + '</div>' +
        '<div class="threshold-file-detail">Weak Signal Guidance: ' + escapeHtml(disciplineHints.weakSignalGuidance) + '</div>' +
        '<div class="threshold-file-detail">High Signal Reinforcement: ' + escapeHtml(disciplineHints.highSignalReinforcement) + '</div>' +
        '<div class="threshold-file-detail">Signal Density: ' + escapeHtml(disciplineHints.signalDensityHint) + '</div>' +
        '<div class="threshold-file-detail">Redundancy Risk: ' + escapeHtml(disciplineHints.redundancyRisk) + '</div>' +
        '<div class="threshold-file-detail">Missing Perspectives: ' +
            escapeHtml(disciplineHints.missingPerspectives.length > 0 ? disciplineHints.missingPerspectives.join(' | ') : 'none flagged') +
            '</div>' +
        '<div class="threshold-file-detail">Compression Opportunity: ' + escapeHtml(disciplineHints.compressionOpportunity) + '</div>' +
        '<div class="threshold-file-detail">Updated: ' + escapeHtml(draftUpdatedLabel(draft)) + '</div>';

    const statusEl = document.createElement('span');
    statusEl.className = 'threshold-file-state';
    statusEl.textContent = manifest.status || 'draft';

    const actions = document.createElement('div');
    actions.className = 'threshold-file-actions';

    const openBtn = document.createElement('button');
    openBtn.className = 'secondary threshold-action-btn';
    openBtn.textContent = 'Inspect';
    openBtn.addEventListener('click', () => openThresholdCacheDraft(draft.id));

    const openReaderBtn = document.createElement('button');
    openReaderBtn.className = 'secondary threshold-action-btn';
    openReaderBtn.textContent = 'Open in Reader';
    openReaderBtn.addEventListener('click', () => openThresholdDraftInReader(draft));

    const exportBtn = document.createElement('button');
    exportBtn.className = 'secondary threshold-action-btn';
    exportBtn.textContent = 'Export Zip';
    exportBtn.addEventListener('click', () => exportThresholdCacheDraft(draft.id));

    const installBtn = document.createElement('button');
    installBtn.className = 'secondary threshold-action-btn';
    installBtn.textContent = 'Carry into Cache Loadout';
    installBtn.addEventListener('click', () => installThresholdCacheDraft(draft.id));

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'secondary threshold-action-btn threshold-reject-btn';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => deleteThresholdCacheDraft(draft.id));

    const reviewBtn = document.createElement('button');
    reviewBtn.className = 'secondary threshold-action-btn';
    reviewBtn.textContent = 'Generate Distillation Recommendation';
    reviewBtn.addEventListener('click', async () => {
        try {
            await requestDistillationRecommendation({
                title: manifest.title || draft.id || 'Cache Draft',
                sourceHint: draft.path || ('threshold/cache-drafts/' + draft.id),
                candidateCaches: [manifest.title || draft.id || 'Cache Draft'],
                continuityThemes,
                peerCaches: (_thresholdCacheDrafts || []).filter(entry => entry && entry.id !== draft.id),
                level: manifest.level || 'spark',
                signalDensity: manifest.signal_density || 'low',
                tags: manifest.tags || [],
                archetypes: manifest.archetypes || [],
                documents,
            });
        } catch (error) {
            showFlashMessage(error.message || 'Could not generate distillation recommendation.');
        }
    });

    const discussBtn = document.createElement('button');
    discussBtn.className = 'secondary threshold-action-btn';
    discussBtn.textContent = 'Discuss Cache Compression';
    discussBtn.addEventListener('click', () => {
        openCouncilChatWithPrompt(
            buildCacheCompressionPrompt({
                id: draft.id,
                title: manifest.title || draft.id,
                source: draft.path || ('threshold/cache-drafts/' + draft.id),
                continuityThemes,
            }),
            EMBER_PRIME_MEMBER_ID,
            { distillationGuidance: true },
        );
        showFlashMessage('Compression discussion opened in Council Chat.');
    });

    const compareBtn = document.createElement('button');
    compareBtn.className = 'secondary threshold-action-btn';
    compareBtn.textContent = 'Compare Cache Themes';
    compareBtn.addEventListener('click', () => {
        openCouncilChatWithPrompt(
            buildCacheThemeComparisonPrompt({
                id: draft.id,
                title: manifest.title || draft.id,
                source: draft.path || ('threshold/cache-drafts/' + draft.id),
                candidateCaches: [manifest.title || draft.id || 'Cache Draft'],
                continuityThemes,
            }),
            EMBER_PRIME_MEMBER_ID,
            { distillationGuidance: true },
        );
        showFlashMessage('Theme comparison opened in Council Chat.');
    });

    const noteBtn = document.createElement('button');
    noteBtn.className = 'secondary threshold-action-btn';
    noteBtn.textContent = 'Signal Discipline Note';
    noteBtn.addEventListener('click', () => {
        getGreenFireReader().open({
            title: (manifest.title || draft.id || 'Cache Draft') + ' · Signal Discipline',
            sourcePath: draft.path || ('threshold/cache-drafts/' + draft.id),
            sourceLabel: 'Signal Discipline Note',
            content: buildSignalDisciplineNoteMarkdown(disciplineHints),
            contentType: 'text/markdown',
            entryId: 'threshold-signal-discipline:' + draft.id,
            stripFrontmatter: false,
            rawOnly: false,
            initialRawView: false,
        });
        showFlashMessage('Signal Discipline Note opened in Reader.');
    });

    actions.appendChild(openBtn);
    actions.appendChild(openReaderBtn);
    actions.appendChild(reviewBtn);
    actions.appendChild(discussBtn);
    actions.appendChild(compareBtn);
    actions.appendChild(noteBtn);
    actions.appendChild(exportBtn);
    actions.appendChild(installBtn);
    actions.appendChild(deleteBtn);

    row.appendChild(metaEl);
    row.appendChild(statusEl);
    row.appendChild(actions);
    return row;
}

function renderThresholdCacheDraftDetail(draft) {
    const container = document.getElementById('threshold-cache-draft-view');
    const titleEl = document.getElementById('threshold-cache-draft-view-title');
    const metaEl = document.getElementById('threshold-cache-draft-view-meta');
    const docsEl = document.getElementById('threshold-cache-draft-documents');
    if (!container || !titleEl || !metaEl || !docsEl) return;
    if (!draft) {
        container.style.display = 'none';
        docsEl.innerHTML = '';
        return;
    }
    container.style.display = '';
    const manifest = draft.manifest || {};
    const docs = Array.isArray(manifest.documents) ? manifest.documents : [];
    const derivedFrom = Array.isArray(manifest.derived_from) ? manifest.derived_from : [];
    const distilledInto = Array.isArray(manifest.distilled_into) ? manifest.distilled_into : [];
    const continuityThemes = Array.isArray(manifest.continuity_themes) ? manifest.continuity_themes : [];
    const signalDensity = manifest.signal_density ? String(manifest.signal_density) : 'low';
    const purposeSummary = formatPurposeSummary(manifest.purpose_summary || manifest.description || '');
    const disciplineHints = buildSignalDisciplineHints(
        {
            id: draft.id,
            title: manifest.title || draft.id || 'Cache Draft',
            level: manifest.level || 'spark',
            signal_density: signalDensity,
            continuity_themes: continuityThemes,
            tags: manifest.tags || [],
            archetypes: manifest.archetypes || [],
            documents: docs,
            manifest,
        },
        (_thresholdCacheDrafts || []).filter(entry => entry && entry.id !== draft.id),
    );
    titleEl.textContent = 'Draft: ' + (manifest.title || draft.id || 'Cache Draft');
    metaEl.textContent = [
        'Level: ' + describeCacheLevel(manifest.level || 'spark'),
        'Status: ' + (manifest.status || 'draft'),
        'Purpose Summary: ' + purposeSummary,
        'Documents: ' + docs.length,
        'Updated: ' + draftUpdatedLabel(draft),
        'Derived From: ' + (derivedFrom.length > 0 ? derivedFrom.join(', ') : '—'),
        'Distilled Into: ' + (distilledInto.length > 0 ? distilledInto.join(', ') : '—'),
        'Related Themes: ' + (continuityThemes.length > 0 ? continuityThemes.join(', ') : '—'),
        'Distillation Readiness: ' + disciplineHints.distillationReadiness,
        'Weak Signal Guidance: ' + disciplineHints.weakSignalGuidance,
        'High Signal Reinforcement: ' + disciplineHints.highSignalReinforcement,
        'Signal Density: ' + signalDensity,
        'Signal Density Hint: ' + disciplineHints.signalDensityHint,
        'Redundancy Risk: ' + disciplineHints.redundancyRisk,
        'Missing Perspectives: ' + (disciplineHints.missingPerspectives.length > 0 ? disciplineHints.missingPerspectives.join(' | ') : 'none flagged'),
        'Compression Opportunity: ' + disciplineHints.compressionOpportunity,
        'Cache Overlap Hint: ' + (disciplineHints.overlapHint || 'No strong overlap detected.'),
        'Suggested Next Steps: ' + (Array.isArray(disciplineHints.suggestedNextSteps) ? disciplineHints.suggestedNextSteps.join(' | ') : '—'),
        disciplineHints.qualityGuidance[0],
        disciplineHints.qualityGuidance[1],
        disciplineHints.stewardship,
    ].join(' · ');
    if (docs.length === 0) {
        docsEl.innerHTML = '<span class="message-system">No draft documents yet.</span>';
        return;
    }
    docsEl.innerHTML = '';
    docs.forEach(documentEntry => {
        const row = document.createElement('div');
        row.className = 'threshold-file-row';

        const meta = document.createElement('div');
        meta.className = 'threshold-file-meta';
        meta.innerHTML =
            '<div class="threshold-file-title-row"><span class="threshold-file-icon">ᚲ</span><span class="threshold-file-title">' +
            escapeHtml(documentEntry.title || titleFromDocumentPath(documentEntry.path || '')) + '</span></div>' +
            '<div class="threshold-file-detail">Path: ' + escapeHtml(documentEntry.path || 'documents/unknown') + '</div>' +
            '<div class="threshold-file-detail">Type: ' + escapeHtml(documentEntry.type || 'document') + '</div>' +
            '<div class="threshold-file-detail">Tags: ' + escapeHtml(formatLabelValue(documentEntry.tags)) + '</div>';
        const status = document.createElement('span');
        status.className = 'threshold-file-state';
        status.textContent = documentEntry.status || 'unverified';

        const actions = document.createElement('div');
        actions.className = 'threshold-file-actions';
        const openBtn = document.createElement('button');
        openBtn.className = 'secondary threshold-action-btn';
        openBtn.textContent = 'Open in Reader';
        openBtn.addEventListener('click', () => openThresholdDraftDocumentInReader(draft.id, documentEntry.path));
        const discussActions = createCouncilDiscussActions(
            (memberId) => buildThresholdDraftDiscussionPrompt(draft.id, documentEntry.path, memberId),
            () => 'threshold cache draft',
        );
        const removeBtn = document.createElement('button');
        removeBtn.className = 'secondary threshold-action-btn threshold-reject-btn';
        removeBtn.textContent = 'Remove from Draft';
        removeBtn.addEventListener('click', () => removeThresholdDraftDocument(draft.id, documentEntry.path));
        actions.appendChild(openBtn);
        actions.appendChild(discussActions);
        actions.appendChild(removeBtn);
        row.appendChild(meta);
        row.appendChild(status);
        row.appendChild(actions);
        docsEl.appendChild(row);
    });
}

async function loadThresholdCacheDrafts() {
    const listEl = document.getElementById('threshold-cache-drafts-list');
    if (!listEl) return;
    try {
        const res = await fetch('/api/threshold/cache-drafts');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not load drafts.');
        const drafts = Array.isArray(data.drafts) ? data.drafts : [];
        _thresholdCacheDrafts = drafts;
        if (drafts.length === 0) {
            listEl.innerHTML = '<span class="message-system">No cache drafts yet.</span>';
        } else {
            listEl.innerHTML = '';
            drafts.forEach(draft => listEl.appendChild(buildThresholdCacheDraftRow(draft)));
        }
        if (_activeThresholdDraftId) {
            const active = drafts.find(d => d.id === _activeThresholdDraftId);
            if (active) {
                await openThresholdCacheDraft(_activeThresholdDraftId);
            } else {
                _activeThresholdDraftId = null;
                renderThresholdCacheDraftDetail(null);
            }
        }
    } catch {
        listEl.innerHTML = '<span class="message-system threshold-error">Could not load cache drafts.</span>';
    }
}

async function openThresholdCacheDraft(draftId) {
    try {
        const res = await fetch('/api/threshold/cache-drafts/' + encodeURIComponent(draftId));
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'Could not open draft.');
        _activeThresholdDraftId = draftId;
        renderThresholdCacheDraftDetail(data.draft);
    } catch (error) {
        showFlashMessage(error.message || 'Could not open draft.');
    }
}

async function buildThresholdDraftDiscussionPrompt(draftId, documentPath) {
    const fallback = [
        'Discuss this cache draft document with me:',
        '',
        '- Draft: ' + draftId,
        '- Path: ' + documentPath,
        '',
        'Please help me test assumptions, identify weak points, and propose practical next steps.',
    ].join('\n');
    try {
        const res = await fetch(
            '/api/threshold/cache-drafts/' + encodeURIComponent(draftId) + '/documents/content?path=' + encodeURIComponent(documentPath),
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) return fallback;
        return buildDocumentDiscussionPrompt({
            title: data.title || titleFromDocumentPath(documentPath),
            source: data.path || ('threshold/cache-drafts/' + draftId + '/' + documentPath),
            content: data.content || '',
        });
    } catch {
        return fallback;
    }
}

async function openThresholdDraftDocumentInReader(draftId, documentPath) {
    try {
        const res = await fetch(
            '/api/threshold/cache-drafts/' + encodeURIComponent(draftId) + '/documents/content?path=' + encodeURIComponent(documentPath),
        );
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'Could not open draft document.');
        const isMarkdown = data.contentType === 'text/markdown';
        getGreenFireReader().open({
            title: data.title || 'Draft Document',
            sourcePath: data.path || ('threshold/cache-drafts/' + draftId + '/' + documentPath),
            content: data.content || '',
            contentType: data.contentType || 'text/plain',
            entryId: 'threshold-cache-draft:' + (data.path || (draftId + ':' + documentPath)),
            sourceLabel: data.sourceLabel || 'Threshold Cache Draft',
            handoff: data.handoff || null,
            stripFrontmatter: isMarkdown,
            rawOnly: !isMarkdown,
            initialRawView: !isMarkdown,
        });
    } catch (error) {
        showFlashMessage(error.message || 'Could not open draft document.');
    }
}

async function openThresholdDraftInReader(draft) {
    const documents = draft && draft.manifest && Array.isArray(draft.manifest.documents)
        ? draft.manifest.documents
        : [];
    if (documents.length === 0) {
        showFlashMessage('Draft has no documents yet.');
        return;
    }
    await openThresholdDraftDocumentInReader(draft.id, documents[0].path);
}

async function exportThresholdCacheDraft(draftId) {
    try {
        const res = await fetch('/api/threshold/cache-drafts/' + encodeURIComponent(draftId) + '/export', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'Export failed.');
        showFlashMessage('Draft exported: ' + (data.exported && data.exported.exportPath ? data.exported.exportPath : 'done'));
    } catch (error) {
        showFlashMessage(error.message || 'Export failed.');
    }
}

async function installThresholdCacheDraft(draftId) {
    try {
        await exportThresholdCacheDraft(draftId);
        const res = await fetch('/api/threshold/cache-drafts/' + encodeURIComponent(draftId) + '/install', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'Install failed.');
        showFlashMessage('Installed to ' + (data.installed && data.installed.installedPath ? data.installed.installedPath : 'archive/caches/' + draftId));
    } catch (error) {
        showFlashMessage(error.message || 'Install failed.');
    }
}

async function removeThresholdDraftDocument(draftId, documentPath) {
    const ok = window.confirm('Remove "' + documentPath + '" from this draft?');
    if (!ok) return;
    try {
        const res = await fetch('/api/threshold/cache-drafts/' + encodeURIComponent(draftId) + '/documents', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: documentPath }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'Remove failed.');
        showFlashMessage('Document removed from draft.');
        await loadThresholdCacheDrafts();
        await openThresholdCacheDraft(draftId);
    } catch (error) {
        showFlashMessage(error.message || 'Remove failed.');
    }
}

async function deleteThresholdCacheDraft(draftId) {
    const ok = window.confirm('Delete cache draft "' + draftId + '"? This cannot be undone.');
    if (!ok) return;
    try {
        const res = await fetch('/api/threshold/cache-drafts/' + encodeURIComponent(draftId), {
            method: 'DELETE',
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'Delete failed.');
        if (_activeThresholdDraftId === draftId) {
            _activeThresholdDraftId = null;
            renderThresholdCacheDraftDetail(null);
        }
        showFlashMessage('Cache draft deleted.');
        await loadThresholdCacheDrafts();
    } catch (error) {
        showFlashMessage(error.message || 'Delete failed.');
    }
}


/* ================================================================
   System Status
   ================================================================ */

async function refreshSystemStatus() {
    const ollamaEl  = document.getElementById('sys-ollama-status');
    const ollamaEndpointEl = document.getElementById('sys-ollama-endpoint');
    const portEl    = document.getElementById('sys-port');
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
        if (ollamaEndpointEl) {
            ollamaEndpointEl.textContent = data.ollamaBaseUrl
                ? String(data.ollamaBaseUrl).replace(/^[a-z]+:\/\//i, '')
                : '—';
        }
        if (portEl) {
            portEl.textContent = data.port != null ? String(data.port) : '—';
        }
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
        (function renderModelRolesPanel() {
            const hearthEl = document.getElementById('sys-model-role-hearth');
            const forgeEl = document.getElementById('sys-model-role-forge');
            const scribeEl = document.getElementById('sys-model-role-scribe');
            const fallbackEl = document.getElementById('sys-model-role-fallback');
            if (!hearthEl && !forgeEl && !scribeEl && !fallbackEl) return;

            const configuredRoles = data && data.model_roles_configured && typeof data.model_roles_configured === 'object'
                ? data.model_roles_configured
                : (data && data.model_roles && typeof data.model_roles === 'object'
                    ? data.model_roles
                    : {});
            const installed = Array.isArray(data && data.installed_models)
                ? new Set(data.installed_models.map(name => String(name || '').trim()).filter(Boolean))
                : null;
            const selected = data.selected_model || DEFAULT_MODEL_LABEL;
            const fallbackLabel = String(selected || DEFAULT_MODEL_LABEL);

            function renderRoleValue(roleKey) {
                const configured = String(configuredRoles[roleKey] || '').trim();
                if (!configured) return 'fallback → ' + fallbackLabel;
                if (installed && installed.size > 0 && !installed.has(configured)) {
                    return configured + ' (missing)';
                }
                return configured;
            }

            if (hearthEl) hearthEl.textContent = renderRoleValue('hearth') || '—';
            if (forgeEl) forgeEl.textContent = renderRoleValue('forge') || '—';
            if (scribeEl) scribeEl.textContent = renderRoleValue('scribe') || '—';
            if (fallbackEl) fallbackEl.textContent = fallbackLabel || '—';
        })();
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
        const hearthEl = document.getElementById('sys-model-role-hearth');
        const forgeEl = document.getElementById('sys-model-role-forge');
        const scribeEl = document.getElementById('sys-model-role-scribe');
        const fallbackEl = document.getElementById('sys-model-role-fallback');
        if (hearthEl) hearthEl.textContent = 'fallback → ' + DEFAULT_MODEL_LABEL;
        if (forgeEl) forgeEl.textContent = 'fallback → ' + DEFAULT_MODEL_LABEL;
        if (scribeEl) scribeEl.textContent = 'fallback → ' + DEFAULT_MODEL_LABEL;
        if (fallbackEl) fallbackEl.textContent = DEFAULT_MODEL_LABEL;
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

function setRuntimeTuningStatus(message, isError = false) {
    const statusEl = document.getElementById('sys-tuning-status');
    if (!statusEl) return;
    statusEl.textContent = message || '';
    statusEl.className = isError
        ? 'message-system runtime-tuning-status error'
        : 'message-system runtime-tuning-status';
}

function getRuntimeTuningSettings() {
    const depthEl = document.getElementById('sys-tuning-depth-select');
    const profileEl = document.getElementById('sys-tuning-profile-select');
    const focusEl = document.getElementById('sys-tuning-loadout-focus-select');
    const archetypeEl = document.getElementById('sys-tuning-archetype-select');
    return {
        responseDepth: normalizeResponseDepth(depthEl ? depthEl.value : getActiveResponseDepth()),
        runtimeProfile: normalizeRuntimeProfile(profileEl ? profileEl.value : getActiveRuntimeProfile()),
        loadoutFocus: normalizeLoadoutFocus(focusEl ? focusEl.value === 'on' : getActiveLoadoutFocus()),
        archetype: normalizeRuntimeTuningArchetype(archetypeEl ? archetypeEl.value : 'ember-prime'),
    };
}

function syncRuntimeTuningControls() {
    const depthEl = document.getElementById('sys-tuning-depth-select');
    const profileEl = document.getElementById('sys-tuning-profile-select');
    const focusEl = document.getElementById('sys-tuning-loadout-focus-select');
    const archetypeEl = document.getElementById('sys-tuning-archetype-select');
    if (depthEl) depthEl.value = getActiveResponseDepth();
    if (profileEl) profileEl.value = getActiveRuntimeProfile();
    if (focusEl) focusEl.value = getActiveLoadoutFocus() ? 'on' : 'off';
    if (archetypeEl && !RUNTIME_TUNING_ARCHETYPE_IDS.has(archetypeEl.value)) {
        archetypeEl.value = 'ember-prime';
    }
}

function renderRuntimeTuningMetrics(run) {
    const host = document.getElementById('sys-tuning-metrics');
    if (!host) return;
    if (!run || !run.metrics) {
        host.innerHTML = '<span class="message-system">Run a tuning test to view compact metrics.</span>';
        return;
    }
    const metrics = run.metrics;
    const rows = [
        ['time', formatRuntimeTuningMetric(metrics.responseTimeMs, ' ms')],
        ['length', formatRuntimeTuningMetric(metrics.responseLength, ' chars')],
        ['depth', metrics.depthUsed || '—'],
        ['profile', metrics.runtimeProfileUsed || '—'],
        ['carry', metrics.loadoutFocusUsed ? 'ON' : 'OFF'],
        ['archetype', metrics.archetypeUsed || '—'],
        ['raw chunks', formatRuntimeTuningMetric(metrics.rawChunksUsed)],
        ['summaries', formatRuntimeTuningMetric(metrics.summariesUsed)],
        ['loaded caches', formatRuntimeTuningMetric(metrics.loadedCacheCount)],
        ['prompt est.', formatRuntimeTuningMetric(metrics.promptEstimate)],
        ['num_predict', formatRuntimeTuningMetric(metrics.numPredict)],
        ['retrieval conf.', formatRuntimeTuningMetric(metrics.retrievalConfidence)],
        ['cache overlap', formatRuntimeTuningMetric(metrics.cacheOverlap)],
        ['continuity density', formatRuntimeTuningMetric(metrics.continuityDensity)],
    ];
    host.innerHTML = rows.map(([key, value]) =>
        '<div class="runtime-tuning-metric-row">' +
            '<span class="runtime-tuning-metric-key">' + escapeHtml(key) + '</span>' +
            '<span class="runtime-tuning-metric-value">' + escapeHtml(String(value || '—')) + '</span>' +
        '</div>',
    ).join('');
}

function buildRuntimeTuningHistoryEntry(run) {
    return {
        id: run.id,
        created: run.created,
        prompt: compactTextSnippet(run.prompt || '', RUNTIME_TUNING_MAX_PROMPT_LENGTH),
        promptPresetId: run.promptPresetId || '',
        settings: run.settings || {},
        metrics: run.metrics || {},
        responsePreview: compactTextSnippet(run.response || '', RUNTIME_TUNING_MAX_RESPONSE_PREVIEW_LENGTH),
    };
}

function renderRuntimeTuningHistory(runs) {
    const listEl = document.getElementById('sys-tuning-history-list');
    if (!listEl) return;
    const list = Array.isArray(runs) ? runs : [];
    if (list.length === 0) {
        listEl.innerHTML = '<span class="message-system">No tuning runs recorded yet.</span>';
        return;
    }
    listEl.innerHTML = list.slice(0, 20).map(run => {
        const created = run && run.created ? new Date(run.created).toLocaleString() : 'unknown';
        const settings = run && run.settings ? run.settings : {};
        const metrics = run && run.metrics ? run.metrics : {};
        const profileLabel = getRuntimeProfileMeta(settings.runtimeProfile || DEFAULT_RUNTIME_PROFILE).label;
        const archetypeLabel = RUNTIME_TUNING_ARCHETYPE_LABELS[normalizeRuntimeTuningArchetype(settings.archetype)] || 'Ember Prime';
        return (
            '<div class="runtime-tuning-history-row">' +
                '<div class="runtime-tuning-history-title">' + escapeHtml(created) + ' · ' + escapeHtml(humanizeDepth(settings.responseDepth || 'ember')) + ' · ' + escapeHtml(profileLabel) + '</div>' +
                '<div>' + escapeHtml(compactTextSnippet(run.prompt || '', 95) || '(prompt unavailable)') + '</div>' +
                '<div>Carry: ' + escapeHtml(settings.loadoutFocus ? 'ON' : 'OFF') + ' · Archetype: ' + escapeHtml(archetypeLabel) + '</div>' +
                '<div>Time: ' + escapeHtml(formatRuntimeTuningMetric(metrics.responseTimeMs, ' ms')) +
                ' · Chunks: ' + escapeHtml(formatRuntimeTuningMetric(metrics.rawChunksUsed)) +
                ' · Summaries: ' + escapeHtml(formatRuntimeTuningMetric(metrics.summariesUsed)) + '</div>' +
            '</div>'
        );
    }).join('');
}

async function loadRuntimeTuningHistory() {
    const listEl = document.getElementById('sys-tuning-history-list');
    if (listEl) listEl.innerHTML = '<span class="message-system">Loading tuning history…</span>';
    try {
        const res = await fetch('/api/system/tuning/runtime-runs');
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.success === false) {
            throw new Error(data.error || 'Could not load runtime tuning history.');
        }
        renderRuntimeTuningHistory(data.runs || []);
    } catch (error) {
        if (listEl) listEl.innerHTML = '<span class="message-system error">' + escapeHtml(error.message || 'Could not load tuning history.') + '</span>';
    }
}

function collectRuntimeTuningRunMetrics(data, elapsedMs, settings) {
    const signalTrace = data && data.signalTrace && typeof data.signalTrace === 'object' ? data.signalTrace : {};
    const runtimeDebug = signalTrace.runtimeDebug && typeof signalTrace.runtimeDebug === 'object' ? signalTrace.runtimeDebug : {};
    const memoryFlow = signalTrace.memoryFlow && typeof signalTrace.memoryFlow === 'object' ? signalTrace.memoryFlow : {};
    const cacheSummaryCount = Number(memoryFlow.cacheSummaries) || 0;
    const documentSummaryCount = Number(memoryFlow.documentSummaries) || 0;
    return {
        responseTimeMs: Number(signalTrace.modelResponseMs) || elapsedMs,
        responseLength: String(data && data.answer ? data.answer : '').length,
        depthUsed: signalTrace.depth || humanizeDepth(settings.responseDepth),
        runtimeProfileUsed: signalTrace.runtimeProfile || getRuntimeProfileMeta(settings.runtimeProfile).label,
        loadoutFocusUsed: signalTrace.loadoutFocus === true || (signalTrace.loadoutFocus !== false && settings.loadoutFocus === true),
        archetypeUsed: RUNTIME_TUNING_ARCHETYPE_LABELS[settings.archetype] || 'Ember Prime',
        rawChunksUsed: Number(runtimeDebug.retrievalChunksUsed) || Number(memoryFlow.rawChunks) || 0,
        summariesUsed: cacheSummaryCount + documentSummaryCount,
        loadedCacheCount: Number(signalTrace.loadedCacheCount) || 0,
        promptEstimate: Number(runtimeDebug.promptTokensEstimate) || null,
        numPredict: Number(runtimeDebug.numPredict) || null,
        retrievalConfidence: Number(runtimeDebug.retrievalConfidence) || null,
        cacheOverlap: Number(runtimeDebug.cacheOverlapStrength) || null,
        continuityDensity: Number(runtimeDebug.continuityDensity) || null,
    };
}

async function runRuntimeTuningTest() {
    const runBtn = document.getElementById('sys-tuning-run-btn');
    const promptEl = document.getElementById('sys-tuning-prompt-input');
    const presetEl = document.getElementById('sys-tuning-preset-select');
    const responseEl = document.getElementById('sys-tuning-response');
    if (!promptEl || !runBtn) return;
    const prompt = String(promptEl.value || '').trim();
    if (!prompt) {
        setRuntimeTuningStatus('Prompt is required.', true);
        return;
    }

    const settings = getRuntimeTuningSettings();
    runBtn.disabled = true;
    setRuntimeTuningStatus('Running tuning test…');
    try {
        const startedAt = Date.now();
        const res = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                query: prompt,
                room: RUNTIME_TUNING_ROOM,
                responseDepth: settings.responseDepth,
                runtimeProfile: settings.runtimeProfile,
                loadoutFocus: settings.loadoutFocus,
                courtMember: runtimeTuningArchetypeToApiMember(settings.archetype),
                distillationGuidance: false,
            }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data || typeof data.answer !== 'string') {
            throw new Error((data && data.error) || 'Could not run tuning test.');
        }
        const elapsedMs = Date.now() - startedAt;
        const metrics = collectRuntimeTuningRunMetrics(data, elapsedMs, settings);
        const runIdSuffix = Math.random().toString(36).slice(2, 8);
        _runtimeTuningLastRun = {
            id: 'runtime-tuning-' + Date.now() + '-' + runIdSuffix,
            created: new Date().toISOString(),
            prompt,
            promptPresetId: presetEl ? String(presetEl.value || '').trim() : '',
            settings,
            metrics,
            response: data.answer,
        };
        if (responseEl) responseEl.textContent = data.answer;
        renderRuntimeTuningMetrics(_runtimeTuningLastRun);
        setRuntimeTuningStatus('Tuning test complete.');

        const historyRes = await fetch('/api/system/tuning/runtime-runs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ run: buildRuntimeTuningHistoryEntry(_runtimeTuningLastRun) }),
        });
        const historyData = await historyRes.json().catch(() => ({}));
        if (historyRes.ok && historyData && historyData.success) {
            renderRuntimeTuningHistory(historyData.runs || []);
        } else {
            await loadRuntimeTuningHistory();
        }
    } catch (error) {
        setRuntimeTuningStatus(error.message || 'Tuning test failed.', true);
    } finally {
        runBtn.disabled = false;
    }
}

function buildRuntimeTuningMarkdown(run, options = {}) {
    const safeRun = run && typeof run === 'object' ? run : {};
    const settings = safeRun.settings && typeof safeRun.settings === 'object' ? safeRun.settings : {};
    const metrics = safeRun.metrics && typeof safeRun.metrics === 'object' ? safeRun.metrics : {};
    const notes = String(options.notes || '').trim();
    const suggestedAdjustment = String(options.suggestedAdjustment || '').trim();
    const archetypeLabel = RUNTIME_TUNING_ARCHETYPE_LABELS[normalizeRuntimeTuningArchetype(settings.archetype)] || 'Ember Prime';
    return [
        '---',
        'title: Runtime Tuning Run',
        'type: tuning-report',
        'source: ember-node',
        'created: ' + safeIsoTimestamp(safeRun.created),
        '---',
        '# Runtime Tuning Run',
        '## Test Prompt',
        String(safeRun.prompt || '').trim() || '-',
        '',
        '## Settings',
        '- Response Depth: ' + humanizeDepth(settings.responseDepth || 'ember'),
        '- Runtime Profile: ' + getRuntimeProfileMeta(settings.runtimeProfile || DEFAULT_RUNTIME_PROFILE).label,
        '- Loadout Focus: ' + (settings.loadoutFocus ? 'ON' : 'OFF'),
        '- Archetype: ' + archetypeLabel,
        '',
        '## Metrics',
        '- response time: ' + formatRuntimeTuningMetric(metrics.responseTimeMs, ' ms'),
        '- response length: ' + formatRuntimeTuningMetric(metrics.responseLength) + ' chars',
        '- depth used: ' + String(metrics.depthUsed || humanizeDepth(settings.responseDepth || 'ember')),
        '- runtime profile: ' + String(metrics.runtimeProfileUsed || getRuntimeProfileMeta(settings.runtimeProfile || DEFAULT_RUNTIME_PROFILE).label),
        '- loadout focus: ' + (metrics.loadoutFocusUsed ? 'ON' : 'OFF'),
        '- archetype: ' + String(metrics.archetypeUsed || archetypeLabel),
        '- raw chunks used: ' + formatRuntimeTuningMetric(metrics.rawChunksUsed),
        '- summaries used: ' + formatRuntimeTuningMetric(metrics.summariesUsed),
        '- loaded cache count: ' + formatRuntimeTuningMetric(metrics.loadedCacheCount),
        '- prompt estimate: ' + formatRuntimeTuningMetric(metrics.promptEstimate),
        '- num_predict: ' + formatRuntimeTuningMetric(metrics.numPredict),
        '- retrieval confidence: ' + formatRuntimeTuningMetric(metrics.retrievalConfidence),
        '- cache overlap: ' + formatRuntimeTuningMetric(metrics.cacheOverlap),
        '- continuity density: ' + formatRuntimeTuningMetric(metrics.continuityDensity),
        '',
        '## Response',
        String(safeRun.response || '').trim() || '-',
        '',
        '## Notes',
        notes || '-',
        '',
        '## Suggested Adjustment',
        suggestedAdjustment || '-',
        '',
    ].join('\n');
}

async function saveRuntimeTuningRunMarkdown() {
    if (!_runtimeTuningLastRun) {
        setRuntimeTuningStatus('Run a tuning test before saving markdown.', true);
        return;
    }
    const saveBtn = document.getElementById('sys-tuning-save-md-btn');
    if (saveBtn) saveBtn.disabled = true;
    try {
        const notesEl = document.getElementById('sys-tuning-notes-input');
        const adjustmentEl = document.getElementById('sys-tuning-adjustment-input');
        const markdown = buildRuntimeTuningMarkdown(_runtimeTuningLastRun, {
            notes: notesEl ? notesEl.value : '',
            suggestedAdjustment: adjustmentEl ? adjustmentEl.value : '',
        });
        const timestamp = safeIsoTimestamp(_runtimeTuningLastRun.created).replace(/[:.]/g, '-');
        await saveMarkdownToThresholdInbox(markdown, 'runtime-tuning-run-' + timestamp + '.md', 'Tuning run saved to Threshold inbox.');
        setRuntimeTuningStatus('Saved tuning run markdown.');
    } catch (error) {
        setRuntimeTuningStatus(error.message || 'Could not save tuning run markdown.', true);
    } finally {
        if (saveBtn) saveBtn.disabled = false;
    }
}

function initRuntimeTuningBench() {
    const applyPresetBtn = document.getElementById('sys-tuning-apply-preset-btn');
    const runBtn = document.getElementById('sys-tuning-run-btn');
    const saveBtn = document.getElementById('sys-tuning-save-md-btn');
    const promptEl = document.getElementById('sys-tuning-prompt-input');
    const presetEl = document.getElementById('sys-tuning-preset-select');
    if (promptEl && !promptEl.value.trim()) {
        promptEl.value = RUNTIME_TUNING_PROMPT_PRESETS['green-fire'];
    }
    if (applyPresetBtn && presetEl && promptEl) {
        applyPresetBtn.addEventListener('click', () => {
            const presetText = RUNTIME_TUNING_PROMPT_PRESETS[String(presetEl.value || '').trim()] || '';
            if (presetText) promptEl.value = presetText;
        });
    }
    if (runBtn) runBtn.addEventListener('click', runRuntimeTuningTest);
    if (saveBtn) saveBtn.addEventListener('click', saveRuntimeTuningRunMarkdown);
    syncRuntimeTuningControls();
    renderRuntimeTuningMetrics(null);
    loadRuntimeTuningHistory();
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
            const preservationLine = 'Your Ember-Node-Data folder will be preserved. Archive caches, chats, drafts, and remembered threads live outside the app folder.';
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

function getRuntimeProfileMeta(profileId) {
    const id = normalizeRuntimeProfile(profileId || DEFAULT_RUNTIME_PROFILE);
    return RUNTIME_PROFILE_META[id] || RUNTIME_PROFILE_META[DEFAULT_RUNTIME_PROFILE];
}

function humanizeDepth(depth) {
    const id = normalizeResponseDepth(depth);
    if (id === 'spark') return 'Spark';
    if (id === 'hearth') return 'Hearth';
    if (id === 'archive') return 'Archive';
    return 'Ember';
}

function classifyThemeForArchetype(theme, archetypeId) {
    const text = String(theme || '').toLowerCase();
    if (!text) return false;
    if (archetypeId === 'builder') return /(build|system|implement|repair|structure|resilience|resilient|steward|craft)/.test(text);
    if (archetypeId === 'warrior') return /(risk|pressure|survival|discipline|defense|boundary|readiness)/.test(text);
    if (archetypeId === 'scholar') return /(study|theory|framework|analysis|synthesis|research|compare|comparison|comparative)/.test(text);
    if (archetypeId === 'scribe') return /(write|narrative|story|document|transmit|language|guide)/.test(text);
    if (archetypeId === 'mystic') return /(symbol|myth|ritual|threshold|resonance|archetype)/.test(text);
    return false;
}

function buildArchetypePostureRows(activeArchetype, activeThemes) {
    const normalizedArchetype = String(activeArchetype || '').trim().toLowerCase();
    const themes = Array.isArray(activeThemes) ? activeThemes : [];
    return FORGE_ARCHETYPE_ORDER.map(id => {
        const label = FORGE_ARCHETYPE_LABELS[id] || id;
        const themeHits = themes.filter(theme => classifyThemeForArchetype(theme, id)).length;
        const isPrimary = normalizedArchetype && normalizedArchetype === id;
        let emphasis = 'Minimal';
        let strength = 24;
        if (isPrimary) {
            emphasis = 'Primary';
            strength = 96;
        } else if (themeHits > 0) {
            emphasis = 'Secondary';
            strength = 58;
        }
        return { id, label, emphasis, strength };
    });
}

function buildContinuityPostureLines({
    activeArchetype, runtimeProfile, responseDepth, loadoutFocus, loadedCaches, activeThemes, rollingSummary,
}) {
    const archetypeId = String(activeArchetype || '').trim().toLowerCase();
    const archetypeLabel = FORGE_ARCHETYPE_LABELS[archetypeId] || 'Ember Prime';
    const runtimeMeta = getRuntimeProfileMeta(runtimeProfile);
    const cacheCount = Array.isArray(loadedCaches) ? loadedCaches.length : 0;
    const topThemes = Array.isArray(activeThemes) ? activeThemes.slice(0, 3).map(String).filter(Boolean) : [];
    const summary = String(rollingSummary || '').replace(/\s+/g, ' ').trim();
    const lines = [
        `${runtimeMeta.label} posture with ${archetypeLabel} emphasis and ${humanizeDepth(responseDepth)} response pacing.`,
        `${loadoutFocus ? 'Focused retrieval bias' : 'Balanced retrieval bias'} across ${cacheCount} loaded cache${cacheCount === 1 ? '' : 's'}.`,
    ];
    if (topThemes.length > 0) {
        lines.push('Loaded themes center on ' + topThemes.join(', ') + '.');
    } else {
        lines.push('Loaded themes are still forming; refresh preview after loadout changes.');
    }
    if (summary) {
        lines.push(
            summary.length > FORGE_MAX_ROLLING_SUMMARY_LINE
                ? summary.slice(0, FORGE_MAX_ROLLING_SUMMARY_TRUNCATE).trimEnd() + '...'
                : summary,
        );
    }
    return lines.slice(0, 4);
}

function buildMentorGuidanceLines({ archetypeRows, loadedCaches, activeThemes }) {
    const lines = [];
    const primary = (archetypeRows || []).find(row => row.emphasis === 'Primary');
    const secondaryCount = (archetypeRows || []).filter(row => row.emphasis === 'Secondary').length;
    if (primary) {
        lines.push(`Current loadout heavily favors ${primary.label} continuity.`);
    }
    if (secondaryCount === 0) {
        lines.push('A Scholar review may strengthen synthesis breadth.');
    }

    const caches = Array.isArray(loadedCaches) ? loadedCaches : [];
    const themeCounts = new Map();
    caches.forEach(cache => {
        const themes = Array.isArray(cache && cache.continuity_themes) ? cache.continuity_themes : [];
        themes.forEach(theme => {
            const key = String(theme || '').trim();
            if (!key) return;
            themeCounts.set(key, (themeCounts.get(key) || 0) + 1);
        });
    });
    const overlappingTheme = Array.from(themeCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .find(([, count]) => count > 1);
    if (overlappingTheme) {
        lines.push(`These loaded caches overlap around ${overlappingTheme[0]}.`);
    }

    const derivedHeavy = caches.filter(cache => {
        const count = Array.isArray(cache && cache.derived_from) ? cache.derived_from.length : 0;
        return count >= 3;
    });
    if (derivedHeavy.length >= 2) {
        lines.push('Loadout redundancy is rising; distillation may tighten signal density.');
    }

    if (lines.length < 2 && Array.isArray(activeThemes) && activeThemes.length > 0) {
        lines.push('Theme spread remains stable; keep practical cadence while expanding selectively.');
    }
    return lines.slice(0, 3);
}

function formatForgeBootstrapPreview(markdown) {
    const text = String(markdown || '').replace(/\r\n/g, '\n').trim();
    if (!text) return 'No Sentinel Loadout Bootstrap generated yet.';
    const lines = text.split('\n');
    const clipped = lines.slice(0, FORGE_MAX_BOOTSTRAP_PREVIEW_LINES).join('\n');
    return lines.length > FORGE_MAX_BOOTSTRAP_PREVIEW_LINES ? clipped + '\n…' : clipped;
}

async function loadLoadoutForgePanel() {
    const summaryEl = document.getElementById('sys-loadout-active-summary');
    if (!summaryEl) return;
    const hintEl = document.getElementById('sys-loadout-onboarding-hint');
    const runtimeEl = document.getElementById('sys-loadout-runtime-profile');
    const postureEl = document.getElementById('sys-loadout-archetype-posture');
    const cacheEl = document.getElementById('sys-loadout-cache-cards');
    const continuityEl = document.getElementById('sys-loadout-continuity-posture');
    const previewEl = document.getElementById('sys-loadout-bootstrap-preview');

    [summaryEl, runtimeEl, postureEl, cacheEl, continuityEl].forEach(el => {
        if (el) el.innerHTML = '<span class="message-system">Loading…</span>';
    });
    if (previewEl) previewEl.textContent = 'Loading…';
    if (hintEl) hintEl.innerHTML = '';

    try {
        const [statusRes, bootstrapRes, loadedRes, installedRes, sentinelRes] = await Promise.all([
            fetch('/api/status'),
            fetch('/api/bootstrap'),
            fetch('/api/caches/loaded'),
            fetch('/api/caches/installed'),
            fetch('/api/bootstrap/sentinel'),
        ]);
        const statusData = await statusRes.json();
        const bootstrapData = await bootstrapRes.json();
        const loadedData = await loadedRes.json();
        const installedData = await installedRes.json();
        const sentinelData = sentinelRes.ok ? await sentinelRes.json() : null;

        const rolling = bootstrapData && bootstrapData.rollingBootstrap ? bootstrapData.rollingBootstrap : {};
        const nodeState = rolling && rolling.node_state && typeof rolling.node_state === 'object'
            ? rolling.node_state
            : {};
        const runtimeProfile = normalizeRuntimeProfile(nodeState.runtime_profile || getActiveRuntimeProfile());
        const activeArchetype = String(nodeState.active_archetype || '').trim().toLowerCase() || 'ember_prime';
        const responseDepth = normalizeResponseDepth(nodeState.response_depth || getActiveResponseDepth());
        const loadoutFocus = getActiveLoadoutFocus();
        const activeThemes = Array.isArray(rolling.active_themes) ? rolling.active_themes.slice(0, 8) : [];
        const rollingSummary = String(rolling.summary || '').trim();

        const loadedEntries = Array.isArray(loadedData && loadedData.loaded) ? loadedData.loaded : [];
        const installedEntries = Array.isArray(installedData && installedData.caches) ? installedData.caches : [];
        const installedById = new Map(installedEntries.map(cache => [String(cache.id), cache]));
        const mergedLoadedCaches = loadedEntries.map(entry => {
            const id = String(entry && entry.id ? entry.id : '');
            const installed = installedById.get(id);
            return {
                id,
                title: String(entry && entry.title ? entry.title : (installed && installed.title ? installed.title : id)),
                level: String(entry && entry.level ? entry.level : (installed && installed.level ? installed.level : 'spark')).toLowerCase(),
                continuity_themes: Array.isArray(installed && installed.continuity_themes) ? installed.continuity_themes : [],
                signal_density: installed && installed.signal_density ? String(installed.signal_density) : 'low',
                derived_from: Array.isArray(installed && installed.derived_from) ? installed.derived_from : [],
            };
        });

        const loadedCount = Number(statusData && statusData.loadedCacheCount) || mergedLoadedCaches.length;
        const summaryRows = [
            ['Lens', FORGE_ARCHETYPE_LABELS[activeArchetype] || 'Ember Prime'],
            ['Profile', getRuntimeProfileMeta(runtimeProfile).label],
            ['Depth', humanizeDepth(responseDepth)],
            ['Carry', loadoutFocus ? 'ON' : 'OFF'],
            ['Loaded Caches', String(loadedCount)],
        ];
        summaryEl.innerHTML = summaryRows.map(([key, value]) =>
            '<div class="forge-summary-row">' +
                '<span class="forge-summary-key">' + escapeHtml(key) + '</span>' +
                '<span class="forge-summary-value">' + escapeHtml(value) + '</span>' +
            '</div>',
        ).join('');

        const runtimeMeta = getRuntimeProfileMeta(runtimeProfile);
        runtimeEl.innerHTML =
            '<div class="forge-runtime-title">' + escapeHtml(runtimeMeta.label) + '</div>' +
            runtimeMeta.description.map(line =>
                '<div class="forge-runtime-desc">' + escapeHtml(line) + '</div>',
            ).join('');

        if (hintEl) {
            const hint = buildOnboardingHint({
                key: 'first-forge-visit',
                text: 'The Forge visualizes active posture; open details only when deeper alignment is needed.',
            });
            if (hint) hintEl.appendChild(hint);
        }

        const archetypeRows = buildArchetypePostureRows(activeArchetype, activeThemes);
        postureEl.innerHTML = archetypeRows.map(row =>
            '<div class="forge-archetype-row">' +
                '<div class="forge-archetype-main">' +
                    '<div class="forge-archetype-label">' + escapeHtml(row.label) + '</div>' +
                    '<div class="forge-archetype-bar"><span class="forge-archetype-bar-fill" style="width:' + String(row.strength) + '%;"></span></div>' +
                '</div>' +
                '<div class="forge-archetype-emphasis">' + escapeHtml(row.emphasis) + '</div>' +
            '</div>',
        ).join('');

        cacheEl.innerHTML = mergedLoadedCaches.length > 0
            ? mergedLoadedCaches.slice(0, FORGE_MAX_CACHE_CARDS).map(cache => {
                const themeText = cache.continuity_themes.length > 0
                    ? cache.continuity_themes.slice(0, 3).join(', ')
                    : 'none';
                const derivedCount = Array.isArray(cache.derived_from) ? cache.derived_from.length : 0;
                const badgeLevel = ['spark', 'ember', 'flame', 'hearth'].includes(cache.level) ? cache.level : 'spark';
                return (
                    '<div class="forge-cache-item">' +
                        '<div class="forge-cache-title-row">' +
                            '<span class="forge-cache-title">' + escapeHtml(cache.title || cache.id || 'Unnamed cache') + '</span>' +
                            '<span class="forge-level-badge ' + escapeHtml(badgeLevel) + '">' + escapeHtml(badgeLevel) + '</span>' +
                        '</div>' +
                        '<div class="forge-cache-meta">themes: ' + escapeHtml(themeText) + '</div>' +
                        '<div class="forge-cache-meta">signal: ' + escapeHtml(String(cache.signal_density || 'low')) + '</div>' +
                        '<div class="forge-cache-meta">derived_from: ' + escapeHtml(String(derivedCount)) + '</div>' +
                    '</div>'
                );
            }).join('')
            : '<span class="message-system">No caches loaded.</span>';

        const continuityLines = buildContinuityPostureLines({
            activeArchetype,
            runtimeProfile,
            responseDepth,
            loadoutFocus,
            loadedCaches: mergedLoadedCaches,
            activeThemes,
            rollingSummary,
        });
        continuityEl.innerHTML = continuityLines.map(line =>
            '<div class="forge-continuity-line">' + escapeHtml(line) + '</div>',
        ).join('');

        if (previewEl) {
            previewEl.textContent = formatForgeBootstrapPreview(sentinelData && sentinelData.markdown ? sentinelData.markdown : '');
        }
    } catch {
        if (hintEl) hintEl.innerHTML = '';
        if (summaryEl) summaryEl.innerHTML = '<span class="message-system error">Loadout summary unavailable.</span>';
        if (runtimeEl) runtimeEl.innerHTML = '<span class="message-system error">Runtime profile unavailable.</span>';
        if (postureEl) postureEl.innerHTML = '<span class="message-system error">Archetype posture unavailable.</span>';
        if (cacheEl) cacheEl.innerHTML = '<span class="message-system error">Loaded cache view unavailable.</span>';
        if (continuityEl) continuityEl.innerHTML = '<span class="message-system error">Continuity posture unavailable.</span>';
        if (previewEl) previewEl.textContent = 'Bootstrap preview unavailable.';
    }
}

/* ================================================================
   Context Memory Status
   ================================================================ */

async function loadContextMemoryStatus() {
    const el = document.getElementById('sys-context-maps-status');
    if (!el) return;

    el.innerHTML = '<span class="message-system">Loading…</span>';
    try {
        const res = await fetch('/api/status');
        const data = await res.json();
        const rbStatus = data.rollingBootstrapStatus || 'not generated';
        const memoryCompression = data.memoryCompression || {};
        const rows = [
            '<div class="system-row"><span class="system-key">Rolling Bootstrap</span><span class="system-val ' +
                (rbStatus === 'ready' ? 'ok' : 'warn') + '">' + escapeHtml(rbStatus) + '</span></div>',
            '<div class="system-row"><span class="system-key">Cache summaries</span><span class="system-val">' +
                escapeHtml(String(memoryCompression.cacheSummariesCount || 0)) + '</span></div>',
            '<div class="system-row"><span class="system-key">Document summaries</span><span class="system-val">' +
                escapeHtml(String(memoryCompression.documentSummariesCount || 0)) + '</span></div>',
            '<div class="system-row"><span class="system-key">Archetype memory profiles</span><span class="system-val">' +
                escapeHtml(String(memoryCompression.archetypeMemoryCount || 0)) + '</span></div>',
        ];
        el.innerHTML = rows.join('');
    } catch {
        el.innerHTML = '<span class="message-system">Context memory status unavailable.</span>';
    }
}

/* ================================================================
   Rolling Bootstrap Status
   ================================================================ */

async function loadBootstrapStatus() {
    const el = document.getElementById('sys-bootstrap-status');
    if (!el) return;

    el.innerHTML = '<span class="message-system">Loading…</span>';

    try {
        const res  = await fetch('/api/status');
        const data = await res.json();

        const rows = [];

        const rbStatus = data.rollingBootstrapStatus || 'not generated';

        rows.push(
            '<div class="system-row">' +
            '<span class="system-key">Status</span>' +
            '<span class="system-val ' + (rbStatus === 'ready' ? 'ok' : 'warn') + '">' +
            escapeHtml(rbStatus) + '</span></div>',
        );

        if (data.rollingBootstrapLastRefreshed) {
            const refreshed = new Date(data.rollingBootstrapLastRefreshed).toLocaleString();
            rows.push(
                '<div class="system-row">' +
                '<span class="system-key">Last refresh</span>' +
                '<span class="system-val">' + escapeHtml(refreshed) + '</span></div>',
            );
        }

        rows.push(
            '<div class="system-row">' +
            '<span class="system-key">Active themes</span>' +
            '<span class="system-val">' + escapeHtml(String(data.rollingBootstrapActiveThemesCount || 0)) + '</span></div>',
        );
        rows.push(
            '<div class="system-row">' +
            '<span class="system-key">Open questions</span>' +
            '<span class="system-val">' + escapeHtml(String(data.rollingBootstrapOpenQuestionsCount || 0)) + '</span></div>',
        );
        if (Array.isArray(data.rollingBootstrapThemes) && data.rollingBootstrapThemes.length > 0) {
            rows.push(
                '<div class="system-row">' +
                '<span class="system-key">Themes</span>' +
                '<span class="system-val">' + escapeHtml(data.rollingBootstrapThemes.slice(0, 5).join(', ')) + '</span></div>',
            );
        }
        rows.push(
            '<div class="system-row">' +
            '<span class="system-key">Loaded Caches</span>' +
            '<span class="system-val">' + escapeHtml(String(data.loadedCacheCount || 0)) + '</span></div>',
        );
        if (Array.isArray(data.cacheLoadout) && data.cacheLoadout.length > 0) {
            rows.push(
                '<div class="system-row">' +
                '<span class="system-key">Cache Loadout</span>' +
                '<span class="system-val">' + escapeHtml(data.cacheLoadout.slice(0, 5).join(', ')) + '</span></div>',
            );
        }
        rows.push(
            '<div class="system-row">' +
            '<span class="system-key">Forge v1.3</span>' +
            '<span class="system-val ' + (data.forgeLoaded ? 'ok' : 'warn') + '">' +
            (data.forgeLoaded ? 'loaded' : 'not found') + '</span></div>',
        );

        el.innerHTML = rows.join('');
    } catch {
        el.innerHTML = '<span class="message-system error">Could not load Rolling Bootstrap status.</span>';
    }
}

async function loadMemoryCompressionStatus() {
    const el = document.getElementById('sys-memory-compression-status');
    if (!el) return;
    el.innerHTML = '<span class="message-system">Loading…</span>';

    try {
        const res = await fetch('/api/status');
        const data = await res.json();
        const memory = data && data.memoryCompression ? data.memoryCompression : {};
        const rows = [
            ['Cache Summaries', (memory.cacheSummariesStatus || 'missing') + ' (' + String(memory.cacheSummariesCount || 0) + ')'],
            ['Document Summaries', (memory.documentSummariesStatus || 'missing') + ' (' + String(memory.documentSummariesCount || 0) + ')'],
            ['Archetype Memory', (memory.archetypeMemoryStatus || 'missing') + ' (' + String(memory.archetypeMemoryCount || 0) + ')'],
        ];
        el.innerHTML = rows.map(([k, v]) =>
            '<div class="system-row">' +
                '<span class="system-key">' + escapeHtml(k) + '</span>' +
                '<span class="system-val">' + escapeHtml(v) + '</span>' +
            '</div>'
        ).join('');
    } catch {
        el.innerHTML = '<span class="message-system error">Could not load Memory Compression status.</span>';
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
                    showFlashMessage('Rolling Bootstrap refreshed.');
                    loadBootstrapStatus();
                    loadLoadoutForgePanel();
                } else {
                    showFlashMessage('Rolling Bootstrap refresh failed.');
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

(function initMemoryCompressionButtons() {
    async function runRefresh(button, stage, doneLabel) {
        if (!button) return;
        button.disabled = true;
        const prior = button.textContent;
        button.textContent = 'Refreshing…';
        try {
            const res = await fetch('/api/system/memory-compression/refresh', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ stage }),
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'refresh failed');
            showFlashMessage(doneLabel);
            loadMemoryCompressionStatus();
        } catch {
            showFlashMessage('Memory Compression refresh failed.');
        } finally {
            button.disabled = false;
            button.textContent = prior;
        }
    }

    document.addEventListener('click', async (e) => {
        if (!e.target) return;
        if (e.target.id === 'sys-refresh-memory-compression-btn') {
            await runRefresh(e.target, 'all', 'Memory Compression refreshed.');
        }
        if (e.target.id === 'sys-refresh-document-summaries-btn') {
            await runRefresh(e.target, 'document_summaries', 'Document summaries refreshed.');
        }
        if (e.target.id === 'sys-refresh-cache-summaries-btn') {
            await runRefresh(e.target, 'cache_summaries', 'Cache summaries refreshed.');
        }
        if (e.target.id === 'sys-refresh-archetype-memory-btn') {
            await runRefresh(e.target, 'archetype_memory', 'Archetype memory refreshed.');
        }
    });
})();

(function initRollingBootstrapActions() {
    document.addEventListener('click', async (e) => {
        if (e.target && e.target.id === 'sys-ignite-loadout-btn') {
            const btn = e.target;
            btn.disabled = true;
            const previousText = btn.textContent;
            btn.textContent = 'Igniting…';
            try {
                const res = await fetch('/api/bootstrap/sentinel/ignite', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        responseDepth: getActiveResponseDepth(),
                        runtimeProfile: getActiveRuntimeProfile(),
                    }),
                });
                const data = await res.json();
                if (!res.ok || !data.success) {
                    throw new Error(data.error || 'Could not ignite Sentinel Loadout.');
                }
                showFlashMessage('Sentinel Loadout Bootstrap generated.');
                loadBootstrapStatus();
                loadLoadoutForgePanel();
            } catch (error) {
                showFlashMessage(error.message || 'Could not ignite Sentinel Loadout.');
            } finally {
                btn.disabled = false;
                btn.textContent = previousText;
            }
            return;
        }
        if (e.target && e.target.id === 'sys-open-bootstrap-json-btn') {
            window.open('/api/bootstrap/rolling', '_blank', 'noopener');
            return;
        }
        if (e.target && e.target.id === 'sys-copy-bootstrap-summary-btn') {
            try {
                const res = await fetch('/api/status');
                const data = await res.json();
                const summary = (data && data.rollingBootstrapSummary) ? String(data.rollingBootstrapSummary) : '';
                if (!summary) {
                    showFlashMessage('No Rolling Bootstrap summary available yet.');
                    return;
                }
                await navigator.clipboard.writeText(summary);
                showFlashMessage('Rolling Bootstrap summary copied.');
            } catch {
                showFlashMessage('Could not copy Rolling Bootstrap summary.');
            }
            return;
        }
        if (e.target && e.target.id === 'sys-export-bootstrap-md-btn') {
            try {
                const res = await fetch('/api/system/bootstrap/export-md');
                if (!res.ok) {
                    const payload = await res.json().catch(() => ({}));
                    throw new Error(payload.error || 'Could not export continuity bootstrap.');
                }
                const markdown = await res.text();
                downloadPlainText(
                    'ember-node-continuity-bootstrap.md',
                    markdown,
                    'text/markdown',
                );
                showFlashMessage('Continuity Bootstrap exported.');
            } catch (error) {
                showFlashMessage(error.message || 'Could not export continuity bootstrap.');
            }
            return;
        }
        if (e.target && e.target.id === 'sys-copy-sentinel-loadout-btn') {
            try {
                const res = await fetch('/api/bootstrap/sentinel');
                const data = await res.json();
                if (!res.ok || !data.success || !data.markdown) {
                    throw new Error(data.error || 'Sentinel Loadout Bootstrap not generated yet.');
                }
                await navigator.clipboard.writeText(String(data.markdown));
                showFlashMessage('Sentinel Loadout Bootstrap copied.');
            } catch (error) {
                showFlashMessage(error.message || 'Could not copy Sentinel Loadout Bootstrap.');
            }
            return;
        }
        if (e.target && e.target.id === 'sys-download-sentinel-loadout-btn') {
            try {
                const res = await fetch('/api/bootstrap/sentinel/download');
                if (!res.ok) {
                    const payload = await res.json().catch(() => ({}));
                    throw new Error(payload.error || 'Sentinel Loadout Bootstrap not generated yet.');
                }
                const markdown = await res.text();
                downloadPlainText(
                    'sentinel-loadout-bootstrap.md',
                    markdown,
                    'text/markdown',
                );
                showFlashMessage('Sentinel Loadout Bootstrap downloaded.');
            } catch (error) {
                showFlashMessage(error.message || 'Could not download Sentinel Loadout Bootstrap.');
            }
        }
    });
})();

(function initLoadoutForgeActions() {
    async function withButtonBusy(button, busyLabel, task) {
        if (!button) return;
        const prior = button.textContent;
        button.disabled = true;
        button.textContent = busyLabel;
        try {
            await task();
        } finally {
            button.disabled = false;
            button.textContent = prior;
        }
    }

    document.addEventListener('click', async (e) => {
        if (!e.target) return;

        if (e.target.id === 'sys-forge-refresh-preview-btn') {
            await withButtonBusy(e.target, 'Refreshing…', async () => {
                const res = await fetch('/api/bootstrap/refresh', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        responseDepth: getActiveResponseDepth(),
                        runtimeProfile: getActiveRuntimeProfile(),
                    }),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || data.error) {
                    throw new Error(data.error || 'Could not refresh preview.');
                }
                showFlashMessage('Loadout Forge preview refreshed.');
                loadBootstrapStatus();
                loadLoadoutForgePanel();
            }).catch(error => {
                showFlashMessage(error.message || 'Could not refresh preview.');
            });
            return;
        }

        if (e.target.id === 'sys-forge-ignite-loadout-btn') {
            await withButtonBusy(e.target, 'Igniting…', async () => {
                const res = await fetch('/api/bootstrap/sentinel/ignite', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        responseDepth: getActiveResponseDepth(),
                        runtimeProfile: getActiveRuntimeProfile(),
                    }),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || !data.success) {
                    throw new Error(data.error || 'Could not ignite Sentinel Loadout.');
                }
                showFlashMessage('Sentinel Loadout Bootstrap generated.');
                loadBootstrapStatus();
                loadLoadoutForgePanel();
            }).catch(error => {
                showFlashMessage(error.message || 'Could not ignite Sentinel Loadout.');
            });
            return;
        }

        if (e.target.id === 'sys-forge-copy-bootstrap-btn') {
            await withButtonBusy(e.target, 'Copying…', async () => {
                const res = await fetch('/api/bootstrap/sentinel');
                const data = await res.json().catch(() => ({}));
                if (!res.ok || !data.success || !data.markdown) {
                    throw new Error(data.error || 'Sentinel Loadout Bootstrap not generated yet.');
                }
                await navigator.clipboard.writeText(String(data.markdown));
                showFlashMessage('Sentinel Loadout Bootstrap copied.');
            }).catch(error => {
                showFlashMessage(error.message || 'Could not copy Sentinel Loadout Bootstrap.');
            });
            return;
        }

        if (e.target.id === 'sys-forge-download-bootstrap-btn') {
            await withButtonBusy(e.target, 'Downloading…', async () => {
                const res = await fetch('/api/bootstrap/sentinel/download');
                if (!res.ok) {
                    const payload = await res.json().catch(() => ({}));
                    throw new Error(payload.error || 'Sentinel Loadout Bootstrap not generated yet.');
                }
                const markdown = await res.text();
                downloadPlainText('sentinel-loadout-bootstrap.md', markdown, 'text/markdown');
                showFlashMessage('Sentinel Loadout Bootstrap downloaded.');
            }).catch(error => {
                showFlashMessage(error.message || 'Could not download Sentinel Loadout Bootstrap.');
            });
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
   Phase 7 — Runtime Registry: Discovery, Trust, Role, Heart
   ================================================================ */

/**
 * Fetch all AI runtimes from the registry.
 * @returns {Promise<{ runtimes: object[], active: object }>}
 */
async function fetchRuntimeRegistry() {
    const res  = await fetch('/api/runtimes');
    const data = await res.json();
    return { runtimes: data.runtimes || [], active: data.active || {} };
}

/**
 * Trigger a discovery scan.
 * @returns {Promise<{ runtimes: object[], active: object }>}
 */
async function scanRuntimes() {
    const res  = await fetch('/api/runtimes/scan', { method: 'POST' });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Scan failed');
    return { runtimes: data.runtimes || [], active: data.active || {} };
}

/** Status label for an AI runtime lifecycle state. */
function runtimeStatusLabel(tool) {
    if (tool.trusted && tool.role) return 'Assigned';
    if (tool.trusted)              return 'Admitted';
    if (tool.status === 'detected') return 'Waiting';
    return tool.status || 'Unknown';
}

/** CSS class for AI runtime status badge. */
function runtimeStatusClass(tool) {
    if (tool.trusted && tool.role) return 'indexed';
    if (tool.trusted)              return 'indexed';
    if (tool.status === 'detected') return 'waiting';
    return 'warn';
}

/** Running/offline badge HTML for an AI runtime. */
function runtimeRunningBadge(tool) {
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
 * Load and render the Threshold → AI runtime list.
 * Shows detected runtimes that are not yet trusted (excluding persistently rejected ones).
 */
async function loadThresholdRuntimes() {
    const listEl   = document.getElementById('th-runtime-list');
    const guideEl  = document.getElementById('th-ai-setup-guide');
    if (!listEl) return;
    listEl.innerHTML = '<span class="message-system">Loading…</span>';

    try {
        const { runtimes, active } = await fetchRuntimeRegistry();

        // Show all non-admitted detected runtimes (+ not_detected as dim)
        // Persistently rejected runtimes are shown as a separate dim section
        const pendingRuntimes = runtimes.filter(t => !t.trusted && (!t.intake || t.intake.state !== 'rejected'));
        const rejected = runtimes.filter(t => !t.trusted && t.intake && t.intake.state === 'rejected');

        // Show guided setup if no running runtimes at all
        const anyRunning = runtimes.some(t => t.running === true);
        if (guideEl) guideEl.style.display = anyRunning ? 'none' : 'flex';

        if (pendingRuntimes.length === 0 && rejected.length === 0) {
            listEl.innerHTML = '<span class="message-system">No pending runtimes. All detected runtimes have been admitted.</span>';
            return;
        }

        listEl.innerHTML = '';
        pendingRuntimes.forEach(tool => renderThresholdRuntimeRow(tool, active, listEl));

        if (rejected.length > 0) {
            const sep = document.createElement('div');
            sep.className   = 'threshold-section-header';
            sep.textContent = 'Rejected by stewardship (' + rejected.length + ')';
            listEl.appendChild(sep);
            rejected.forEach(tool => renderThresholdRuntimeRow(tool, active, listEl));
        }
        loadThresholdAiModelGuidance(runtimes);
    } catch {
        listEl.innerHTML = '<span class="message-system threshold-error">Could not load runtimes.</span>';
        loadThresholdAiModelGuidance([]);
    }
}

const THRESHOLD_AI_SUGGESTED_COMMANDS = [
    // Lightweight-to-mid local defaults that are broadly practical on consumer hardware.
    'ollama pull gemma3:4b',
    'ollama pull llama3.1:8b',
    'ollama pull mistral:7b',
    'ollama list',
].join('\n');

/** Load Ollama detection/model guidance in Threshold → AI. */
async function loadThresholdAiModelGuidance(runtimes) {
    const ollamaStatusEl = document.getElementById('th-ai-ollama-status');
    const modelsListEl = document.getElementById('th-ai-models-list');
    const selectedModelEl = document.getElementById('th-ai-selected-model');
    const commandsEl = document.getElementById('th-ai-suggested-commands');

    if (commandsEl && !commandsEl.textContent.trim()) {
        commandsEl.textContent = THRESHOLD_AI_SUGGESTED_COMMANDS;
    }

    const runtimeList = Array.isArray(runtimes) ? runtimes : [];
    const ollamaRuntime = runtimeList.find(t => t && t.id === 'ollama-local');
    const ollamaDetected = Boolean(
        ollamaRuntime &&
        ollamaRuntime.status &&
        ollamaRuntime.status !== 'not_detected' &&
        ollamaRuntime.status !== 'unknown',
    );
    if (ollamaStatusEl) {
        ollamaStatusEl.textContent = ollamaDetected ? 'Detected' : 'Not detected';
        ollamaStatusEl.className = ollamaDetected ? 'system-val ok' : 'system-val error';
    }
    if (modelsListEl) modelsListEl.textContent = 'loading…';
    if (selectedModelEl) selectedModelEl.textContent = '—';

    try {
        const res = await fetch('/api/ai/models');
        const data = await res.json();
        const modelNames = Array.isArray(data.models) ? data.models.map(m => m.name).filter(Boolean) : [];
        if (modelsListEl) {
            modelsListEl.textContent = modelNames.length > 0 ? modelNames.join(', ') : 'None detected';
        }
        if (selectedModelEl) {
            selectedModelEl.textContent = data.selected_model || '—';
        }
    } catch {
        if (modelsListEl) modelsListEl.textContent = 'Unavailable';
        if (selectedModelEl) selectedModelEl.textContent = 'Unavailable';
    }
}

function renderThresholdRuntimeRow(tool, active, container) {
    const row = document.createElement('div');
    row.className = 'threshold-file-row';
    row.dataset.runtimeId = tool.id;

    const intakeState = tool.intake && tool.intake.state;
    if (intakeState === 'rejected') row.className += ' intake-rejected';

    // Runtime last-seen timestamp
    const lastSeen = tool.lastSeen ? ' · last seen ' + new Date(tool.lastSeen).toLocaleString() : '';

    const nameEl = document.createElement('div');
    nameEl.style.cssText = 'flex:1; min-width:0;';
    nameEl.innerHTML =
        '<div class="threshold-file-name">' + escapeHtml(tool.name) +
            ' <span class="status-badge ' + runtimeStatusClass(tool) + '">' +
            escapeHtml(runtimeStatusLabel(tool)) + '</span>' +
            runtimeRunningBadge(tool) +
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
                await fetch('/api/runtimes/' + encodeURIComponent(tool.id) + '/inspect', { method: 'POST' });
            } catch { /* ignore */ }
            openRuntimeInspector(tool, active);
            loadThresholdRuntimes();
        });
        actions.appendChild(inspBtn);

        // Admit button (only for detected runtimes)
        if (tool.status === 'detected') {
            const trustBtn = document.createElement('button');
            trustBtn.className = 'primary threshold-action-btn';
            trustBtn.textContent = 'Admit';
            trustBtn.addEventListener('click', async () => {
                trustBtn.disabled = true;
                trustBtn.textContent = 'Admitting…';
                try {
                    const res  = await fetch('/api/runtimes/' + encodeURIComponent(tool.id) + '/admit', {
                        method:  'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body:    JSON.stringify({ trusted: true }),
                    });
                    const data = await res.json();
                    if (data.success) {
                        showFlashMessage(escapeHtml(tool.name) + ' admitted ✓ — now in Ember Council');
                        loadThresholdRuntimes();
                        loadCouncilArchetypes();
                        loadHearthRuntimeRegistry();
                    } else {
                        showFlashMessage('Admission failed: ' + (data.error || 'unknown'));
                        trustBtn.disabled = false;
                        trustBtn.textContent = 'Admit';
                    }
                } catch {
                    showFlashMessage('Could not reach server.');
                    trustBtn.disabled = false;
                    trustBtn.textContent = 'Admit';
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
        rejectBtn.title = 'Persistently reject — hides runtime from intake queue';
        rejectBtn.addEventListener('click', async () => {
            rejectBtn.disabled = true;
            try {
                await fetch('/api/runtimes/' + encodeURIComponent(tool.id) + '/reject', { method: 'POST' });
                showFlashMessage(escapeHtml(tool.name) + ' rejected.');
            } catch { /* ignore */ }
            loadThresholdRuntimes();
        });
        actions.appendChild(rejectBtn);
    } else {
        // Rejected — offer undo
        const undoBtn = document.createElement('button');
        undoBtn.className = 'secondary threshold-action-btn';
        undoBtn.textContent = 'Undo Reject';
        undoBtn.title = 'Restore runtime to intake queue';
        undoBtn.addEventListener('click', async () => {
            undoBtn.disabled = true;
            try {
                await fetch('/api/runtimes/' + encodeURIComponent(tool.id) + '/inspect', { method: 'POST' });
                showFlashMessage(escapeHtml(tool.name) + ' restored to intake.');
            } catch { /* ignore */ }
            loadThresholdRuntimes();
        });
        actions.appendChild(undoBtn);
    }

    row.appendChild(nameEl);
    row.appendChild(actions);
    container.appendChild(row);
}

/* Scan button in Threshold → AI */
(function initRuntimeScanBtn() {
    document.addEventListener('click', async e => {
        if (e.target && e.target.id === 'runtime-scan-btn') {
            const btn = e.target;
            btn.disabled = true;
            btn.textContent = '↺ Scanning…';
            try {
                await scanRuntimes();
                showFlashMessage('Scan complete.');
                loadThresholdRuntimes();
            } catch (err) {
                showFlashMessage('Scan failed: ' + err.message);
            } finally {
                btn.disabled = false;
                btn.textContent = '↺ Scan';
            }
        }
    });
})();

(function initThresholdAiGuidanceButtons() {
    document.addEventListener('click', async e => {
        if (!e.target) return;
        if (e.target.id === 'th-ai-refresh-models-btn') {
            const btn = e.target;
            btn.disabled = true;
            btn.textContent = 'Refreshing…';
            try {
                await loadThresholdRuntimes();
                showFlashMessage('Local model list refreshed.');
            } finally {
                btn.disabled = false;
                btn.textContent = 'Refresh Local Models';
            }
        }
        if (e.target.id === 'th-ai-open-ollama-btn') {
            window.open('https://ollama.com/download', '_blank', 'noopener,noreferrer');
        }
        if (e.target.id === 'th-ai-copy-commands-btn') {
            try {
                if (!navigator.clipboard || !navigator.clipboard.writeText) {
                    throw new Error('Clipboard API unavailable');
                }
                await navigator.clipboard.writeText(THRESHOLD_AI_SUGGESTED_COMMANDS);
                showFlashMessage('Suggested Ollama commands copied.');
            } catch {
                showFlashMessage('Could not copy commands.');
            }
        }
    });
})();

/* ── Ember Council / Sentinel Archetypes tab ────────────────── */

/**
 * Resolve a formatted archetype label for UI display.
 * @param {string|null} memberId
 * @returns {string}
 */
function getCourtMemberDisplayLabel(memberId) {
    if (!memberId || memberId === EMBER_PRIME_MEMBER_ID) return 'Ember Prime';
    const button = document.querySelector('#ws-court-list button[data-court-member="' + memberId + '"]');
    if (button) {
        const titleEl = button.querySelector('.threshold-file-name');
        if (titleEl && titleEl.textContent) return titleEl.textContent.trim();
    }
    const rune = COURT_MEMBER_RUNES[memberId] || '᛬';
    return rune + ' ' + memberId.charAt(0).toUpperCase() + memberId.slice(1);
}

/** Render Sentinel Archetypes (including Ember Prime) and active selection state. */
function renderEmberCourtMembers(court) {
    const listEl = document.getElementById('ws-court-list');
    const activeEl = document.getElementById('ws-court-active');
    if (!listEl) return;

    const members = Array.isArray(court && court.members) ? court.members : [];
    if (members.length === 0) {
        listEl.innerHTML = '<span class="message-system">No Ember Court members configured.</span>';
        if (activeEl) activeEl.textContent = 'Active archetype: Ember Prime';
        updateCouncilChatActiveArchetype();
        return;
    }

    const configuredDefault = normalizeCourtMemberId(court && court.defaultMember);
    const persistedMember = getActiveCourtMemberId();
    const firstMemberId = normalizeCourtMemberId(members[0] && members[0].id);
    const activeMemberId = persistedMember || configuredDefault || firstMemberId || EMBER_PRIME_MEMBER_ID;
    setActiveCourtMemberId(activeMemberId);

    listEl.innerHTML = '';

    const emberPrimeButton = document.createElement('button');
    emberPrimeButton.className = activeMemberId === EMBER_PRIME_MEMBER_ID ? 'primary threshold-file-row' : 'secondary threshold-file-row';
    emberPrimeButton.type = 'button';
    emberPrimeButton.dataset.courtMember = EMBER_PRIME_MEMBER_ID;
    emberPrimeButton.setAttribute('aria-pressed', String(activeMemberId === EMBER_PRIME_MEMBER_ID));
    emberPrimeButton.style.cssText = 'display:flex; flex-direction:column; align-items:flex-start; gap:0.25rem; width:100%; text-align:left;';
    emberPrimeButton.innerHTML =
        '<span class="threshold-file-name">Ember Prime</span>' +
        '<span class="source-card-filename">No archetype lens</span>' +
        '<span class="source-card-description">Use baseline Ember Prime response behavior.</span>';
    emberPrimeButton.addEventListener('click', () => {
        setActiveCourtMemberId(EMBER_PRIME_MEMBER_ID);
        renderEmberCourtMembers(court);
        showFlashMessage('Active archetype: Ember Prime');
    });
    listEl.appendChild(emberPrimeButton);

    members.forEach(member => {
        const memberId = normalizeCourtMemberId(member.id);
        const rune = COURT_MEMBER_RUNES[memberId] || '᛬';
        const button = document.createElement('button');
        button.className = memberId === activeMemberId ? 'primary threshold-file-row' : 'secondary threshold-file-row';
        button.type = 'button';
        button.dataset.courtMember = memberId || '';
        button.setAttribute('aria-pressed', String(memberId === activeMemberId));
        button.style.cssText = 'display:flex; flex-direction:column; align-items:flex-start; gap:0.25rem; width:100%; text-align:left;';
        button.innerHTML =
            '<span class="threshold-file-name">' + escapeHtml(rune + ' ' + (member.name || member.id || 'Court Member')) + '</span>' +
            '<span class="source-card-filename">Role: ' + escapeHtml(member.role || '—') + '</span>' +
            '<span class="source-card-description">' + escapeHtml(member.shortDescription || '—') + '</span>' +
            '<span class="message-system">Domains: ' + escapeHtml((member.primaryDomains || []).join(', ') || '—') + '</span>' +
            '<span class="message-system">Sources: ' + escapeHtml((member.preferredSources || []).join(', ') || '—') + '</span>' +
            '<span class="message-system">Voice: ' + escapeHtml(member.toneCadence || member.tone || '—') + '</span>';
        button.addEventListener('click', () => {
            if (!memberId) return;
            setActiveCourtMemberId(memberId);
            renderEmberCourtMembers(court);
            const memberLabel = rune + ' ' + (member.name || memberId);
            showFlashMessage('Active archetype set to ' + memberLabel + ' ✓');
        });
        listEl.appendChild(button);
    });

    const activeMember = members.find(m => normalizeCourtMemberId(m.id) === activeMemberId) || null;
    if (activeEl) {
        if (activeMemberId === EMBER_PRIME_MEMBER_ID || !activeMember) {
            activeEl.textContent = 'Active archetype: Ember Prime';
        } else {
            const normalizedActiveId = normalizeCourtMemberId(activeMember.id);
            const rune = COURT_MEMBER_RUNES[normalizedActiveId] || '᛬';
            activeEl.textContent = 'Active archetype: ' + rune + ' ' + (activeMember.name || activeMember.id);
        }
    }
    updateCouncilChatActiveArchetype();
}

/**
 * Load and render the Ember Council → Sentinel Archetypes panel.
 */
async function loadCouncilArchetypes() {
    const listEl = document.getElementById('ws-court-list');
    if (!listEl) return;
    listEl.innerHTML = '<span class="message-system">Loading archetypes…</span>';
    const activeEl = document.getElementById('ws-court-active');
    if (activeEl) activeEl.textContent = 'Loading archetype selection…';

    try {
        const res = await fetch('/api/court');
        const data = await res.json();
        renderEmberCourtMembers(data && data.court ? data.court : null);
    } catch {
        listEl.innerHTML = '<span class="message-system">Could not load archetypes.</span>';
        if (activeEl) activeEl.textContent = 'Active archetype: Ember Prime';
        updateCouncilChatActiveArchetype();
    }
}

/* ── Hearth / System: Ember Prime Assignment ─────────────────── */

/**
 * Load the Ember Prime assignment UI in the Hearth → System tab.
 */
async function loadHearthRuntimeRegistry() {
    const listEl   = document.getElementById('sys-heart-list');
    const emptyEl  = document.getElementById('sys-heart-empty');
    const activeEl = document.getElementById('sys-active-heart');
    if (!listEl) return;

    try {
        const { runtimes, active } = await fetchRuntimeRegistry();
        const trusted = runtimes.filter(t => t.trusted);

        if (emptyEl) emptyEl.style.display = trusted.length === 0 ? '' : 'none';

        // Remove previous runtime rows
        listEl.querySelectorAll('.heart-runtime-row').forEach(el => el.remove());

        const currentHeart = active && active.heart;
        if (activeEl) activeEl.textContent = currentHeart
            ? (runtimes.find(t => t.id === currentHeart) || {}).name || currentHeart
            : '—';

        trusted.forEach(tool => {
            const row = document.createElement('div');
            row.className = 'heart-runtime-row system-row';
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
                    const res  = await fetch('/api/runtimes/active', {
                        method:  'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body:    JSON.stringify({ heart: heartId }),
                    });
                    const data = await res.json();
                    if (data.success) {
                        showFlashMessage(heartId
                            ? escapeHtml(tool.name) + ' is now active as Ember Prime ✓'
                            : 'Ember Prime assignment cleared.');
                        loadHearthRuntimeRegistry();
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
        if (listEl) listEl.innerHTML += '<span class="message-system">Could not load runtime stewardship registry.</span>';
    }
}

/* ── AI Runtime Inspector Modal ───────────────────────────────── */

function closeRuntimeInspector() {
    const overlay = document.getElementById('runtime-inspector-overlay');
    if (overlay) overlay.style.display = 'none';
}

function openRuntimeInspector(tool, active) {
    const overlay = document.getElementById('runtime-inspector-overlay');
    if (!overlay) return;

    const isHeart = active && active.heart === tool.id;

    const set = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text || '—';
    };

    const titleEl = document.getElementById('runtime-insp-title');
    if (titleEl) titleEl.textContent = tool.name || 'AI Runtime Inspector';

    const statusEl = document.getElementById('runtime-insp-status');
    if (statusEl) {
        statusEl.innerHTML =
            '<span class="status-badge ' + runtimeStatusClass(tool) + '">' +
            escapeHtml(runtimeStatusLabel(tool)) + '</span>' +
            (isHeart ? ' <span class="status-badge remembered">Active Ember Prime</span>' : '');
    }

    set('runtime-insp-type',      tool.type);
    set('runtime-insp-interface', tool.interface);
    set('runtime-insp-endpoint',  tool.endpoint || '(none)');
    set('runtime-insp-role',      tool.role ? roleLabel(tool.role) : 'None');
    set('runtime-insp-trust',     tool.trusted ? 'Admitted' : 'Pending');
    set('runtime-insp-lastseen',  tool.lastSeen || '—');

    const runningEl = document.getElementById('runtime-insp-running');
    if (runningEl) {
        if (tool.status === 'not_detected' || tool.status === 'unknown') {
            runningEl.textContent = '—';
        } else if (tool.running === true) {
            runningEl.innerHTML = '<span class="status-badge running">Running</span>';
        } else {
            runningEl.innerHTML = '<span class="status-badge offline">Offline</span>';
        }
    }

    const actEl = document.getElementById('runtime-insp-actions');
    if (actEl) {
        actEl.innerHTML = '';
        const actions = [];

        if (!tool.trusted && tool.status === 'detected') {
            actions.push({
                label: 'Admit Runtime',
                primary: true,
                fn: async () => {
                    try {
                        const res  = await fetch('/api/runtimes/' + encodeURIComponent(tool.id) + '/admit', {
                            method:  'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body:    JSON.stringify({ trusted: true }),
                        });
                        const data = await res.json();
                        if (data.success) {
                            closeRuntimeInspector();
                            showFlashMessage(escapeHtml(tool.name) + ' admitted ✓');
                            loadThresholdRuntimes();
                            loadCouncilArchetypes();
                            loadHearthRuntimeRegistry();
                        } else {
                            showFlashMessage('Admission failed: ' + (data.error || 'unknown'));
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
                        const res  = await fetch('/api/runtimes/active', {
                            method:  'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body:    JSON.stringify({ heart: tool.id }),
                        });
                        const data = await res.json();
                        if (data.success) {
                            closeRuntimeInspector();
                            showFlashMessage(escapeHtml(tool.name) + ' is now active as Ember Prime ✓');
                            loadHearthRuntimeRegistry();
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
                    closeRuntimeInspector();
                    await launchOllama(tool.id);
                },
            });
        }

        // Test connection action for detected runtimes with an endpoint
        if (tool.status === 'detected' && tool.endpoint) {
            actions.push({
                label: 'Test Connection',
                primary: false,
                fn: async () => {
                    showFlashMessage('Testing connection to ' + tool.name + '…');
                    try {
                        await fetch('/api/runtimes/scan', { method: 'POST' });
                        showFlashMessage('Scan complete — check runtime status.');
                        closeRuntimeInspector();
                        loadThresholdRuntimes();
                        loadCouncilArchetypes();
                    } catch {
                        showFlashMessage('Could not reach server.');
                    }
                },
            });
        }

        actions.push({ label: 'Close', primary: false, fn: closeRuntimeInspector });

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

// Close runtime inspector on overlay click or close button
(function initRuntimeInspector() {
    const closeBtn = document.getElementById('runtime-insp-close');
    const overlay  = document.getElementById('runtime-inspector-overlay');
    if (closeBtn) closeBtn.addEventListener('click', closeRuntimeInspector);
    if (overlay) {
        overlay.addEventListener('click', e => {
            if (e.target === overlay) closeRuntimeInspector();
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
        const st = source.status || (source.room === 'hearth' ? 'remembered' : source.room === 'council' ? 'indexed' : 'waiting');
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
        actions.push({ label: '→ Council Drafts', fn: () => { closeInspector(); sendSourceToCouncilDrafts(source); } });

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
 * Insert a labeled reference block for the source into Council Drafts.
 * Appends to existing content — does not overwrite.
 */
function sendSourceToCouncilDrafts(source) {
    // Switch to Ember Council > Drafts
    const councilTab  = document.querySelector('.room-tab[data-room="council"]');
    if (councilTab) councilTab.click();
    const notepadTab   = document.querySelector('.sub-tab[data-subtab="ws-drafts"]');
    if (notepadTab) notepadTab.click();

    const draftArea = document.getElementById('council-draft');
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
    showFlashMessage('Reference inserted into Drafts');
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
   Phase 8 — Startup Checklist, Airlock UI, AI Setup Readiness
   ================================================================ */

/**
 * Fetch the startup check summary and render the launch banner.
 * Dismissible for the session; collapses on toggle.
 */
function normalizeStartupRuntimeState(data) {
    return {
        newRuntimes: Number(data && data.newRuntimes) || 0,
        runningRuntimes: Number(data && data.runningRuntimes) || 0,
        offlineRuntimes: Number(data && data.offlineRuntimes) || 0,
        activeRuntime: data ? data.activeRuntime : null,
        activeRuntimeAvailable: Boolean(data && data.activeRuntimeAvailable),
    };
}

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
        const {
            newRuntimes,
            runningRuntimes,
            offlineRuntimes,
            activeRuntime,
            activeRuntimeAvailable,
        } = normalizeStartupRuntimeState(data);

        // ── Top-line summary ────────────────────────────────────────
        const summaryParts = [];
        const totalIntake  = (data.waitingFiles || 0) + (data.changedFiles || 0) + (data.flaggedFiles || 0);
        summaryParts.push('Node awakened');
        if (activeRuntime && activeRuntimeAvailable) {
            summaryParts.push('Ember Prime ready');
        } else if (activeRuntime && !activeRuntimeAvailable) {
            summaryParts.push('Ember Prime offline');
        } else {
            summaryParts.push('no Ember Prime set');
        }
        if (totalIntake > 0) summaryParts.push(totalIntake + ' file' + (totalIntake === 1 ? '' : 's') + ' awaiting review');
        if (offlineRuntimes > 0) summaryParts.push(offlineRuntimes + ' AI offline');
        if (newRuntimes > 0) summaryParts.push(newRuntimes + ' new runtime' + (newRuntimes === 1 ? '' : 's') + ' detected');

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

        // ── AI Setup group ───────────────────────────────────────────
        if (runningRuntimes > 0) {
            stats.push({ label: 'runtimes online', value: runningRuntimes, style: 'ok', group: 'AI Setup' });
        }
        if (offlineRuntimes > 0) {
            stats.push({ label: 'runtimes offline', value: offlineRuntimes, style: 'error', group: 'AI Setup' });
        }
        if (newRuntimes > 0) {
            stats.push({ label: 'new runtimes detected', value: newRuntimes, style: 'warn', group: 'AI Setup' });
        }

        // Active Ember Prime
        const noHeart = !activeRuntime;
        if (activeRuntime) {
            stats.push({
                label: 'ember prime',
                value: activeRuntime + (activeRuntimeAvailable ? ' ✓' : ' (offline)'),
                style: activeRuntimeAvailable ? 'ok' : 'error',
                group: 'AI Setup',
            });
        } else {
            stats.push({ label: 'ember prime', value: 'none set', style: 'zero', group: 'AI Setup' });
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
        const { activeRuntime } = normalizeStartupRuntimeState(data);
        const warnings = [...(data.warnings || [])];
        if (!activeRuntime) warnings.unshift('No active Ember Prime detected — Recommended local AI: Ollama');
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

    const {
        newRuntimes,
        runningRuntimes,
        offlineRuntimes,
        activeRuntime,
        activeRuntimeAvailable,
    } = normalizeStartupRuntimeState(data);

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
            title: 'AI Setup',
            rows: [
                { key: 'New runtimes',      val: newRuntimes },
                { key: 'Running runtimes',  val: runningRuntimes },
                { key: 'Offline runtimes',  val: offlineRuntimes },
                { key: 'Active Ember Prime', val: activeRuntime || '—' },
                { key: 'Ember Prime ready',  val: activeRuntime ? (activeRuntimeAvailable ? 'yes' : 'offline') : '—' },
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
        const reviewRuntimesBtn = document.getElementById('sb-review-runtimes');
        const openSystemBtn = document.getElementById('sb-open-system');
        const firstEmberBtn = document.getElementById('sb-first-ember');

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
                openRoomAndSubtab('threshold', 'th-imports');
                if (banner) banner.style.display = 'none';
            });
        }

        if (reviewRuntimesBtn) {
            reviewRuntimesBtn.addEventListener('click', () => {
                openRoomAndSubtab('threshold', 'th-ai');
                if (banner) banner.style.display = 'none';
            });
        }

        if (openSystemBtn) {
            openSystemBtn.addEventListener('click', () => {
                openRoomAndSubtab('hearth', 'hearth-system');
                if (banner) banner.style.display = 'none';
            });
        }

        if (firstEmberBtn) {
            firstEmberBtn.addEventListener('click', () => {
                openFirstEmberOverlay();
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

        const firstEmberOverlay = document.getElementById('first-ember-overlay');
        const firstEmberClose = document.getElementById('first-ember-close');
        const firstEmberGoThreshold = document.getElementById('first-ember-go-threshold');
        const firstEmberGoCaches = document.getElementById('first-ember-go-caches');
        const firstEmberGoForge = document.getElementById('first-ember-go-forge');
        const firstEmberGoChat = document.getElementById('first-ember-go-chat');

        if (firstEmberClose) {
            firstEmberClose.addEventListener('click', closeFirstEmberOverlay);
        }
        if (firstEmberOverlay) {
            firstEmberOverlay.addEventListener('click', e => {
                if (e.target === firstEmberOverlay) closeFirstEmberOverlay();
            });
        }
        if (firstEmberGoThreshold) {
            firstEmberGoThreshold.addEventListener('click', () => {
                closeFirstEmberOverlay();
                openRoomAndSubtab('threshold', 'th-imports');
            });
        }
        if (firstEmberGoCaches) {
            firstEmberGoCaches.addEventListener('click', () => {
                closeFirstEmberOverlay();
                openRoomAndSubtab('council', 'ws-caches');
            });
        }
        if (firstEmberGoForge) {
            firstEmberGoForge.addEventListener('click', () => {
                closeFirstEmberOverlay();
                openRoomAndSubtab('hearth', 'hearth-system');
            });
        }
        if (firstEmberGoChat) {
            firstEmberGoChat.addEventListener('click', () => {
                closeFirstEmberOverlay();
                openRoomAndSubtab('council', 'ws-council-chat');
            });
        }

        const sysSentinelTrialsOpenBtn = document.getElementById('sys-sentinel-trials-open-btn');
        const sysSentinelTrialsResetBtn = document.getElementById('sys-sentinel-trials-reset-btn');
        if (sysSentinelTrialsOpenBtn) {
            sysSentinelTrialsOpenBtn.addEventListener('click', openSentinelTrials);
        }
        if (sysSentinelTrialsResetBtn) {
            sysSentinelTrialsResetBtn.addEventListener('click', resetSentinelTrialsState);
        }

        const sysSignalThreadsOpenBtn = document.getElementById('sys-signal-threads-open-btn');
        const sysSignalThreadsNewBtn = document.getElementById('sys-signal-threads-new-btn');
        if (sysSignalThreadsOpenBtn) {
            sysSignalThreadsOpenBtn.addEventListener('click', async () => {
                openSignalThreadsOverlay();
                await refreshSignalThreadsOverlay({ createNew: false });
            });
        }
        if (sysSignalThreadsNewBtn) {
            sysSignalThreadsNewBtn.addEventListener('click', async () => {
                openSignalThreadsOverlay();
                await refreshSignalThreadsOverlay({ createNew: true });
            });
        }

        const sysSagaSmithOpenBtn = document.getElementById('sys-saga-smith-open-btn');
        if (sysSagaSmithOpenBtn) {
            sysSagaSmithOpenBtn.addEventListener('click', async () => {
                openSagaSmithOverlay();
                await refreshSagaSmithOverlay();
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
 * Shows progress feedback and re-loads runtime list on completion.
 */
async function launchOllama(runtimeId) {
    showFlashMessage('Attempting to launch Ollama…');
    try {
        const res  = await fetch('/api/runtimes/' + encodeURIComponent(runtimeId) + '/launch', {
            method: 'POST',
        });
        const data = await res.json();
        if (data.success) {
            showFlashMessage(data.message || 'Ollama started ✓');
        } else {
            showFlashMessage(data.message || 'Launch failed — try: ollama serve');
        }
        loadThresholdRuntimes();
        loadCouncilArchetypes();
        loadHearthRuntimeRegistry();
    } catch {
        showFlashMessage('Could not reach server.');
    }
}

/* ================================================================
   Initialisation
   ================================================================ */

(function init() {
    updateHeaderStatus();
    // Local-data reads only on ordinary startup. Hosted Archive package
    // index / cache-update / signal requests and the Node update-check are
    // intentionally not triggered here — see initSubTabs (hearth-archive,
    // hearth-system) and the explicit refresh buttons.
    loadHearthThreads();
    loadHearthArchive();
    loadHearthTrustedArchive();
    loadHearthRememberedThreads();
    loadStartupCheck();
    updateCouncilChatActiveArchetype();
    loadSentinelTrials();
    loadSignalThreadsSummary();

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

    const signalOverlay = document.getElementById('signal-threads-overlay');
    const signalClose = document.getElementById('signal-threads-close');
    if (signalClose) signalClose.addEventListener('click', closeSignalThreadsOverlay);
    if (signalOverlay) {
        signalOverlay.addEventListener('click', e => {
            if (e.target === signalOverlay) closeSignalThreadsOverlay();
        });
    }

    const signalNewBtn = document.getElementById('signal-threads-new-btn');
    if (signalNewBtn) {
        signalNewBtn.addEventListener('click', async () => {
            await refreshSignalThreadsOverlay({ createNew: true });
        });
    }

    const signalSaveBtn = document.getElementById('signal-thread-save-btn');
    if (signalSaveBtn) signalSaveBtn.addEventListener('click', saveActiveSignalThread);

    const signalSaveCycleBtn = document.getElementById('signal-thread-save-cycle-btn');
    if (signalSaveCycleBtn) signalSaveCycleBtn.addEventListener('click', saveSignalThreadWorkspaceCycle);

    function _bindCycleHotkey(el) {
        if (!el) return;
        el.addEventListener('keydown', e => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') saveSignalThreadWorkspaceCycle();
        });
    }

    _bindCycleHotkey(document.getElementById('signal-thread-cycle-observation-input'));
    _bindCycleHotkey(document.getElementById('signal-thread-cycle-reflection-input'));

    const signalDeleteBtn = document.getElementById('signal-thread-delete-btn');
    if (signalDeleteBtn) signalDeleteBtn.addEventListener('click', deleteActiveSignalThread);

    const signalExportBtn = document.getElementById('signal-thread-export-btn');
    if (signalExportBtn) signalExportBtn.addEventListener('click', exportActiveSignalThread);

    const signalCopyBriefBtn = document.getElementById('signal-thread-copy-brief-btn');
    if (signalCopyBriefBtn) signalCopyBriefBtn.addEventListener('click', copyActiveSignalThreadBrief);

    const addReflectionBtn = document.getElementById('signal-thread-add-reflection-btn');
    if (addReflectionBtn) addReflectionBtn.addEventListener('click', addReflectionToActiveThread);

    const addObservationBtn = document.getElementById('signal-thread-add-observation-btn');
    if (addObservationBtn) addObservationBtn.addEventListener('click', addObservationToActiveThread);

    const sagaOverlay = document.getElementById('saga-smith-overlay');
    const sagaClose = document.getElementById('saga-smith-close');
    if (sagaClose) sagaClose.addEventListener('click', closeSagaSmithOverlay);
    if (sagaOverlay) {
        sagaOverlay.addEventListener('click', e => {
            if (e.target === sagaOverlay) closeSagaSmithOverlay();
        });
    }

    const sagaThreadSelect = document.getElementById('saga-smith-thread-select');
    if (sagaThreadSelect) {
        sagaThreadSelect.addEventListener('change', async () => {
            await setSagaSmithActiveThread(sagaThreadSelect.value);
        });
    }

    const sagaOpenThreadsBtn = document.getElementById('saga-smith-open-threads-btn');
    if (sagaOpenThreadsBtn) {
        sagaOpenThreadsBtn.addEventListener('click', async () => {
            closeSagaSmithOverlay();
            openSignalThreadsOverlay();
            await refreshSignalThreadsOverlay({ createNew: false });
        });
    }

    const sagaCreateThreadBtn = document.getElementById('saga-smith-create-thread-btn');
    if (sagaCreateThreadBtn) {
        sagaCreateThreadBtn.addEventListener('click', async () => {
            closeSagaSmithOverlay();
            openSignalThreadsOverlay();
            await refreshSignalThreadsOverlay({ createNew: true });
        });
    }

    const sagaSaveBtn = document.getElementById('saga-smith-save-btn');
    if (sagaSaveBtn) sagaSaveBtn.addEventListener('click', saveSagaSmithCycle);

    // Chat refs clear button
    const clearRefsBtn = document.getElementById('clear-chat-refs');
    if (clearRefsBtn) {
        clearRefsBtn.addEventListener('click', () => {
            _chatRefs = [];
            updateChatRefsBar();
        });
    }

    const wsFirstEmberBtn = document.getElementById('ws-first-ember-btn');
    if (wsFirstEmberBtn) {
        wsFirstEmberBtn.addEventListener('click', openFirstEmberOverlay);
    }
    initRuntimeTuningBench();
    initFirstEmberHintsDismissal();
})();

/* ================================================================
   Phase 18A — Instrument Panel
   Observe → Reflect → Act → Refine → Remember
   ================================================================ */

(function initInstrumentPanel() {

    // ── Constants ───────────────────────────────────────────────────────────

    const IP_STAGES = ['observe', 'reflect', 'act', 'refine', 'remember'];
    const IP_UNTITLED_THREAD = 'Untitled Signal Thread';

    const IP_STAGE_LABELS = Object.freeze({
        observe: 'OBSERVE',
        reflect: 'REFLECT',
        act:     'ACT',
        refine:  'REFINE',
        remember: 'REMEMBER',
    });

    const IP_STAGE_QUESTIONS = Object.freeze({
        observe: [
            'What are you noticing?',
            'What is happening?',
            'What is known?',
            'What is uncertain?',
        ],
        reflect: [
            'Why does this matter?',
            'What assumptions are present?',
            'What perspectives should be considered?',
        ],
        act: [
            'What is the next useful step?',
            'What can be tested?',
            'What should be avoided?',
        ],
        refine: [
            'What happened?',
            'What worked?',
            'What changed?',
            'What was learned?',
        ],
        remember: [
            'What should be remembered?',
            'What remains unresolved?',
            'What is worth carrying forward?',
        ],
    });

    // ── State ────────────────────────────────────────────────────────────────

    let _activeSession = null;   // full session object currently loaded
    let _activeThreadDetailId = null;
    let _ipView = 'home';        // 'home' | 'session' | 'list' | 'threads' | 'thread-detail'
    let _aiAssistActive = false;
    let _newSessionThreadSnapshot = [];

    // ── Element refs (resolved lazily) ───────────────────────────────────────

    function $ip(id) { return document.getElementById(id); }

    // ── Utility ──────────────────────────────────────────────────────────────

    function _fmtDate(isoStr) {
        if (!isoStr) return '';
        try {
            return new Date(isoStr).toLocaleDateString(undefined, {
                year: 'numeric', month: 'short', day: 'numeric',
            });
        } catch {
            return String(isoStr).slice(0, 10);
        }
    }

    function _setStatus(msg, clear) {
        const el = $ip('ip-stage-status');
        if (!el) return;
        el.textContent = msg;
        if (clear) setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 2400);
    }

    function _setArchiveMsg(msg) {
        const el = $ip('ip-archive-status-msg');
        if (el) el.textContent = msg;
    }

    function _clipLine(text, max = 120) {
        const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
        if (!cleaned) return '';
        return cleaned.length > max ? (cleaned.slice(0, max).trimEnd() + '…') : cleaned;
    }

    function _clipSentences(text, maxSentences = 3, maxChars = 260) {
        const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
        if (!cleaned) return '';
        const parts = cleaned
            .split(/(?<=[.!?])\s+/)
            .map(part => part.trim())
            .filter(Boolean);
        const clipped = (parts.length ? parts : [cleaned]).slice(0, Math.max(1, maxSentences)).join(' ').trim();
        return clipped.length > maxChars ? (clipped.slice(0, maxChars).trimEnd() + '…') : clipped;
    }

    function _setArchiveState({
        carryForwardRecorded = false,
        threadUpdated = false,
        openPressuresUpdated = false,
    } = {}) {
        const carryEl = $ip('ip-archive-carry-forward-state');
        const threadEl = $ip('ip-archive-thread-update-state');
        const pressureEl = $ip('ip-archive-open-pressure-state');
        if (carryEl) carryEl.textContent = carryForwardRecorded ? 'Carry Forward Recorded' : 'Carry Forward Pending';
        if (threadEl) threadEl.textContent = threadUpdated ? 'Thread Updated' : 'Thread Update Pending';
        if (pressureEl) pressureEl.textContent = openPressuresUpdated ? 'Open Pressures Updated' : 'Open Pressures Pending';
    }

    function _readArchiveContinuityInputs() {
        const pressureEl = $ip('ip-archive-open-pressure-input');
        const carryEl = $ip('ip-archive-carry-forward-input');
        return {
            openPressure: pressureEl ? String(pressureEl.value || '').trim() : '',
            carryForward: carryEl ? String(carryEl.value || '').trim() : '',
        };
    }

    // ── View switcher ─────────────────────────────────────────────────────────

    function _showView(view) {
        _ipView = view;
        const home    = $ip('ip-home');
        const session = $ip('ip-session-view');
        const list    = $ip('ip-sessions-list-view');
        const threads = $ip('ip-threads-list-view');
        const detail  = $ip('ip-thread-detail-view');
        if (home)    home.style.display    = view === 'home'    ? '' : 'none';
        if (session) session.style.display = view === 'session' ? '' : 'none';
        if (list)    list.style.display    = view === 'list'    ? '' : 'none';
        if (threads) threads.style.display = view === 'threads' ? '' : 'none';
        if (detail)  detail.style.display  = view === 'thread-detail' ? '' : 'none';
    }

    // ── AI status indicator ───────────────────────────────────────────────────
    // Uses the canonical /api/status endpoint (Phase 20A / build v118).
    // AI unavailability must never make the Ember Node itself appear
    // unavailable — a failed fetch or non-OK response means the Node is
    // unreachable. A successful response is further distinguished by both
    // aiRuntimeReachable and aiModelAvailable so "Ollama running but wrong
    // model" is never conflated with "Ollama not running at all".

    async function _refreshAiStatus() {
        const el = $ip('ip-ai-status');
        if (!el) return;
        try {
            const res = await fetch('/api/status');
            if (!res.ok) { el.textContent = 'Node unavailable'; el.className = 'ip-status-val off'; return; }
            const data = await res.json().catch(() => ({}));
            const runtimeReachable = Boolean(data && data.aiRuntimeReachable);
            const modelAvailable   = Boolean(data && data.aiModelAvailable);
            if (!runtimeReachable) {
                el.textContent = 'AI offline';
                el.className = 'ip-status-val off';
            } else if (!modelAvailable) {
                el.textContent = 'Model missing';
                el.className = 'ip-status-val warn';
            } else {
                el.textContent = 'Ready';
                el.className = 'ip-status-val ok';
            }
        } catch {
            el.textContent = 'Node unavailable';
            el.className = 'ip-status-val off';
        }
    }

    // ── Stage progress render ─────────────────────────────────────────────────

    function _renderStageBar(currentStage, entries) {
        const container = $ip('ip-stage-steps');
        if (!container) return;
        container.innerHTML = '';
        const completedStages = new Set((entries || []).filter(e => e.completedAt).map(e => e.stage));
        IP_STAGES.forEach(stage => {
            const span = document.createElement('span');
            const label = IP_STAGE_LABELS[stage] || stage;
            span.setAttribute('role', 'listitem');
            if (stage === currentStage) {
                span.className = 'ip-stage-step active';
                span.textContent = label;
            } else if (completedStages.has(stage)) {
                span.className = 'ip-stage-step done';
                span.textContent = '✓ ' + label;
            } else {
                span.className = 'ip-stage-step';
                span.textContent = label;
            }
            container.appendChild(span);
        });
    }

    // ── Stage questions render ───────────────────────────────────────────────

    function _renderStageQuestions(stage) {
        const container = $ip('ip-stage-questions');
        if (!container) return;
        const questions = IP_STAGE_QUESTIONS[stage] || [];
        container.innerHTML = '';
        questions.forEach(q => {
            const div = document.createElement('div');
            div.textContent = q;
            container.appendChild(div);
        });
    }

    // ── Load session into view ────────────────────────────────────────────────

    function _loadSessionView(session) {
        _activeSession = session;
        const stage = session.currentStage || 'observe';

        // Stage label
        const labelEl = $ip('ip-stage-label');
        if (labelEl) labelEl.textContent = IP_STAGE_LABELS[stage] || stage.toUpperCase();

        // Session title
        const titleEl = $ip('ip-session-title-display');
        if (titleEl) titleEl.textContent = session.title || 'Session';

        // Stage bar
        _renderStageBar(stage, session.entries);

        // Questions
        _renderStageQuestions(stage);

        // Pre-fill existing notes
        const notesEl = $ip('ip-stage-notes');
        if (notesEl) {
            const existingEntry = (session.entries || []).find(e => e.stage === stage);
            notesEl.value = existingEntry ? (existingEntry.notes || '') : '';
        }

        // Hide AI response if visible
        const aiResp = $ip('ip-ai-response');
        if (aiResp) aiResp.style.display = 'none';

        const aiStatus = $ip('ip-ai-assist-status');
        if (aiStatus) aiStatus.textContent = '';

        if (session && session.continuity && session.continuity.threadId) {
            _setStatus('Continuing: ' + (session.continuity.threadTitle || session.continuity.threadId));
        }

        // Remember actions
        const archiveActions = $ip('ip-archive-actions');
        if (archiveActions) {
            archiveActions.style.display = stage === 'remember' ? '' : 'none';
            if (stage === 'remember') {
                _setArchiveMsg('Session Remembered');
                _setArchiveState({ carryForwardRecorded: false, threadUpdated: false, openPressuresUpdated: false });
                _prepareArchiveThreadOptions();
            }
        }

        _setStatus('');
        _showView('session');
    }

    // ── API helpers ──────────────────────────────────────────────────────────

    async function _apiGet(path) {
        const res = await fetch(path);
        return res.json();
    }

    async function _apiPost(path, body) {
        const res = await fetch(path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        return res.json();
    }

    async function _apiPut(path, body) {
        const res = await fetch(path, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        return res.json();
    }

    async function _apiDelete(path) {
        const res = await fetch(path, { method: 'DELETE' });
        return res.json();
    }

    async function _populateNewSessionThreadOptions() {
        const selectEl = $ip('ip-new-session-thread-select');
        if (!selectEl) return;
        selectEl.innerHTML = '<option value="">Select an existing thread</option>';
        _newSessionThreadSnapshot = [];
        try {
            const data = await _apiGet('/api/signal-threads');
            const threads = data && Array.isArray(data.threads) ? data.threads : [];
            _newSessionThreadSnapshot = threads;
            threads.forEach(t => {
                const opt = document.createElement('option');
                opt.value = t.id;
                const updated = t.updatedAt ? (' · updated ' + formatRelativeTime(t.updatedAt)) : '';
                opt.textContent = (t.title || IP_UNTITLED_THREAD) + updated;
                selectEl.appendChild(opt);
            });
        } catch { /* ignore */ }
    }

    async function _renderNewSessionThreadContext(threadId) {
        const contextEl = $ip('ip-new-session-thread-context');
        if (!contextEl) return;
        const id = String(threadId || '').trim();
        if (!id) {
            contextEl.innerHTML = '';
            return;
        }
        contextEl.textContent = 'Loading thread context…';
        try {
            const [threadData, linkedData] = await Promise.all([
                _apiGet('/api/signal-threads/' + encodeURIComponent(id)),
                _apiGet('/api/signal-threads/' + encodeURIComponent(id) + '/linked-sessions'),
            ]);
            const thread = threadData && threadData.thread ? threadData.thread : null;
            const sessions = linkedData && Array.isArray(linkedData.sessions) ? linkedData.sessions : [];
            if (!thread) {
                contextEl.textContent = 'Thread context unavailable.';
                return;
            }
            const reflections = Array.isArray(thread.reflections) ? thread.reflections : [];
            const latestReflection = reflections
                .slice()
                .sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')))[0];
            const latestCarryForward = Array.isArray(thread.carryForwardEntries)
                ? thread.carryForwardEntries
                    .slice()
                    .sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')))[0]
                : null;
            const openPressure = Array.isArray(thread.openPressures) && thread.openPressures.length
                ? String(thread.openPressures[0])
                : String(thread.openPressure || '');
            const lastSession = sessions
                .slice()
                .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')))[0];
            const parts = [
                ['Thread', thread.title || IP_UNTITLED_THREAD],
                ['Purpose', _clipLine(thread.purpose || '', 110) || '—'],
                ['Open Pressure', _clipLine(openPressure, 110) || '—'],
                ['Carry Forward', _clipLine(latestCarryForward && latestCarryForward.content ? latestCarryForward.content : '', 110) || '—'],
                ['Recent Reflection', _clipSentences(latestReflection && latestReflection.content ? latestReflection.content : '', 3, 180) || '—'],
                ['Last Active', lastSession ? _fmtDate(lastSession.updatedAt || lastSession.createdAt) : '—'],
            ];
            contextEl.innerHTML = '';
            parts.forEach(([label, value]) => {
                const row = document.createElement('div');
                row.textContent = label + ': ' + value;
                contextEl.appendChild(row);
            });
        } catch {
            contextEl.textContent = 'Thread context unavailable.';
        }
    }

    async function _refreshCarryForwardHome() {
        const carryHost = $ip('ip-carry-forward-list');
        const pressureHost = $ip('ip-open-pressure-list');
        const continuityHost = $ip('ip-living-continuity-card');
        if (carryHost) carryHost.innerHTML = '<span class="message-system">Loading continuity…</span>';
        if (pressureHost) pressureHost.innerHTML = '<span class="message-system">Loading continuity…</span>';
        if (continuityHost) continuityHost.innerHTML = '<span class="message-system">Loading continuity…</span>';
        try {
            const data = await _apiGet('/api/signal-threads');
            const threads = data && Array.isArray(data.threads) ? data.threads.slice(0, 3) : [];
            const detailList = await Promise.all(
                threads.map(t => _apiGet('/api/signal-threads/' + encodeURIComponent(t.id)).catch(() => null)),
            );
            const detailedThreads = detailList
                .map((payload, idx) => payload && payload.thread ? payload.thread : threads[idx])
                .filter(Boolean);
            if (!detailedThreads.length) {
                if (continuityHost) continuityHost.innerHTML = '<span class="message-system">No recent thread yet.</span>';
                if (carryHost) carryHost.innerHTML = '<span class="message-system">No recently active Signal Threads.</span>';
                if (pressureHost) pressureHost.innerHTML = '<span class="message-system">No active open pressures.</span>';
                return;
            }

            const mostRecent = detailedThreads[0];
            if (continuityHost) {
                const openPressure = Array.isArray(mostRecent.openPressures) && mostRecent.openPressures.length
                    ? String(mostRecent.openPressures[0])
                    : String(mostRecent.openPressure || '');
                const latestCarryForward = Array.isArray(mostRecent.carryForwardEntries)
                    ? mostRecent.carryForwardEntries
                        .slice()
                        .sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')))[0]
                    : null;
                continuityHost.innerHTML = '';
                const continuityCard = document.createElement('div');
                continuityCard.className = 'ip-session-card';
                const body = document.createElement('div');
                body.className = 'ip-session-card-body';
                const title = document.createElement('div');
                title.className = 'ip-session-card-title';
                title.textContent = mostRecent.title || IP_UNTITLED_THREAD;
                const purpose = document.createElement('div');
                purpose.className = 'ip-session-card-meta';
                purpose.textContent = 'Purpose: ' + (_clipLine(mostRecent.purpose || '', 160) || '—');
                const pressure = document.createElement('div');
                pressure.className = 'ip-session-card-meta';
                pressure.textContent = 'Open Pressure: ' + (_clipLine(openPressure, 160) || '—');
                const carryForward = document.createElement('div');
                carryForward.className = 'ip-session-card-meta';
                carryForward.textContent = 'Carry Forward: ' + (_clipLine(latestCarryForward && latestCarryForward.content ? latestCarryForward.content : '', 160) || '—');
                body.appendChild(title);
                body.appendChild(purpose);
                body.appendChild(pressure);
                body.appendChild(carryForward);
                continuityCard.appendChild(body);
                continuityHost.appendChild(continuityCard);
            }

            if (carryHost) carryHost.innerHTML = '';
            if (pressureHost) pressureHost.innerHTML = '';
            detailedThreads.forEach(t => {
                const latestCarryForward = Array.isArray(t.carryForwardEntries)
                    ? t.carryForwardEntries.slice().sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')))[0]
                    : null;
                const openPressure = Array.isArray(t.openPressures) && t.openPressures.length
                    ? String(t.openPressures[0])
                    : String(t.openPressure || '');
                if (carryHost && latestCarryForward && String(latestCarryForward.content || '').trim()) {
                    const row = document.createElement('div');
                    row.className = 'ip-session-card';
                    const body = document.createElement('div');
                    body.className = 'ip-session-card-body';
                    const title = document.createElement('div');
                    title.className = 'ip-session-card-title';
                    title.textContent = t.title || IP_UNTITLED_THREAD;
                    const carry = document.createElement('div');
                    carry.className = 'ip-session-card-meta';
                    carry.textContent = '“' + _clipLine(latestCarryForward.content, 170) + '”';
                    const updated = document.createElement('div');
                    updated.className = 'ip-session-card-meta';
                    updated.textContent = 'Last Updated: ' + (t.updatedAt ? formatRelativeTime(t.updatedAt) : '—');
                    body.appendChild(title);
                    body.appendChild(carry);
                    body.appendChild(updated);
                    row.appendChild(body);
                    carryHost.appendChild(row);
                }
                if (pressureHost && String(openPressure || '').trim()) {
                    const row = document.createElement('div');
                    row.className = 'ip-session-card';
                    const body = document.createElement('div');
                    body.className = 'ip-session-card-body';
                    const titleDiv = document.createElement('div');
                    titleDiv.className = 'ip-session-card-title';
                    titleDiv.textContent = t.title || IP_UNTITLED_THREAD;
                    const metaDiv = document.createElement('div');
                    metaDiv.className = 'ip-session-card-meta';
                    metaDiv.textContent = _clipLine(openPressure, 170);
                    body.appendChild(titleDiv);
                    body.appendChild(metaDiv);
                    const actionWrap = document.createElement('div');
                    actionWrap.className = 'ip-session-card-actions';
                    const continueBtn = document.createElement('button');
                    continueBtn.className = 'secondary';
                    continueBtn.textContent = 'Continue Thread';
                    continueBtn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        const modeEl = $ip('ip-new-session-mode');
                        const threadEl = $ip('ip-new-session-thread-select');
                        const rowEl = $ip('ip-new-session-thread-row');
                        beginNewSession();
                        if (modeEl) modeEl.value = 'continue';
                        if (rowEl) rowEl.style.display = '';
                        await _populateNewSessionThreadOptions();
                        if (threadEl) threadEl.value = String(t.id || '');
                        _renderNewSessionThreadContext(t.id);
                    });
                    actionWrap.appendChild(continueBtn);
                    row.appendChild(body);
                    row.appendChild(actionWrap);
                    pressureHost.appendChild(row);
                }
            });

            if (carryHost && !carryHost.children.length) {
                carryHost.innerHTML = '<span class="message-system">No recent carry forward yet.</span>';
            }
            if (pressureHost && !pressureHost.children.length) {
                pressureHost.innerHTML = '<span class="message-system">No active open pressures.</span>';
            }
        } catch {
            if (continuityHost) continuityHost.innerHTML = '<span class="message-system">Could not load continuity.</span>';
            if (carryHost) carryHost.innerHTML = '<span class="message-system">Could not load continuity.</span>';
            if (pressureHost) pressureHost.innerHTML = '<span class="message-system">Could not load continuity.</span>';
        }
    }

    // ── Begin new session ────────────────────────────────────────────────────

    function beginNewSession() {
        // Show the inline new-session form instead of a blocking prompt
        const formEl    = $ip('ip-new-session-form');
        const inputEl   = $ip('ip-new-session-title');
        const statusEl  = $ip('ip-new-session-status');
        const modeEl = $ip('ip-new-session-mode');
        const threadRowEl = $ip('ip-new-session-thread-row');
        const threadSelectEl = $ip('ip-new-session-thread-select');
        const contextEl = $ip('ip-new-session-thread-context');
        if (formEl)   formEl.style.display = '';
        if (inputEl)  { inputEl.value = ''; inputEl.focus(); }
        if (statusEl) statusEl.textContent = '';
        if (modeEl) modeEl.value = 'new';
        if (threadRowEl) threadRowEl.style.display = 'none';
        if (threadSelectEl) threadSelectEl.value = '';
        if (contextEl) contextEl.textContent = '';
        _populateNewSessionThreadOptions();
    }

    async function _submitNewSession() {
        const inputEl  = $ip('ip-new-session-title');
        const statusEl = $ip('ip-new-session-status');
        const modeEl = $ip('ip-new-session-mode');
        const threadSelectEl = $ip('ip-new-session-thread-select');
        const title = inputEl ? inputEl.value.trim() : '';
        const mode = modeEl ? String(modeEl.value || 'new') : 'new';
        const continueThreadId = mode === 'continue' && threadSelectEl
            ? String(threadSelectEl.value || '').trim()
            : '';
        if (mode === 'continue' && !continueThreadId) {
            if (statusEl) statusEl.textContent = 'Select a thread to continue.';
            return;
        }
        if (statusEl) statusEl.textContent = 'Creating…';
        try {
            const data = await _apiPost('/api/sessions', { title, continueThreadId });
            if (data && data.success && data.session) {
                _hideNewSessionForm();
                _loadSessionView(data.session);
            } else {
                if (statusEl) statusEl.textContent = 'Could not create session. Try again.';
            }
        } catch {
            if (statusEl) statusEl.textContent = 'Error creating session.';
        }
    }

    function _hideNewSessionForm() {
        const formEl   = $ip('ip-new-session-form');
        const inputEl  = $ip('ip-new-session-title');
        const statusEl = $ip('ip-new-session-status');
        const modeEl = $ip('ip-new-session-mode');
        const threadRowEl = $ip('ip-new-session-thread-row');
        const threadSelectEl = $ip('ip-new-session-thread-select');
        const contextEl = $ip('ip-new-session-thread-context');
        if (formEl)   formEl.style.display = 'none';
        if (inputEl)  inputEl.value = '';
        if (statusEl) statusEl.textContent = '';
        if (modeEl) modeEl.value = 'new';
        if (threadRowEl) threadRowEl.style.display = 'none';
        if (threadSelectEl) threadSelectEl.value = '';
        if (contextEl) contextEl.textContent = '';
    }

    // ── Continue last session ─────────────────────────────────────────────────

    async function continueLastSession() {
        try {
            const data = await _apiGet('/api/sessions');
            const sessions = data && Array.isArray(data.sessions) ? data.sessions : [];
            if (sessions.length === 0) {
                // Show the new-session form and surface the message there
                beginNewSession();
                const statusEl = $ip('ip-new-session-status');
                if (statusEl) statusEl.textContent = 'No sessions found. Begin a new one.';
                return;
            }
            // Sessions are sorted newest-first
            _loadSessionView(sessions[0]);
        } catch {
            beginNewSession();
            const statusEl = $ip('ip-new-session-status');
            if (statusEl) statusEl.textContent = 'Error loading sessions.';
        }
    }

    // ── Review sessions list ─────────────────────────────────────────────────

    async function reviewSessions() {
        try {
            const data = await _apiGet('/api/sessions');
            const sessions = data && Array.isArray(data.sessions) ? data.sessions : [];
            _renderSessionsList(sessions);
            _showView('list');
        } catch {
            _renderSessionsList([]);
            _showView('list');
        }
    }

    function _renderSessionsList(sessions) {
        const container = $ip('ip-sessions-list');
        if (!container) return;
        if (!sessions || sessions.length === 0) {
            container.innerHTML = '<span class="message-system">No sessions yet. Begin your first session.</span>';
            return;
        }
        container.innerHTML = '';
        sessions.forEach(s => {
            const card = document.createElement('div');
            card.className = 'ip-session-card';

            const body = document.createElement('div');
            body.className = 'ip-session-card-body';

            const titleDiv = document.createElement('div');
            titleDiv.className = 'ip-session-card-title';
            titleDiv.textContent = s.title || 'Untitled Session';

            const metaDiv = document.createElement('div');
            metaDiv.className = 'ip-session-card-meta';
            metaDiv.textContent = _fmtDate(s.updatedAt || s.createdAt);

            body.appendChild(titleDiv);
            body.appendChild(metaDiv);

            const stageSpan = document.createElement('span');
            stageSpan.className = 'ip-session-card-stage';
            stageSpan.textContent = s.currentStage || 'observe';

            const actions = document.createElement('div');
            actions.className = 'ip-session-card-actions';

            const openBtn = document.createElement('button');
            openBtn.className = 'secondary';
            openBtn.style.cssText = 'font-size:0.75rem; padding:0.2rem 0.5rem;';
            openBtn.textContent = 'Open';
            openBtn.setAttribute('aria-label', 'Open session: ' + (s.title || 'Untitled Session'));

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'secondary';
            deleteBtn.style.cssText = 'font-size:0.75rem; padding:0.2rem 0.5rem;';
            deleteBtn.textContent = 'Delete';
            deleteBtn.setAttribute('aria-label', 'Delete session: ' + (s.title || 'Untitled Session'));
            deleteBtn.dataset.pendingDelete = 'false';

            actions.appendChild(openBtn);
            actions.appendChild(deleteBtn);

            card.appendChild(body);
            card.appendChild(stageSpan);
            card.appendChild(actions);

            // Open
            openBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const detail = await _apiGet('/api/sessions/' + encodeURIComponent(s.id)).catch(() => null);
                if (detail && detail.session) {
                    _loadSessionView(detail.session);
                }
            });

            // Delete — two-click accessible confirmation (no confirm())
            deleteBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (deleteBtn.dataset.pendingDelete !== 'true') {
                    // First click: ask for confirmation inline
                    deleteBtn.textContent = 'Confirm?';
                    deleteBtn.dataset.pendingDelete = 'true';
                    // Reset after 3 seconds if no second click
                    setTimeout(() => {
                        if (deleteBtn.dataset.pendingDelete === 'true') {
                            deleteBtn.textContent = 'Delete';
                            deleteBtn.dataset.pendingDelete = 'false';
                        }
                    }, 3000);
                    return;
                }
                // Second click: perform delete
                deleteBtn.disabled = true;
                await _apiDelete('/api/sessions/' + encodeURIComponent(s.id)).catch(() => null);
                reviewSessions();
            });

            // Click card body = open
            card.addEventListener('click', async () => {
                const detail = await _apiGet('/api/sessions/' + encodeURIComponent(s.id)).catch(() => null);
                if (detail && detail.session) {
                    _loadSessionView(detail.session);
                }
            });

            container.appendChild(card);
        });
    }

    async function _prepareArchiveThreadOptions() {
        const selectEl = $ip('ip-archive-thread-select');
        if (!selectEl) return;
        selectEl.innerHTML = '<option value="">Select an existing thread</option>';
        try {
            const data = await _apiGet('/api/signal-threads');
            const threads = data && Array.isArray(data.threads) ? data.threads : [];
            threads.forEach(t => {
                const opt = document.createElement('option');
                opt.value = t.id;
                opt.textContent = t.title || IP_UNTITLED_THREAD;
                selectEl.appendChild(opt);
            });
        } catch { /* ignore */ }
    }

    async function _attachToExistingThread() {
        if (!_activeSession) return;
        const selectEl = $ip('ip-archive-thread-select');
        const newTitleEl = $ip('ip-archive-new-thread-title');
        const threadId = selectEl ? String(selectEl.value || '').trim() : '';
        const newThreadTitle = newTitleEl ? String(newTitleEl.value || '').trim() : '';
        const continuity = _readArchiveContinuityInputs();
        if (threadId && newThreadTitle) {
            _setArchiveMsg('Please select an existing thread OR enter a new thread title, not both.');
            return;
        }
        if (!threadId && !newThreadTitle) {
            _setArchiveMsg('Select a thread or enter a new thread title.');
            return;
        }
        _setArchiveMsg('Updating thread…');
        try {
            const data = await _apiPost('/api/sessions/' + encodeURIComponent(_activeSession.id) + '/archive-thread', {
                threadId,
                newThreadTitle,
                openPressure: continuity.openPressure,
                carryForward: continuity.carryForward,
            });
            if (data && data.success) {
                _setArchiveState({
                    carryForwardRecorded: Boolean(continuity.carryForward),
                    threadUpdated: true,
                    openPressuresUpdated: Boolean(continuity.openPressure),
                });
                if (newTitleEl) newTitleEl.value = '';
                _setArchiveMsg('Thread updated.');
                _refreshCarryForwardHome();
                await _prepareArchiveThreadOptions();
                return;
            }
            _setArchiveMsg(data && data.error ? data.error : 'Attach failed.');
        } catch {
            _setArchiveMsg('Attach failed.');
        }
    }

    async function reviewThreads() {
        const host = $ip('ip-threads-list');
        if (!host) return;
        host.innerHTML = '<span class="message-system">Loading threads…</span>';
        _showView('threads');
        try {
            const data = await _apiGet('/api/signal-threads');
            const threads = data && Array.isArray(data.threads) ? data.threads : [];
            if (!threads.length) {
                host.innerHTML = '<span class="message-system">No threads yet.</span>';
                return;
            }
            host.innerHTML = '';
            threads.forEach(t => {
                const card = document.createElement('div');
                card.className = 'ip-session-card';
                const body = document.createElement('div');
                body.className = 'ip-session-card-body';
                const titleDiv = document.createElement('div');
                titleDiv.className = 'ip-session-card-title';
                titleDiv.textContent = t.title || IP_UNTITLED_THREAD;
                const metaDiv = document.createElement('div');
                metaDiv.className = 'ip-session-card-meta';
                metaDiv.textContent = String(t.sessionCount || 0) + ' Sessions';
                body.appendChild(titleDiv);
                body.appendChild(metaDiv);
                const stageSpan = document.createElement('span');
                stageSpan.className = 'ip-session-card-stage';
                stageSpan.textContent = t.updatedAt ? ('Updated ' + _fmtDate(t.updatedAt)) : 'Updated —';
                card.appendChild(body);
                card.appendChild(stageSpan);
                card.addEventListener('click', () => _openThreadDetail(String(t.id || '')));
                host.appendChild(card);
            });
        } catch {
            host.innerHTML = '<span class="message-system">Could not load threads.</span>';
        }
    }

    async function _openThreadDetail(threadId) {
        if (!threadId) return;
        _activeThreadDetailId = threadId;
        const titleEl = $ip('ip-thread-detail-title');
        const metaEl = $ip('ip-thread-detail-meta');
        const summaryEl = $ip('ip-thread-detail-summary');
        const listEl = $ip('ip-thread-linked-sessions');
        if (titleEl) titleEl.textContent = 'Thread';
        if (metaEl) metaEl.innerHTML = '';
        if (summaryEl) summaryEl.textContent = 'Loading…';
        if (listEl) listEl.innerHTML = '<span class="message-system">Loading linked sessions…</span>';
        _showView('thread-detail');
        try {
            const [threadData, linkedData] = await Promise.all([
                _apiGet('/api/signal-threads/' + encodeURIComponent(threadId)),
                _apiGet('/api/signal-threads/' + encodeURIComponent(threadId) + '/linked-sessions'),
            ]);
            const thread = threadData && threadData.thread ? threadData.thread : null;
            const sessions = linkedData && Array.isArray(linkedData.sessions) ? linkedData.sessions : [];
            if (!thread) {
                if (summaryEl) summaryEl.textContent = 'Thread unavailable.';
                return;
            }
            const latestReflection = Array.isArray(thread.reflections)
                ? thread.reflections.slice().sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')))[0]
                : null;
            if (titleEl) titleEl.textContent = thread.title || 'Thread';
            if (metaEl) {
                metaEl.innerHTML = '';
                const carryForwardList = Array.isArray(thread.carryForwardEntries)
                    ? thread.carryForwardEntries.slice().sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || ''))).slice(0, 3)
                    : [];
                const openPressureList = Array.isArray(thread.openPressures)
                    ? thread.openPressures.slice(0, 4)
                    : [];
                const rows = [
                    'Purpose: ' + (_clipLine(thread.purpose || '', 180) || '—'),
                    'Open Pressures: ' + (openPressureList.length ? openPressureList.join(' | ') : '—'),
                    'Carry Forward: ' + (carryForwardList.length ? carryForwardList.map(e => _clipLine(e.content, 60)).join(' | ') : '—'),
                    'Recent Reflection: ' + (_clipSentences(latestReflection && latestReflection.content ? latestReflection.content : '', 3, 220) || '—'),
                    'Recent Sessions: ' + (sessions.length
                        ? sessions.slice(0, 3).map(s => s.title || 'Untitled Session').join(' | ')
                        : '—'),
                    'Session Count: ' + String(Array.isArray(thread.sessionIds) ? thread.sessionIds.length : 0),
                    'Last Updated: ' + _fmtDate(thread.updatedAt || thread.createdAt),
                ];
                rows.forEach(text => {
                    const row = document.createElement('div');
                    row.textContent = text;
                    metaEl.appendChild(row);
                });
            }
            if (summaryEl) {
                summaryEl.textContent = _clipSentences(latestReflection && latestReflection.content ? latestReflection.content : '', 3, 320) || 'No reflection yet.';
            }
            if (listEl) {
                listEl.innerHTML = '';
                if (!sessions.length) {
                    listEl.innerHTML = '<span class="message-system">No linked sessions yet.</span>';
                } else {
                    sessions.forEach(s => {
                        const card = document.createElement('div');
                        card.className = 'ip-session-card';
                        const body = document.createElement('div');
                        body.className = 'ip-session-card-body';
                        const title = document.createElement('div');
                        title.className = 'ip-session-card-title';
                        title.textContent = s.title || 'Untitled Session';
                        const meta = document.createElement('div');
                        meta.className = 'ip-session-card-meta';
                        meta.textContent = _fmtDate(s.updatedAt || s.createdAt);
                        body.appendChild(title);
                        body.appendChild(meta);
                        const stage = document.createElement('span');
                        stage.className = 'ip-session-card-stage';
                        stage.textContent = String(s.currentStage || 'observe');
                        card.appendChild(body);
                        card.appendChild(stage);
                        listEl.appendChild(card);
                    });
                }
            }
        } catch {
            if (summaryEl) summaryEl.textContent = 'Could not load thread.';
        }
    }

    async function _generateActiveThreadSummary() {
        if (!_activeThreadDetailId) return;
        const summaryEl = $ip('ip-thread-detail-summary');
        if (summaryEl) summaryEl.textContent = 'Generating…';
        try {
            const data = await _apiPost('/api/signal-threads/' + encodeURIComponent(_activeThreadDetailId) + '/generate-summary', {});
            if (data && data.success) {
                if (summaryEl) summaryEl.textContent = String(data.summary || '').trim() || 'No summary generated.';
                return;
            }
            if (summaryEl) summaryEl.textContent = 'Could not generate summary.';
        } catch {
            if (summaryEl) summaryEl.textContent = 'Could not generate summary.';
        }
    }

    // ── Save stage notes ─────────────────────────────────────────────────────

    async function saveCurrentStage(advance) {
        if (!_activeSession) return;
        const notesEl = $ip('ip-stage-notes');
        const notes = notesEl ? notesEl.value : '';
        const stage = _activeSession.currentStage;

        _setStatus('Saving…');

        try {
            const data = await _apiPost(
                '/api/sessions/' + encodeURIComponent(_activeSession.id) + '/stage',
                { stage, notes, advance: Boolean(advance) },
            );
            if (data && data.success && data.session) {
                _activeSession = data.session;
                if (advance) {
                    // Re-render for the new stage
                    _loadSessionView(_activeSession);
                } else {
                    // Just update stage bar to reflect saved state
                    _renderStageBar(_activeSession.currentStage, _activeSession.entries);
                    _setStatus('Saved.', true);
                }
            } else {
                _setStatus('Save failed.');
            }
        } catch {
            _setStatus('Error saving.');
        }
    }

    // ── AI Assist ────────────────────────────────────────────────────────────

    async function requestAiAssist() {
        if (!_activeSession || _aiAssistActive) return;
        _aiAssistActive = true;

        const notesEl  = $ip('ip-stage-notes');
        const statusEl = $ip('ip-ai-assist-status');
        const respEl   = $ip('ip-ai-response');
        const btnEl    = $ip('ip-ai-assist-btn');

        const notes = notesEl ? notesEl.value : '';
        const stage = _activeSession.currentStage;

        if (statusEl) statusEl.textContent = 'Asking…';
        if (btnEl)    btnEl.disabled = true;
        if (respEl)   respEl.style.display = 'none';

        try {
            const data = await _apiPost(
                '/api/sessions/' + encodeURIComponent(_activeSession.id) + '/ai-assist',
                { stage, notes },
            );
            if (data && data.content) {
                if (respEl) {
                    respEl.textContent = data.content;
                    respEl.style.display = '';
                }
                if (statusEl) statusEl.textContent = '';
            } else if (data && data.offline) {
                if (statusEl) statusEl.textContent = 'AI unavailable — continue without it.';
            } else {
                if (statusEl) statusEl.textContent = 'No response.';
            }
        } catch {
            if (statusEl) statusEl.textContent = 'AI request failed.';
        } finally {
            _aiAssistActive = false;
            if (btnEl) btnEl.disabled = false;
        }
    }

    // ── Export session as Markdown ────────────────────────────────────────────

    async function exportSessionMarkdown() {
        if (!_activeSession) return;
        _setArchiveMsg('Exporting…');
        try {
            const res = await fetch(
                '/api/sessions/' + encodeURIComponent(_activeSession.id) + '/export',
            );
            if (!res.ok) { _setArchiveMsg('Export failed.'); return; }
            const text = await res.text();
            const blob = new Blob([text], { type: 'text/markdown' });
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement('a');
            a.href     = url;
            a.download = 'session-' + (_activeSession.id || 'export') + '.md';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            _setArchiveMsg('Exported.');
            setTimeout(() => _setArchiveMsg(''), 2200);
        } catch {
            _setArchiveMsg('Export error.');
        }
    }

    // ── Save to remember (marks remember stage complete) ───────────────────────

    async function saveToArchive() {
        if (!_activeSession) return;
        const notesEl = $ip('ip-stage-notes');
        const notes = notesEl ? notesEl.value : '';
        _setArchiveMsg('Saving to remember…');
        try {
            const data = await _apiPost(
                '/api/sessions/' + encodeURIComponent(_activeSession.id) + '/stage',
                { stage: 'remember', notes, advance: true },
            );
            if (data && data.success) {
                _activeSession = data.session;
                _renderStageBar(_activeSession.currentStage, _activeSession.entries);
                _setArchiveMsg('Saved to remember.');
            } else {
                _setArchiveMsg('Save failed.');
            }
        } catch {
            _setArchiveMsg('Error saving.');
        }
    }

    // ── Settings shortcut ────────────────────────────────────────────────────

    function openSettings() {
        openRoomAndSubtab('hearth', 'hearth-system');
    }

    function reviewArchive() {
        openRoomAndSubtab('hearth', 'hearth-archive');
    }

    function returnHome() {
        _activeSession = null;
        _hideNewSessionForm();
        const pressureEl = $ip('ip-archive-open-pressure-input');
        const carryEl = $ip('ip-archive-carry-forward-input');
        if (pressureEl) pressureEl.value = '';
        if (carryEl) carryEl.value = '';
        _setArchiveState({ carryForwardRecorded: false, threadUpdated: false, openPressuresUpdated: false });
        _showView('home');
        _refreshCarryForwardHome();
    }

    function startNewSessionFromArchive() {
        returnHome();
        beginNewSession();
    }

    // ── Bind events ──────────────────────────────────────────────────────────

    function _bind(id, event, fn) {
        const el = $ip(id);
        if (el) el.addEventListener(event, fn);
    }

    _bind('ip-begin-btn',          'click', beginNewSession);
    _bind('ip-continue-btn',       'click', continueLastSession);
    _bind('ip-review-threads-btn', 'click', reviewThreads);
    _bind('ip-review-archive-btn', 'click', reviewArchive);
    _bind('ip-settings-btn',       'click', openSettings);
    _bind('ip-open-ask-council-btn', 'click', () => openRoomAndSubtab('council', 'ws-council-chat'));
    _bind('ip-open-advanced-lenses-btn', 'click', () => openRoomAndSubtab('council', 'ws-archetypes'));

    // Inline new-session form
    _bind('ip-new-session-start-btn',  'click', _submitNewSession);
    _bind('ip-new-session-cancel-btn', 'click', _hideNewSessionForm);
    const newSessionMode = $ip('ip-new-session-mode');
    if (newSessionMode) {
        newSessionMode.addEventListener('change', async () => {
            const isContinue = String(newSessionMode.value || '') === 'continue';
            const threadRowEl = $ip('ip-new-session-thread-row');
            if (threadRowEl) threadRowEl.style.display = isContinue ? '' : 'none';
            if (isContinue) {
                await _populateNewSessionThreadOptions();
            } else {
                _renderNewSessionThreadContext('');
            }
        });
    }
    const newSessionThreadSelect = $ip('ip-new-session-thread-select');
    if (newSessionThreadSelect) {
        newSessionThreadSelect.addEventListener('change', () => {
            _renderNewSessionThreadContext(newSessionThreadSelect.value);
        });
    }
    const newTitleInput = $ip('ip-new-session-title');
    if (newTitleInput) {
        newTitleInput.addEventListener('keydown', e => {
            if (e.key === 'Enter') _submitNewSession();
            if (e.key === 'Escape') _hideNewSessionForm();
        });
    }

    _bind('ip-back-home-btn',      'click', returnHome);

    _bind('ip-save-btn',           'click', () => saveCurrentStage(false));
    _bind('ip-continue-stage-btn', 'click', () => saveCurrentStage(true));
    _bind('ip-ai-assist-btn',      'click', requestAiAssist);
    _bind('ip-attach-thread-btn',  'click', _attachToExistingThread);
    _bind('ip-export-md-btn',      'click', exportSessionMarkdown);
    _bind('ip-archive-home-btn',   'click', returnHome);
    _bind('ip-archive-new-session-btn', 'click', startNewSessionFromArchive);

    _bind('ip-list-back-btn',      'click', returnHome);
    _bind('ip-list-new-btn',       'click', beginNewSession);
    _bind('ip-threads-back-btn',   'click', returnHome);
    _bind('ip-thread-detail-back-btn', 'click', reviewThreads);

    const archiveThreadSelect = $ip('ip-archive-thread-select');
    const archiveThreadTitle = $ip('ip-archive-new-thread-title');
    if (archiveThreadSelect && archiveThreadTitle) {
        archiveThreadSelect.addEventListener('change', () => {
            if (String(archiveThreadSelect.value || '').trim()) archiveThreadTitle.value = '';
        });
        archiveThreadTitle.addEventListener('input', () => {
            if (String(archiveThreadTitle.value || '').trim()) archiveThreadSelect.value = '';
        });
    }

    // ── Init ─────────────────────────────────────────────────────────────────

    _showView('home');
    _refreshAiStatus();
    _refreshCarryForwardHome();

})();
