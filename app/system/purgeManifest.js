'use strict';

const PURGE_MODES = Object.freeze({
    TEMPORARY: 'temporary',
    FULL: 'full',
});

const PROTECTED_DEFAULTS = Object.freeze([
    'archive/core',
    'archive/caches',
    'system/config',
]);

const PURGEABLE_DEFAULTS = Object.freeze([
    'chats',
    'threads',
    'drafts',
    'logs',
    'tmp',
    'legacy',
    'indexes/tmp',
]);

const PURGE_PROFILES = Object.freeze({
    [PURGE_MODES.TEMPORARY]: Object.freeze([
        'chats',
        'threads',
        'council/drafts',
        'logs',
        'tmp',
        'legacy',
        'indexes/tmp',
    ]),
    [PURGE_MODES.FULL]: Object.freeze([
        'chats',
        'threads',
        'council/drafts',
        'council/notes',
        'council/documents',
        'hearth/remembered-threads',
        'threshold/waiting',
        'threshold/changed',
        'threshold/flagged',
        'indexes',
        'logs',
        'tmp',
        'legacy',
        'caches',
    ]),
});

const ARCHIVE_COMPLETE_WIPE_PATHS = Object.freeze([
    'archive/core',
    'archive/caches',
]);

const PURGE_MANIFEST = Object.freeze({
    protectedDefaults: PROTECTED_DEFAULTS,
    purgeableDefaults: PURGEABLE_DEFAULTS,
    profiles: PURGE_PROFILES,
    archiveCompleteWipePaths: ARCHIVE_COMPLETE_WIPE_PATHS,
    recommendedMode: PURGE_MODES.TEMPORARY,
});

module.exports = {
    PURGE_MODES,
    PURGE_MANIFEST,
};
