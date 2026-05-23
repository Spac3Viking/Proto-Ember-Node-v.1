'use strict';

const { DEFAULT_OLLAMA_MODEL, loadAiConfig } = require('./aiConfig');

const MODEL_ROLES = Object.freeze({
    hearth: 'hearth',
    forge: 'forge',
    scribe: 'scribe',
});

const FALLBACK_REASONS = Object.freeze({
    role_model_blank: 'role_model_blank',
    role_model_not_installed: 'role_model_not_installed',
    selected_model_not_installed: 'selected_model_not_installed',
    missing_model_roles: 'missing_model_roles',
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

function normalizeInstalledModels(installedModels) {
    if (!Array.isArray(installedModels)) return null;
    const cleaned = installedModels
        .map(name => (typeof name === 'string' ? name.trim() : ''))
        .filter(Boolean);
    return cleaned.length > 0 ? new Set(cleaned) : new Set();
}

function resolveModelRuntimeForRequest({
    depth,
    query,
    explicitRole,
    role,
    taskType,
    installedModels,
    aiConfig,
} = {}) {
    const cfg = aiConfig || loadAiConfig();
    const routing = (cfg && typeof cfg === 'object') ? cfg.routing : null;
    const installedSet = normalizeInstalledModels(installedModels);

    const explicit = normalizeModelRole(explicitRole) || normalizeModelRole(role);
    const taskRoute = detectTaskRoute({ taskType, query });
    const resolvedRole = explicit
        ? explicit
        : taskRoute
            ? resolveRoleForTask(taskRoute, routing)
            : resolveRoleForDepth(depth, routing);

    const selectedModel = typeof (cfg && cfg.selected_model) === 'string' && cfg.selected_model.trim()
        ? cfg.selected_model.trim()
        : DEFAULT_OLLAMA_MODEL;
    const configuredRoles = normalizeModelRolesConfig(cfg && cfg.model_roles);
    const rolesConfigured = configuredRoles !== null;
    const hasAnyRoleAssignment = rolesConfigured
        ? Object.values(configuredRoles).some(value => typeof value === 'string' && value.trim())
        : false;
    const singleModelMode = !rolesConfigured || !hasAnyRoleAssignment;

    const requestedRoleModel = rolesConfigured ? (configuredRoles[resolvedRole] || '') : '';

    let model = selectedModel || DEFAULT_OLLAMA_MODEL;
    let fallbackUsed = false;
    let fallbackReason = null;

    if (!singleModelMode) {
        if (requestedRoleModel) {
            if (installedSet && !installedSet.has(requestedRoleModel)) {
                fallbackUsed = true;
                fallbackReason = FALLBACK_REASONS.role_model_not_installed;
            } else {
                model = requestedRoleModel;
            }
        } else if (rolesConfigured) {
            // Role layer exists and other roles may be configured, but this role is blank.
            fallbackUsed = true;
            fallbackReason = FALLBACK_REASONS.role_model_blank;
        } else {
            fallbackUsed = false;
        }
    } else if (!rolesConfigured) {
        // Legacy config shape: keep single-model mode clean.
        fallbackUsed = false;
        fallbackReason = null;
    }

    // Runtime validation: if the selected model is missing, fall back to DEFAULT_OLLAMA_MODEL.
    if (installedSet && model && !installedSet.has(model)) {
        if (!fallbackUsed) {
            fallbackUsed = true;
            fallbackReason = FALLBACK_REASONS.selected_model_not_installed;
        }
        model = DEFAULT_OLLAMA_MODEL;
    }

    return {
        model,
        modelRole: resolvedRole,
        requestedRoleModel: singleModelMode ? null : requestedRoleModel,
        fallbackUsed: Boolean(fallbackUsed),
        fallbackReason,
        taskRoute,
        roleSource: explicit ? 'explicit' : (taskRoute ? 'task' : 'depth'),
    };
}

module.exports = {
    MODEL_ROLES,
    FALLBACK_REASONS,
    TASK_ROUTES,
    normalizeModelRole,
    detectTaskRoute,
    resolveRoleForDepth,
    resolveRoleForTask,
    resolveModelForRole,
    resolveModelRuntimeForRequest,
};
