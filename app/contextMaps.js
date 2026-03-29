/**
 * Ember Node v.ᚠ — Phase 11 Context Maps
 *
 * Context Maps are distilled context artifacts representing the current
 * state of a room, project, or thread cluster.  They allow rooms to share
 * understanding without sharing all raw memory.
 *
 * Map types:
 *   working  — frequently updated lightweight summaries used as bootstraps
 *   remembered — stable curated summaries worth preserving long-term
 *
 * Storage:
 *   DATA_ROOT/hearth/maps/<mapId>.json
 *   DATA_ROOT/workshop/maps/<mapId>.json
 *   DATA_ROOT/threshold/maps/<mapId>.json
 *
 * Map schema:
 *   {
 *     id,           — unique map identifier (e.g. 'hearth-working')
 *     room,         — owning room
 *     mapType,      — 'working' | 'remembered'
 *     title,
 *     createdAt,
 *     updatedAt,
 *     content,      — structured map content object (room-specific)
 *   }
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const {
    MAPS_DIRS, THREADS_DIR, DATA_ROOT,
} = require('./storageConfig');
const { loadManifests } = require('./indexStore');
const { listThreadSummaries } = require('./threadMemory');

// ── Map persistence helpers ───────────────────────────────────────────────────

/**
 * Path to a context map JSON file.
 * @param {string} room
 * @param {string} mapId
 * @returns {string}
 */
function mapFilePath(room, mapId) {
    const safe = mapId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(MAPS_DIRS[room], safe + '.json');
}

/**
 * Load a context map from disk.
 * Returns null if it does not exist or is unreadable.
 *
 * @param {string} room
 * @param {string} mapId
 * @returns {object|null}
 */
function loadContextMap(room, mapId) {
    if (!MAPS_DIRS[room]) return null;
    const file = mapFilePath(room, mapId);
    if (!fs.existsSync(file)) return null;
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { return null; }
}

/**
 * Save a context map to disk.
 *
 * @param {string} room
 * @param {object} map
 */
function saveContextMap(room, map) {
    const dir = MAPS_DIRS[room];
    if (!dir) return;
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(mapFilePath(room, map.id), JSON.stringify(map, null, 2), 'utf8');
}

/**
 * List all context maps for a room.
 *
 * @param {string} room
 * @returns {object[]}
 */
