'use strict';

const fs = require('fs');
const path = require('path');

const {
    DATA_ROOT,
    SYSTEM_DIR,
    THRESHOLD_CACHE_DRAFTS_DIR,
} = require('../storageConfig');
const { readLoadedCachesState } = require('../loadedCaches');

const TRIALS_PATH = path.join(SYSTEM_DIR, 'trials', 'sentinel-trials.json');

const SENTINEL_TRIALS = Object.freeze([
    {
        id: 'first_ember',
        title: 'First Ember',
        purpose: 'Threshold intake → loaded caches → Spark depth → Signal Trace.',
        mentor: [
            'Loaded Caches shape the continuity available to the Forge.',
            'Spark is fast; it carries less.',
            'Signal Trace shows what the Node actually used.',
        ],
        steps: [
            { id: 'cache_loaded', label: 'Load a cache into the loadout' },
            { id: 'spark_question', label: 'Ask a Spark-depth question' },
            { id: 'signal_trace_opened', label: 'Open the Signal Trace panel' },
        ],
        capabilityNotes: [
            'Verifies cache loadout persistence.',
            'Verifies /api/chat at Spark depth.',
            'Verifies Signal Trace UI visibility.',
        ],
    },
    {
        id: 'forge_reflection',
        title: 'Forge Reflection',
        purpose: 'Ask the same question at Ember, Hearth, and Archive depths.',
        mentor: [
            'The Forge changes posture with depth.',
            'Depth is breadth, not “power”.',
        ],
        steps: [
            { id: 'ember_depth_used', label: 'Ask using Ember depth' },
            { id: 'hearth_depth_used', label: 'Ask using Hearth depth' },
            { id: 'archive_depth_used', label: 'Ask using Archive depth' },
        ],
        capabilityNotes: [
            'Verifies depth switching + routing stability through /api/chat.',
        ],
    },
    {
        id: 'scribe_structuring',
        title: 'Scribe Structuring',
        purpose: 'Save a markdown handoff and stage it in a cache draft.',
        mentor: [
            'documents/ carries active continuity.',
            'Cache drafts keep changes inspectable.',
        ],
        steps: [
            { id: 'handoff_saved', label: 'Save a markdown handoff to Threshold' },
            { id: 'cache_draft_created', label: 'Create or update a cache draft' },
        ],
        capabilityNotes: [
            'Verifies Threshold markdown save.',
            'Verifies cache draft workflow.',
        ],
    },
    {
        id: 'distillation_trial',
        title: 'Distillation Trial',
        purpose: 'Review overlap and generate a Distillation Recommendation.',
        mentor: [
            'Distillation strengthens signal by reducing repetition.',
        ],
        steps: [
            { id: 'distillation_recommendation_generated', label: 'Generate a Distillation Recommendation' },
        ],
        capabilityNotes: [
            'Verifies Council distillation prompt flow through /api/chat.',
        ],
    },
    {
        id: 'transmission_trial',
        title: 'Transmission Trial',
        purpose: 'Bridge to external AI and bring the response back as a handoff.',
        mentor: [
            'A bridge is human judgment plus clear constraints.',
            'Transmission is continuity you can carry between systems.',
        ],
        steps: [
            { id: 'prompt_bridge_exported', label: 'Export a Prompt Bridge (copy or download)' },
            { id: 'external_response_saved', label: 'Save an external response as a Threshold handoff' },
            { id: 'external_response_added_to_draft', label: 'Add the external response to a cache draft' },
        ],
        capabilityNotes: [
            'Verifies Prompt Bridge export actions.',
            'Verifies Threshold inbox save.',
            'Verifies cache draft intake from pasted text.',
        ],
    },
]);

const TRIAL_BY_ID = new Map(SENTINEL_TRIALS.map(trial => [trial.id, trial]));

function _safeReadJson(filePath, fallback) {
    if (!fs.existsSync(filePath)) return fallback;
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return fallback;
    }
}

