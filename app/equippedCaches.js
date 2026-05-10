'use strict';

// Deprecated compatibility shim for legacy equipped-cache imports.
// Canonical module: ./loadedCaches

const loadedCaches = require('./loadedCaches');

module.exports = {
    ...loadedCaches,
    // Deprecated aliases
    readEquippedCachesState: loadedCaches.readLoadedCachesState,
    writeEquippedCachesState: loadedCaches.writeLoadedCachesState,
    listEquippedCaches: loadedCaches.listLoadedCaches,
    equipCache: loadedCaches.loadCache,
    unequipCache: loadedCaches.unloadCache,
    getEquippedCacheLookup: loadedCaches.getLoadedCacheLookup,
};
