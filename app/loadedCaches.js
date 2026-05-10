'use strict';

const fs = require('fs');
const path = require('path');
const {
    ARCHIVE_CORE_DIR,
    ARCHIVE_CACHES_DIR,
    LOADED_CACHES_PATH,
    LEGACY_EQUIPPED_CACHES_PATH,
} = require('./storageConfig');

const CACHE_ID_PATTERN = /^[a-zA-Z0-9._-]+$/;
const CACHE_LEVELS = new Set(['spark', 'ember', 'flame', 'hearth']);
const CACHE_STATUSES = new Set(['unverified', 'reviewed', 'tempered', 'trusted', 'local']);
const DEFAULT_SCOPE = ['practical'];
const LOADED_VERSION = '0.1.0';
const READER_ALLOWED_EXTS = new Set(['.md']);
const DOCUMENT_EXTS = new Set(['.md', '.txt', '.json', '.pdf', '.docx']);

function safeReadJson(filePath, fallback) {
    if (!fs.existsSync(filePath)) return fallback;
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return fallback;
    }
}

function normalizeLevel(value) {
    const level = String(value || '').trim().toLowerCase();
    return CACHE_LEVELS.has(level) ? level : 'spark';
}

function normalizeStatus(value) {
    const status = String(value || '').trim().toLowerCase();
    return CACHE_STATUSES.has(status) ? status : 'unverified';
}

function normalizeScope(value) {
    const input = Array.isArray(value) ? value : (value ? [value] : []);
    const normalized = Array.from(new Set(
        input
            .map(item => String(item || '').trim().toLowerCase())
            .filter(Boolean),
    ));
    return normalized.length > 0 ? normalized : DEFAULT_SCOPE.slice();
}

function normalizeCacheManifestMetadata(manifest) {
    const data = manifest && typeof manifest === 'object' ? manifest : {};
    const loaded = Object.prototype.hasOwnProperty.call(data, 'loaded')
        ? Boolean(data.loaded)
        : Boolean(data.equipped);
    return {
        level: normalizeLevel(data.level),
        status: normalizeStatus(data.status),
        scope: normalizeScope(data.scope),
        loaded,
    };
}

function defaultLoadedState() {
    return {
        version: LOADED_VERSION,
        updated_at: null,
        loaded: [],
    };
}

function normalizeLoadedEntry(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const id = String(entry.id || '').trim();
    if (!id || !CACHE_ID_PATTERN.test(id)) return null;
    return {
        id,
        title: String(entry.title || id).trim() || id,
        level: normalizeLevel(entry.level),
        source: String(entry.source || '').trim() || null,
        loaded_at: String(entry.loaded_at || entry.equipped_at || '').trim() || null,
    };
}

function readLoadedCachesState() {
    const parsed = fs.existsSync(LOADED_CACHES_PATH)
        ? safeReadJson(LOADED_CACHES_PATH, defaultLoadedState())
        : safeReadJson(LEGACY_EQUIPPED_CACHES_PATH, defaultLoadedState());
    const base = defaultLoadedState();
    const seen = new Set();
    const rawEntries = Array.isArray(parsed && parsed.loaded)
        ? parsed.loaded
        : (Array.isArray(parsed && parsed.equipped) ? parsed.equipped : []);
    const loaded = rawEntries
            .map(normalizeLoadedEntry)
            .filter(Boolean)
            .filter(entry => {
                if (seen.has(entry.id)) return false;
                seen.add(entry.id);
                return true;
            })
    return {
        version: String(parsed && parsed.version ? parsed.version : base.version),
        updated_at: parsed && parsed.updated_at ? String(parsed.updated_at) : null,
        loaded,
    };
}

function writeLoadedCachesState(state) {
    fs.mkdirSync(path.dirname(LOADED_CACHES_PATH), { recursive: true });
    fs.writeFileSync(LOADED_CACHES_PATH, JSON.stringify(state, null, 2), 'utf8');
}

function listMarkdownEntries(rootDir, rootKey) {
    if (!fs.existsSync(rootDir)) return [];
    const out = [];
    const stack = [rootDir];
    while (stack.length > 0) {
        const current = stack.pop();
        const entries = fs.readdirSync(current, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.name.startsWith('.')) continue;
            const abs = path.join(current, entry.name);
            if (entry.isDirectory()) {
                stack.push(abs);
                continue;
            }
            if (!entry.isFile()) continue;
            const ext = path.extname(entry.name).toLowerCase();
            if (!READER_ALLOWED_EXTS.has(ext)) continue;
            const rel = path.relative(rootDir, abs).replace(/\\/g, '/');
            const entryId = Buffer.from(rootKey + '|' + rel, 'utf8').toString('base64url');
            out.push({
                relativePath: rel,
                entryId,
            });
        }
    }
    return out.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function countDocuments(rootDir) {
    if (!fs.existsSync(rootDir)) return 0;
    let count = 0;
    const stack = [rootDir];
    while (stack.length > 0) {
        const current = stack.pop();
        const entries = fs.readdirSync(current, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.name.startsWith('.')) continue;
            const abs = path.join(current, entry.name);
            if (entry.isDirectory()) {
                stack.push(abs);
                continue;
            }
            if (!entry.isFile()) continue;
            // Keep this lightweight: only skip manifest metadata explicitly.
            // README.md is counted as a document because it is user-readable content.
            if (entry.name === 'manifest.json') continue;
            const ext = path.extname(entry.name).toLowerCase();
            if (DOCUMENT_EXTS.has(ext)) count++;
        }
    }
    return count;
}