function _ensureDir() {
    fs.mkdirSync(path.dirname(TRIALS_PATH), { recursive: true });
}

function _defaultTrialState(trialId) {
    return {
        completed: false,
        completed_at: null,
        steps: {},
        trial_id: trialId,
    };
}

function _defaultState() {
    const state = {};
    SENTINEL_TRIALS.forEach(trial => {
        state[trial.id] = _defaultTrialState(trial.id);
    });
    return state;
}

function _normalizeTrialState(raw, trialId) {
    const base = _defaultTrialState(trialId);
    const data = raw && typeof raw === 'object' ? raw : {};
    const steps = (data.steps && typeof data.steps === 'object') ? data.steps : {};
    const normalizedSteps = {};
    for (const [stepId, step] of Object.entries(steps)) {
        if (!stepId) continue;
        const row = step && typeof step === 'object' ? step : {};
        normalizedSteps[stepId] = {
            completed: Boolean(row.completed),
            completed_at: row.completed_at ? String(row.completed_at) : null,
        };
    }
    return {
        completed: Boolean(data.completed),
        completed_at: data.completed_at ? String(data.completed_at) : null,
        steps: normalizedSteps,
        trial_id: trialId,
    };
}

function loadSentinelTrialsState() {
    const parsed = _safeReadJson(TRIALS_PATH, null);
    const base = _defaultState();
    const out = {};
    const input = parsed && typeof parsed === 'object' ? parsed : {};
    for (const trial of SENTINEL_TRIALS) {
        out[trial.id] = _normalizeTrialState(input[trial.id], trial.id);
    }
    // If the file has extra keys, ignore them (keep state stable and small).
    // Ensure file exists once a read is requested.
    if (!fs.existsSync(TRIALS_PATH)) {
        _ensureDir();
        fs.writeFileSync(TRIALS_PATH, JSON.stringify(base, null, 2), 'utf8');
        return base;
    }
    return out;
}

function saveSentinelTrialsState(state) {
    const payload = state && typeof state === 'object' ? state : _defaultState();
    _ensureDir();
    fs.writeFileSync(TRIALS_PATH, JSON.stringify(payload, null, 2), 'utf8');
    return payload;
}

function getSentinelTrialsDefinitions() {
    return SENTINEL_TRIALS.map(trial => ({
        id: trial.id,
        title: trial.title,
        purpose: trial.purpose,
        mentor: trial.mentor,
        steps: trial.steps,
        capabilityNotes: trial.capabilityNotes,
    }));
}

function _setStepCompleted(trialState, stepId, at) {
    const steps = (trialState.steps && typeof trialState.steps === 'object')
        ? trialState.steps
        : {};
    const existing = steps[stepId] && typeof steps[stepId] === 'object'
        ? steps[stepId]
        : { completed: false, completed_at: null };
    if (existing.completed) return { ...trialState, steps };
    return {
        ...trialState,
        steps: {
            ...steps,
            [stepId]: {
                completed: true,
                completed_at: at,
            },
        },
    };
}

function _recomputeTrialCompletion(trialId, trialState) {
    const def = TRIAL_BY_ID.get(trialId);
    if (!def) return trialState;
    const required = def.steps.map(step => step.id);
    const steps = trialState.steps || {};
    const allDone = required.length > 0 && required.every(stepId => steps[stepId] && steps[stepId].completed);
    if (!allDone) return trialState;
    if (trialState.completed) return trialState;
    const now = new Date().toISOString();
    return {
        ...trialState,
        completed: true,
        completed_at: now,
    };
}

