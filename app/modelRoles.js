'use strict';

const { DEFAULT_OLLAMA_MODEL, loadAiConfig } = require('./aiConfig');

const MODEL_ROLES = Object.freeze({
    hearth: 'hearth',
    forge: 'forge',
    scribe: 'scribe',
});

const TASK_ROUTES = Object.freeze({
    spark: 'hearth',
    ember: 'hearth',
    hearth: 'forge',
    archive: 'forge',
    code: 'scribe',
    cache: 'scribe',
    bootstrap: 'scribe',
    schema: 'scribe',
    json: 'scribe',
    yaml: 'scribe',
    markdown: 'scribe',
});

const SCRIBE_SIGNAL_PATTERNS = [
    // Strong signal single words.
    /\bcode\b/i,
    /\brefactor\b/i,
    /\bbug\b/i,
    /\berror\b/i,
    /\bfunction\b/i,
    /\btypescript\b/i,
    /\bjavascript\b/i,
    /\bnode\b/i,
    // Structured formats / schemas.
    /\bjson\b/i,
    /\byaml\b/i,
    /\bschema\b/i,
    // Ember Node internal workflows.
    /\bcache\b/i,
    /\bbootstrap\b/i,
    // Lightweight markdown parsing signals.
    /\bmarkdown\b/i,
    /\bparse\b.*\bmarkdown\b/i,
    /\bmarkdown\b.*\bparse\b/i,
];

function normalizeModelRole(role) {
    const raw = typeof role === 'string' ? role.trim().toLowerCase() : '';
    if (!raw) return null;
    if (raw === MODEL_ROLES.hearth) return MODEL_ROLES.hearth;
    if (raw === MODEL_ROLES.forge) return MODEL_ROLES.forge;
    if (raw === MODEL_ROLES.scribe) return MODEL_ROLES.scribe;
    return null;
}

function normalizeRoutingMap(routing) {
    if (!routing || typeof routing !== 'object') return null;
    const next = {};
    for (const [key, value] of Object.entries(routing)) {
        if (typeof key !== 'string') continue;
        const normalizedKey = key.trim().toLowerCase();
        if (!normalizedKey) continue;
        if (typeof value !== 'string') continue;
        const normalizedValue = value.trim().toLowerCase();
        if (!normalizedValue) continue;
        next[normalizedKey] = normalizedValue;
    }
    return Object.keys(next).length > 0 ? next : null;
}

function normalizeModelRolesConfig(modelRoles) {
    if (!modelRoles || typeof modelRoles !== 'object') return null;
    const next = {
        hearth: '',
        forge: '',
        scribe: '',
    };
    for (const key of Object.keys(next)) {
        const value = modelRoles[key];
        next[key] = typeof value === 'string' ? value.trim() : '';
    }
    return next;
}

function detectTaskRoute({ taskType, query } = {}) {
    const rawTaskType = typeof taskType === 'string' ? taskType.trim().toLowerCase() : '';
    if (rawTaskType) {
        // Allow explicit canonical task route keys, plus role names (treated as explicit).
        if (TASK_ROUTES[rawTaskType]) return rawTaskType;
        if (rawTaskType === 'json' || rawTaskType === 'yaml' || rawTaskType === 'markdown') return rawTaskType;
        if (rawTaskType === 'schema') return 'schema';
        if (rawTaskType === 'cache') return 'cache';
        if (rawTaskType === 'bootstrap') return 'bootstrap';
        if (rawTaskType === 'code') return 'code';
        if (['refactor', 'bug', 'error', 'function'].includes(rawTaskType)) return 'code';
    }

    const text = typeof query === 'string' ? query : '';
    if (!text) return null;

    if (/\bjson\b/i.test(text)) return 'json';
    if (/\byaml\b/i.test(text)) return 'yaml';
    if (/\bmarkdown\b/i.test(text) && /\bparse\b/i.test(text)) return 'markdown';
    if (/\bmarkdown\b/i.test(text)) return 'markdown';
    if (/\bschema\b/i.test(text)) return 'schema';
    if (/\bcache\b/i.test(text)) return 'cache';
    if (/\bbootstrap\b/i.test(text)) return 'bootstrap';

    for (const pattern of SCRIBE_SIGNAL_PATTERNS) {
        if (pattern.test(text)) return 'code';
    }
    return null;
}

function resolveRoleForDepth(depth, routing = null) {
    const normalizedRouting = normalizeRoutingMap(routing) || TASK_ROUTES;
    const raw = typeof depth === 'string' ? depth.trim().toLowerCase() : '';
    const configured = raw && normalizedRouting[raw]
        ? normalizeModelRole(normalizedRouting[raw])
        : null;
    if (configured) return configured;

    if (raw === 'hearth' || raw === 'archive') return MODEL_ROLES.forge;
    return MODEL_ROLES.hearth;
}

function resolveRoleForTask(taskRoute, routing = null) {
    const normalizedRouting = normalizeRoutingMap(routing) || TASK_ROUTES;
    const raw = typeof taskRoute === 'string' ? taskRoute.trim().toLowerCase() : '';
    const configured = raw && normalizedRouting[raw]
        ? normalizeModelRole(normalizedRouting[raw])
        : null;
    return configured || MODEL_ROLES.scribe;
}

function resolveModelForRole(role, aiConfig) {
    const cfg = aiConfig && typeof aiConfig === 'object' ? aiConfig : {};
    const selectedModel = typeof cfg.selected_model === 'string' && cfg.selected_model.trim()
        ? cfg.selected_model.trim()
        : DEFAULT_OLLAMA_MODEL;
    const configuredRoles = normalizeModelRolesConfig(cfg.model_roles);
    const rolesConfigured = configuredRoles !== null;
    const normalizedRole = normalizeModelRole(role) || MODEL_ROLES.hearth;
    const configuredModel = rolesConfigured ? (configuredRoles[normalizedRole] || '') : '';

    if (configuredModel) {
        return { model: configuredModel, fallbackUsed: false };
    }
    if (!rolesConfigured) {
        return { model: selectedModel, fallbackUsed: false };
    }
    // Role layer exists but is blank/missing for this role: fall back safely.
    return { model: selectedModel || DEFAULT_OLLAMA_MODEL, fallbackUsed: true };
}

function resolveModelRuntimeForRequest({ role, depth, query, taskType, aiConfig } = {}) {
    const cfg = aiConfig || loadAiConfig();
    const routing = (cfg && typeof cfg === 'object') ? cfg.routing : null;

    const explicitRole = normalizeModelRole(role);
    const taskRoute = detectTaskRoute({ taskType, query });
    const resolvedRole = explicitRole
        ? explicitRole
        : taskRoute
            ? resolveRoleForTask(taskRoute, routing)
            : resolveRoleForDepth(depth, routing);

    const { model, fallbackUsed } = resolveModelForRole(resolvedRole, cfg);
    return {
        model,
        modelRole: resolvedRole,
        fallbackUsed,
        taskRoute,
        roleSource: explicitRole ? 'explicit' : (taskRoute ? 'task' : 'depth'),
    };
}

module.exports = {
    MODEL_ROLES,
    TASK_ROUTES,
    normalizeModelRole,
    detectTaskRoute,
    resolveRoleForDepth,
    resolveRoleForTask,
    resolveModelForRole,
    resolveModelRuntimeForRequest,
};