function readCacheManifest(cacheRoot) {
    const manifestPath = path.join(cacheRoot, 'manifest.json');
    return safeReadJson(manifestPath, null);
}

function buildInstalledCacheRecord({ id, title, source, cacheRoot, manifest, loadedSet }) {
    const meta = normalizeCacheManifestMetadata(manifest);
    const markdownEntries = source === 'archive/core'
        ? listMarkdownEntries(cacheRoot, 'archive-core')
        : listMarkdownEntries(cacheRoot, 'archive-cache/' + id);
    const sourcePrefix = source === 'archive/core'
        ? 'archive/core'
        : 'archive/caches/' + id;
    return {
        id,
        title: String(title || id).trim() || id,
        source,
        sourcePrefix,
        level: meta.level,
        status: meta.status,
        scope: meta.scope,
        loaded: loadedSet.has(id),
        documentCount: countDocuments(cacheRoot),
        firstReaderEntryId: markdownEntries[0] ? markdownEntries[0].entryId : null,
        readerEntries: markdownEntries,
        manifest: manifest || null,
    };
}

function listInstalledCaches() {
    const loaded = readLoadedCachesState();
    const loadedSet = new Set(loaded.loaded.map(entry => entry.id));
    const out = [];

    if (fs.existsSync(ARCHIVE_CORE_DIR)) {
        const coreManifest = readCacheManifest(ARCHIVE_CORE_DIR);
        out.push(buildInstalledCacheRecord({
            id: 'green-fire-core',
            title: coreManifest && (coreManifest.title || coreManifest.name) ? (coreManifest.title || coreManifest.name) : 'Green Fire Core',
            source: 'archive/core',
            cacheRoot: ARCHIVE_CORE_DIR,
            manifest: coreManifest,
            loadedSet,
        }));
    }

    if (fs.existsSync(ARCHIVE_CACHES_DIR)) {
        const entries = fs.readdirSync(ARCHIVE_CACHES_DIR, { withFileTypes: true })
            .filter(entry => entry.isDirectory() && CACHE_ID_PATTERN.test(entry.name))
            .sort((a, b) => a.name.localeCompare(b.name));
        entries.forEach(entry => {
            const cacheId = entry.name;
            const cacheRoot = path.join(ARCHIVE_CACHES_DIR, cacheId);
            const manifest = readCacheManifest(cacheRoot);
            const title = manifest && (manifest.title || manifest.name) ? (manifest.title || manifest.name) : cacheId;
            out.push(buildInstalledCacheRecord({
                id: cacheId,
                title,
                source: 'archive/caches/' + cacheId,
                cacheRoot,
                manifest,
                loadedSet,
            }));
        });
    }

    return out;
}

function getInstalledCacheById(cacheId) {
    const id = String(cacheId || '').trim();
    if (!id) return null;
    return listInstalledCaches().find(cache => cache.id === id) || null;
}

function listLoadedCaches() {
    return readLoadedCachesState().loaded;
}

function loadCache(cache) {
    const installed = cache && typeof cache === 'object' ? cache : null;
    if (!installed || !installed.id) {
        const err = new Error('Cache not found.');
        err.status = 404;
        throw err;
    }
    const state = readLoadedCachesState();
    const exists = state.loaded.find(entry => entry.id === installed.id);
    if (exists) {
        return {
            changed: false,
            entry: exists,
            state,
        };
    }
    const now = new Date().toISOString();
    const entry = normalizeLoadedEntry({
        id: installed.id,
        title: installed.title,
        level: installed.level,
        source: installed.source,
        loaded_at: now,
    });
    state.loaded.unshift(entry);
    state.updated_at = now;
    writeLoadedCachesState(state);
    return {
        changed: true,
        entry,
        state,
    };
}

function unloadCache(cacheId) {
    const id = String(cacheId || '').trim();
    if (!id) {
        const err = new Error('cacheId is required');
        err.status = 400;
        throw err;
    }
    const state = readLoadedCachesState();
    const before = state.loaded.length;
    state.loaded = state.loaded.filter(entry => entry.id !== id);
    const changed = state.loaded.length !== before;
    if (changed) {
        state.updated_at = new Date().toISOString();
        writeLoadedCachesState(state);
    }
    return { changed, state };
}

function getLoadedCacheLookup() {
    const loaded = listLoadedCaches();
    const ids = new Set(loaded.map(entry => entry.id));
    return { ids };
}

module.exports = {
    CACHE_LEVELS,
    CACHE_STATUSES,
    normalizeCacheManifestMetadata,
    readLoadedCachesState,
    writeLoadedCachesState,
    listInstalledCaches,
    getInstalledCacheById,
    listLoadedCaches,
    loadCache,
    unloadCache,
    getLoadedCacheLookup,
    // Deprecated aliases
    readEquippedCachesState: readLoadedCachesState,
    writeEquippedCachesState: writeLoadedCachesState,
    listEquippedCaches: listLoadedCaches,
    equipCache: loadCache,
    unequipCache: unloadCache,
    getEquippedCacheLookup: getLoadedCacheLookup,
};