function markSentinelTrialStep(trialId, stepId) {
    const id = String(trialId || '').trim();
    const step = String(stepId || '').trim();
    const def = TRIAL_BY_ID.get(id);
    if (!def) {
        const err = new Error('Unknown trialId.');
        err.status = 400;
        throw err;
    }
    if (!def.steps.some(s => s.id === step)) {
        const err = new Error('Unknown stepId for trial.');
        err.status = 400;
        throw err;
    }
    const now = new Date().toISOString();
    const state = loadSentinelTrialsState();
    const current = state[id] ? _normalizeTrialState(state[id], id) : _defaultTrialState(id);
    const next = _recomputeTrialCompletion(id, _setStepCompleted(current, step, now));
    const updated = { ...state, [id]: next };
    saveSentinelTrialsState(updated);
    return { state: updated, trial: next };
}

function resetSentinelTrials() {
    const base = _defaultState();
    saveSentinelTrialsState(base);
    return base;
}

function _listThresholdInboxMarkdownFiles(limit = 40) {
    const inboxDir = path.join(DATA_ROOT, 'threshold', 'inbox');
    if (!fs.existsSync(inboxDir)) return [];
    const entries = fs.readdirSync(inboxDir, { withFileTypes: true })
        .filter(entry => entry.isFile())
        .map(entry => entry.name)
        .filter(name => name.toLowerCase().endsWith('.md'))
        .slice(0, limit);
    return entries;
}

function _hasAnyCacheDraft() {
    if (!fs.existsSync(THRESHOLD_CACHE_DRAFTS_DIR)) return false;
    try {
        const entries = fs.readdirSync(THRESHOLD_CACHE_DRAFTS_DIR, { withFileTypes: true })
            .filter(entry => entry.isDirectory())
            .map(entry => entry.name);
        for (const dir of entries) {
            const manifestPath = path.join(THRESHOLD_CACHE_DRAFTS_DIR, dir, 'manifest.json');
            if (fs.existsSync(manifestPath)) return true;
        }
        return false;
    } catch {
        return false;
    }
}

