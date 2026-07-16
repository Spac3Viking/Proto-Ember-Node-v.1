'use strict';

/**
 * Ember Node v.ᚠ — Safe Storage Identifier Helper
 *
 * Shared mechanism for validating untrusted, client-supplied identifiers
 * that are used to build filesystem-backed storage paths (e.g. document
 * IDs, legacy thread IDs).
 *
 * Unlike the permissive `_safeId()` rewrite helpers used by Sessions and
 * Signal Threads (which coerce unexpected characters to `_` for already
 * well-behaved, internally generated IDs), this helper is intentionally
 * strict: it REJECTS malformed or suspicious identifiers outright rather
 * than silently rewriting them. This is the correct behavior for routes
 * that accept an `:id` directly from an HTTP request path.
 *
 * Rejects:
 *   - empty / non-string identifiers
 *   - path separators ("/", "\")
 *   - traversal sequences (".." anywhere)
 *   - absolute paths
 *   - null bytes
 *   - encoded traversal attempts (e.g. "%2e%2e", "..%2f")
 *   - identifiers that resolve outside the intended storage root
 */

const path = require('path');

// Conservative allow-list: letters, digits, hyphen, underscore.
// This matches the ID shapes already produced by crypto.randomUUID()-based
// generators used across the codebase (e.g. "doc-<uuid>", "thread-<uuid>").
const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * Validate an untrusted storage identifier.
 *
 * @param {*} id  Untrusted identifier, typically req.params.id
 * @returns {boolean} true when the identifier is safe to use as-is
 */
function isValidStorageId(id) {
    if (typeof id !== 'string') return false;

    // Reject empty/whitespace-only identifiers.
    const trimmed = id.trim();
    if (!trimmed || trimmed !== id) return false;

    // Reject null bytes outright (String.includes handles literal + most
    // encoded-then-decoded forms once Express has already decoded req.params).
    if (id.indexOf('\0') !== -1) return false;

    // Reject anything containing percent-encoding — a well-formed ID never
    // needs it, and it is the classic vector for encoded traversal attempts
    // (e.g. "%2e%2e%2f", "..%252f") slipping past a naive ".." check.
    if (id.indexOf('%') !== -1) return false;

    // Reject path separators, traversal sequences, and absolute paths.
    if (id.includes('/') || id.includes('\\')) return false;
    if (id.includes('..')) return false;
    if (path.isAbsolute(id)) return false;

    return SAFE_ID_PATTERN.test(id);
}

/**
 * Resolve a safe, storage-root-confined filesystem path for an untrusted
 * identifier, or return null when the identifier is invalid or the
 * resolved path would escape the storage root.
 *
 * @param {string} storageRoot  Absolute directory the file must live under
 * @param {string} id           Untrusted identifier (e.g. req.params.id)
 * @param {string} [extension]  File extension to append, e.g. '.json'
 * @returns {string|null}
 */
function resolveSafeStoragePath(storageRoot, id, extension = '.json') {
    if (!isValidStorageId(id)) return null;

    const fileName = id + extension;
    const resolvedRoot = path.resolve(storageRoot);
    const resolvedPath = path.resolve(resolvedRoot, fileName);

    // Confirm the resolved path is still confined to the storage root.
    const relative = path.relative(resolvedRoot, resolvedPath);
    if (relative.startsWith('..') || path.isAbsolute(relative) || relative === '') {
        return null;
    }

    return resolvedPath;
}

module.exports = {
    isValidStorageId,
    resolveSafeStoragePath,
};