function listContextMaps(room) {
    const dir = MAPS_DIRS[room];
    if (!dir || !fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
        .filter(f => f.endsWith('.json'))
        .map(f => {
            try {
                return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
            } catch { return null; }
        })
        .filter(Boolean)
        .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

/**
 * Return the most recently updated working map for a room, or null.
 *
 * @param {string} room
 * @returns {object|null}
 */
function getWorkingMap(room) {
    const maps = listContextMaps(room).filter(m => m.mapType === 'working');
    return maps.length > 0 ? maps[0] : null;
}

// ── Map generation ────────────────────────────────────────────────────────────

/**
 * Generate the Hearth working map.
 *
 * Content:
 *   - remembered thread summaries (titles + excerpt)
 *   - trusted archive source count by shelf
 *   - most recently updated sources in hearth
 *
 * @returns {object}  Map object (not yet saved)
 */
function buildHearthMap() {
    const manifests    = loadManifests();
    const hearthSrcs   = Object.values(manifests).filter(m => m.room === 'hearth');
    const archiveSrcs  = hearthSrcs.filter(m => m.sourceClass === 'trusted-archive');
    const nativeSrcs   = hearthSrcs.filter(m => m.sourceClass !== 'trusted-archive');

    // Aggregate archive sources by shelf
    const archiveByShelf = {};
    for (const src of archiveSrcs) {
        const shelf = src.shelf || 'archive';
        archiveByShelf[shelf] = (archiveByShelf[shelf] || 0) + 1;
    }

    // Recent native hearth sources
    const recentNative = nativeSrcs
        .slice()
        .sort((a, b) => (b.rememberedAt || b.ingestTimestamp || '').localeCompare(
            a.rememberedAt || a.ingestTimestamp || '',
        ))
        .slice(0, 5)
        .map(s => ({ id: s.id, title: s.title || s.file, shelf: s.shelf || null }));

    // Remembered threads
    const rememberedThreads = listThreadSummaries().slice(0, 10).map(s => ({
        id:      s.id,
        title:   s.title,
        themes:  s.themes || [],
        excerpt: s.excerpt ? s.excerpt.slice(0, 120) : '',
    }));

    const now = new Date().toISOString();

    return {
        id:        'hearth-working',
        room:      'hearth',
        mapType:   'working',
        title:     'Hearth Working Map',
        createdAt: now,
        updatedAt: now,
        content: {
            rememberedThreads,
            archiveByShelf,
            recentSources: recentNative,
            archiveSourceCount:  archiveSrcs.length,
            nativeSourceCount:   nativeSrcs.length,
        },
    };
}

/**
 * Generate the Workshop working map.
 *
 * Content:
 *   - workshop sources grouped by shelf / project
 *   - recent sources
 *
 * @returns {object}
 */
function buildWorkshopMap() {
    const manifests   = loadManifests();
    const workshopSrcs = Object.values(manifests).filter(m => m.room === 'workshop');

    const byShelf = {};
    for (const src of workshopSrcs) {
        const shelf = src.shelf || 'general';
        if (!byShelf[shelf]) byShelf[shelf] = [];
        byShelf[shelf].push({ id: src.id, title: src.title || src.file });
    }

    const recentSources = workshopSrcs
        .slice()
        .sort((a, b) => (b.ingestTimestamp || '').localeCompare(a.ingestTimestamp || ''))
        .slice(0, 5)
        .map(s => ({ id: s.id, title: s.title || s.file, shelf: s.shelf || null }));

    const now = new Date().toISOString();

    return {
        id:        'workshop-working',
        room:      'workshop',
        mapType:   'working',
        title:     'Workshop Working Map',
        createdAt: now,
        updatedAt: now,
        content: {
            sourcesByShelf:  byShelf,
            recentSources,
            totalSources:    workshopSrcs.length,
        },
    };
}

/**
 * Generate the Threshold working map.
 *
 * Content:
 *   - waiting / changed / flagged sources
 *   - total source counts by status
 *
 * @returns {object}
 */
function buildThresholdMap() {
    const manifests      = loadManifests();
    const thresholdSrcs  = Object.values(manifests).filter(m => m.room === 'threshold');

    const byStatus = {};
    for (const src of thresholdSrcs) {
        const st = src.status || 'waiting';
        byStatus[st] = (byStatus[st] || 0) + 1;
    }

    const waitingItems = thresholdSrcs
        .filter(s => s.status === 'waiting' || !s.status)
        .slice(0, 10)
        .map(s => ({ id: s.id, title: s.title || s.file, sourceType: s.sourceType }));

    const flaggedItems = thresholdSrcs
        .filter(s => s.status === 'flagged')
        .map(s => ({ id: s.id, title: s.title || s.file, sourceType: s.sourceType }));

    const now = new Date().toISOString();

    return {
        id:        'threshold-working',
        room:      'threshold',
        mapType:   'working',
        title:     'Threshold Working Map',
        createdAt: now,
        updatedAt: now,
        content: {
            byStatus,
            waitingItems,
            flaggedItems,
            totalSources: thresholdSrcs.length,
        },
    };
}

// ── Refresh API ───────────────────────────────────────────────────────────────

/**
 * Refresh the working context map for a room and persist it.
 *
 * @param {string} room  'hearth' | 'workshop' | 'threshold'
 * @returns {object}     The refreshed map
 */
function refreshWorkingMap(room) {
    let map;
    if (room === 'hearth')     map = buildHearthMap();
    else if (room === 'workshop')  map = buildWorkshopMap();
    else if (room === 'threshold') map = buildThresholdMap();
    else throw new Error('Unknown room: ' + room);

    saveContextMap(room, map);
    return map;
}

/**
 * Return the working map for a room, refreshing it if it does not yet exist.
 *
 * @param {string} room
 * @returns {object}
 */
function ensureWorkingMap(room) {
    const existing = getWorkingMap(room);
    if (existing) return existing;
    return refreshWorkingMap(room);
}

/**
 * Promote the current working map to a remembered map.
 * The remembered map is stored with a timestamped ID.
 *
 * @param {string} room
 * @returns {object}  The saved remembered map
 */
function promoteToRememberedMap(room) {
    const working = getWorkingMap(room);
    if (!working) throw new Error('No working map to promote for room: ' + room);

    const now = new Date().toISOString();
    const rememberedMap = Object.assign({}, working, {
        id:        room + '-remembered-' + Date.now(),
        mapType:   'remembered',
        updatedAt: now,
    });

    saveContextMap(room, rememberedMap);
    return rememberedMap;
}

/**
 * Assemble a cross-room context packet for inclusion in chat prompts.
 *
 * Each room's context includes:
 *   1. Its own working map
 *   2. Selected imported maps from other rooms (as per inter-room rules)
 *
 * @param {string} room
 * @returns {{ native: object|null, imported: object[] }}
 */
function assembleRoomContext(room) {
    const native   = ensureWorkingMap(room);
    const imported = [];

    if (room === 'hearth') {
        // Hearth imports: Workshop map, Threshold map (lightweight)
        const wMap = getWorkingMap('workshop');
        const tMap = getWorkingMap('threshold');
        if (wMap) imported.push(wMap);
        if (tMap) imported.push(tMap);
    } else if (room === 'workshop') {
        // Workshop imports: Hearth memory map
        const hMap = getWorkingMap('hearth');
        if (hMap) imported.push(hMap);
    } else if (room === 'threshold') {
        // Threshold is lightweight — optionally import hearth policy summary
        const hMap = getWorkingMap('hearth');
        if (hMap) {
            // Only include the bare minimum: archive categories + title
            imported.push({
                id:      hMap.id,
                room:    hMap.room,
                mapType: 'policy-summary',
                title:   hMap.title,
                content: {
                    archiveByShelf: (hMap.content || {}).archiveByShelf,
                },
            });
        }
    }

    return { native, imported };
}

module.exports = {
    loadContextMap,
    saveContextMap,
    listContextMaps,
    getWorkingMap,
    buildHearthMap,
    buildWorkshopMap,
    buildThresholdMap,
    refreshWorkingMap,
    ensureWorkingMap,
    promoteToRememberedMap,
    assembleRoomContext,
};