function runSentinelTrialCapabilityCheck(trialId) {
    const id = String(trialId || '').trim();
    const def = TRIAL_BY_ID.get(id);
    if (!def) {
        const err = new Error('Unknown trialId.');
        err.status = 400;
        throw err;
    }

    const state = loadSentinelTrialsState();
    const trial = state[id] ? _normalizeTrialState(state[id], id) : _defaultTrialState(id);
    const steps = trial.steps || {};
    const checks = [];

    if (id === 'first_ember') {
        const loaded = readLoadedCachesState();
        const cacheOk = Array.isArray(loaded.loaded) && loaded.loaded.length > 0;
        checks.push({
            id: 'cache_loaded',
            ok: cacheOk || Boolean(steps.cache_loaded && steps.cache_loaded.completed),
            label: 'Cache loadout contains at least one cache',
            guidance: cacheOk ? null : 'Open Caches → load one cache into the loadout.',
        });
        checks.push({
            id: 'spark_question',
            ok: Boolean(steps.spark_question && steps.spark_question.completed),
            label: 'Spark-depth exchange completed',
            guidance: steps.spark_question && steps.spark_question.completed
                ? null
                : 'Set Depth to Spark and send a short question in chat.',
        });
        checks.push({
            id: 'signal_trace_opened',
            ok: Boolean(steps.signal_trace_opened && steps.signal_trace_opened.completed),
            label: 'Signal Trace panel opened',
            guidance: steps.signal_trace_opened && steps.signal_trace_opened.completed
                ? null
                : 'Toggle Trace ▸ to expand it and inspect routing + sources.',
        });
    } else if (id === 'forge_reflection') {
        checks.push({
            id: 'ember_depth_used',
            ok: Boolean(steps.ember_depth_used && steps.ember_depth_used.completed),
            label: 'Ember depth exchange completed',
            guidance: steps.ember_depth_used && steps.ember_depth_used.completed
                ? null
                : 'Set Depth to Ember and ask a single question.',
        });
        checks.push({
            id: 'hearth_depth_used',
            ok: Boolean(steps.hearth_depth_used && steps.hearth_depth_used.completed),
            label: 'Hearth depth exchange completed',
            guidance: steps.hearth_depth_used && steps.hearth_depth_used.completed
                ? null
                : 'Set Depth to Hearth and ask the same question again.',
        });
        checks.push({
            id: 'archive_depth_used',
            ok: Boolean(steps.archive_depth_used && steps.archive_depth_used.completed),
            label: 'Archive depth exchange completed',
            guidance: steps.archive_depth_used && steps.archive_depth_used.completed
                ? null
                : 'Set Depth to Archive and ask the same question again.',
        });
    } else if (id === 'scribe_structuring') {
        const inboxMd = _listThresholdInboxMarkdownFiles();
        const anyDraft = _hasAnyCacheDraft();
        checks.push({
            id: 'handoff_saved',
            ok: Boolean(steps.handoff_saved && steps.handoff_saved.completed) || inboxMd.length > 0,
            label: 'Threshold inbox has at least one markdown handoff',
            guidance: inboxMd.length > 0 ? null : 'Use “Save … as .md” to create a handoff in Threshold.',
        });
        checks.push({
            id: 'cache_draft_created',
            ok: Boolean(steps.cache_draft_created && steps.cache_draft_created.completed) || anyDraft,
            label: 'At least one cache draft exists',
            guidance: anyDraft ? null : 'Threshold → Cache Drafts → create a draft from a handoff.',
        });
    } else if (id === 'distillation_trial') {
        checks.push({
            id: 'distillation_recommendation_generated',
            ok: Boolean(steps.distillation_recommendation_generated && steps.distillation_recommendation_generated.completed),
            label: 'Distillation Recommendation generated',
            guidance: steps.distillation_recommendation_generated && steps.distillation_recommendation_generated.completed
                ? null
                : 'Caches → “Generate Distillation Recommendation” (requires a working runtime).',
        });
    } else if (id === 'transmission_trial') {
        const inboxMd = _listThresholdInboxMarkdownFiles();
        const hasExternal = inboxMd.some(name => /external-ai-response/i.test(name));
        checks.push({
            id: 'prompt_bridge_exported',
            ok: Boolean(steps.prompt_bridge_exported && steps.prompt_bridge_exported.completed),
            label: 'Prompt Bridge exported',
            guidance: steps.prompt_bridge_exported && steps.prompt_bridge_exported.completed
                ? null
                : 'Use Bridge Actions → “Copy Prompt for External AI” or download the bridge.',
        });
        checks.push({
            id: 'external_response_saved',
            ok: Boolean(steps.external_response_saved && steps.external_response_saved.completed) || hasExternal,
            label: 'External response saved as a Threshold handoff',
            guidance: hasExternal ? null : 'Threshold → paste external response → “Save as .md Handoff”.',
        });
        checks.push({
            id: 'external_response_added_to_draft',
            ok: Boolean(steps.external_response_added_to_draft && steps.external_response_added_to_draft.completed),
            label: 'External response added to a cache draft',
            guidance: steps.external_response_added_to_draft && steps.external_response_added_to_draft.completed
                ? null
                : 'Threshold → External AI → “Add to Cache Draft”.',
        });
    }

    const ok = checks.length > 0 && checks.every(row => row.ok);
    let updatedState = state;
    let updatedTrial = trial;
    if (ok && !trial.completed) {
        updatedTrial = {
            ...trial,
            completed: true,
            completed_at: new Date().toISOString(),
        };
        updatedState = { ...state, [id]: updatedTrial };
        saveSentinelTrialsState(updatedState);
    }

    return {
        ok,
        checks,
        trial: updatedTrial,
        state: updatedState,
    };
}

module.exports = {
    TRIALS_PATH,
    getSentinelTrialsDefinitions,
    loadSentinelTrialsState,
    markSentinelTrialStep,
    resetSentinelTrials,
    runSentinelTrialCapabilityCheck,
};

