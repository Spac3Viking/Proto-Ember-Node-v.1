'use strict';

const fs      = require('fs');
const path    = require('path');
const axios   = require('axios');
const AdmZip  = require('adm-zip');

const { ARCHIVE_CORE_DIR, ARCHIVE_CACHES_DIR, SYSTEM_DIR } = require('./storageConfig');

const GREEN_FIRE_ARCHIVE_BASE_URL = 'https://greenfire-archive.replit.app';
const ARCHIVE_ENDPOINTS = {
    downloadsIndex: GREEN_FIRE_ARCHIVE_BASE_URL + '/downloads/index.json',
    signal:         GREEN_FIRE_ARCHIVE_BASE_URL + '/data/signal.json',
    searchIndex:    GREEN_FIRE_ARCHIVE_BASE_URL + '/search-index.json',
    glossaryTerms:  GREEN_FIRE_ARCHIVE_BASE_URL + '/glossary-terms.json',
    mythicSeedTxt:  GREEN_FIRE_ARCHIVE_BASE_URL + '/mythic-mirror-seed.txt',
    mythicSeedMd:   GREEN_FIRE_ARCHIVE_BASE_URL + '/mythic-mirror-seed.md',
    forgeMd:        GREEN_FIRE_ARCHIVE_BASE_URL + '/codices/markdown/early-essays/green-fire-forge.md',
    forgePdf:       GREEN_FIRE_ARCHIVE_BASE_URL + '/assets/green-fire-forge.pdf',
};

const CANONICAL_CACHE_PACKAGE_IDS = [
    'green-fire-core',
    'green-fire-codices-cache',
    'green-fire-sagas-cache',
    'green-fire-grimoires-cache',
    'green-fire-reference-cache',
    'green-fire-gallery-cache',
    'green-fire-complete-cache',
];

const CANONICAL_CACHE_PACKAGE_ID_SET = new Set(CANONICAL_CACHE_PACKAGE_IDS);
const ARCHIVE_CACHE_INDEX_FILE = path.join(ARCHIVE_CACHES_DIR, '_green-fire-upstream-index.json');
const ARCHIVE_CACHE_REGISTRY_FILE = path.join(SYSTEM_DIR, 'archive-cache-registry.json');
const ARCHIVE_SIGNAL_CACHE_FILE = path.join(ARCHIVE_CACHES_DIR, '_green-fire-signal.json');
const BUNDLED_CACHES_DIR = path.join(__dirname, 'bundled-caches');
const BUNDLED_CORE_CACHE_FILE = path.join(BUNDLED_CACHES_DIR, 'green-fire-core-cache.zip');
const CANONICAL_PACKAGE_DOWNLOAD_URLS = Object.fromEntries(
    CANONICAL_CACHE_PACKAGE_IDS.map(id => [id, GREEN_FIRE_ARCHIVE_BASE_URL + '/downloads/' + id + '.zip']),
);

function _ensureCachesDir() {
    if (!fs.existsSync(ARCHIVE_CACHES_DIR)) {
        fs.mkdirSync(ARCHIVE_CACHES_DIR, { recursive: true });
    }
}

function _saveLocalIndexCache(payload) {
    _ensureCachesDir();
    fs.writeFileSync(ARCHIVE_CACHE_INDEX_FILE, JSON.stringify(payload, null, 2), 'utf8');
}

function _loadLocalIndexCache() {
    if (!fs.existsSync(ARCHIVE_CACHE_INDEX_FILE)) return null;
    try {
        return JSON.parse(fs.readFileSync(ARCHIVE_CACHE_INDEX_FILE, 'utf8'));
    } catch {
        return null;
    }
}

function _recommendedDestinationForPackage(packageId) {
    return packageId === 'green-fire-core'
        ? 'archive/core'
        : 'archive/caches/' + packageId;
}

function _loadArchiveCacheRegistry() {
    if (!fs.existsSync(ARCHIVE_CACHE_REGISTRY_FILE)) {
        return { updatedAt: null, caches: {} };
    }
    try {
        const parsed = JSON.parse(fs.readFileSync(ARCHIVE_CACHE_REGISTRY_FILE, 'utf8'));
        return {
            updatedAt: parsed && parsed.updatedAt ? parsed.updatedAt : null,
            caches: parsed && parsed.caches && typeof parsed.caches === 'object' ? parsed.caches : {},
        };
    } catch {
        return { updatedAt: null, caches: {} };
    }
}

function _saveArchiveCacheRegistry(registry) {
    fs.mkdirSync(path.dirname(ARCHIVE_CACHE_REGISTRY_FILE), { recursive: true });
    fs.writeFileSync(
        ARCHIVE_CACHE_REGISTRY_FILE,
        JSON.stringify(registry, null, 2),
        'utf8',
    );
}

function loadArchiveCacheRegistry() {
    return _loadArchiveCacheRegistry();
}

function _normalizeDownloadUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return null;
    if (/^https?:\/\//i.test(rawUrl)) return rawUrl;
    return new URL(rawUrl, GREEN_FIRE_ARCHIVE_BASE_URL + '/').toString();
}

function _normalizeUpstreamPackage(pkg) {
    if (!pkg || typeof pkg !== 'object') return null;
    const packageId = String(pkg.id || pkg.packageId || pkg.slug || '').trim();
    if (!packageId || !CANONICAL_CACHE_PACKAGE_ID_SET.has(packageId)) return null;

    return {
        packageId,
        title:       String(pkg.title || pkg.name || packageId),
        description: typeof pkg.description === 'string' ? pkg.description : '',
        version:     String(pkg.version || pkg.release || '').trim(),
        lastUpdated: String(pkg.updatedAt || pkg.updated_at || pkg.lastUpdated || pkg.last_updated || '').trim() || null,
        sizeBytes:   Number.isFinite(Number(pkg.sizeBytes || pkg.size_bytes || pkg.size || pkg.bytes))
            ? Number(pkg.sizeBytes || pkg.size_bytes || pkg.size || pkg.bytes)
            : null,
        downloadUrl: _normalizeDownloadUrl(
            pkg.downloadUrl || pkg.download_url || pkg.url || pkg.zip || pkg.archive || pkg.file,
        ),
        manifestUrl: _normalizeDownloadUrl(pkg.manifestUrl || pkg.manifest_url || pkg.manifest || null),
        raw:         pkg,
    };
}

function normalizeUpstreamPackageIndex(data) {
    const rows = Array.isArray(data) ? data : Array.isArray(data && data.packages) ? data.packages : [];
    const out = [];
    const seen = new Set();

    for (const row of rows) {
        const normalized = _normalizeUpstreamPackage(row);
        if (!normalized) continue;
        if (seen.has(normalized.packageId)) continue;
        out.push(normalized);
        seen.add(normalized.packageId);
    }

    return out;
}

function _versionParts(version) {
    if (!version || typeof version !== 'string') return [];
    return version
        .replace(/^[^\d]*/, '')
        .split(/[.-]/)
        .map(v => {
            const parsed = parseInt(v, 10);
            return Number.isFinite(parsed) ? parsed : 0;
        });
}

function compareVersionStrings(a, b) {
    if (a === b) return 0;
    const aa = _versionParts(a);
    const bb = _versionParts(b);
    const len = Math.max(aa.length, bb.length);
    for (let i = 0; i < len; i++) {
        const av = aa[i] || 0;
        const bv = bb[i] || 0;
        if (av > bv) return 1;
        if (av < bv) return -1;
    }
    return 0;
}

async function fetchAvailableArchiveCachePackages() {
    try {
        const response = await axios.get(ARCHIVE_ENDPOINTS.downloadsIndex, { timeout: 12000 });
        const packages = normalizeUpstreamPackageIndex(response.data);

        _saveLocalIndexCache({
            source:    'upstream',
            fetchedAt: new Date().toISOString(),
            packages,
            raw:       response.data,
        });

        return {
            source:    'upstream',
            fetchedAt: new Date().toISOString(),
            packages,
            offline:   false,
        };
    } catch (err) {
        const cached = _loadLocalIndexCache();
        if (cached && Array.isArray(cached.packages)) {
            return {
                source:    'local-cache',
                fetchedAt: cached.fetchedAt || null,
                packages:  cached.packages,
                offline:   true,
                warning:   err.message,
            };
        }
        return {
            source:    'offline-empty',
            fetchedAt: null,
            packages:  [],
            offline:   true,
            warning:   err.message,
        };
    }
}

function _dirHasContent(dir) {
    if (!fs.existsSync(dir)) return false;
    let entries = [];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return false;
    }
    for (const entry of entries) {
        if (entry.name === '.gitkeep' || entry.name === '.DS_Store') continue;
        const full = path.join(dir, entry.name);
        if (entry.isFile()) return true;
        if (entry.isDirectory() && _dirHasContent(full)) return true;
    }
    return false;
}

function _findManifestPath(dir, depth = 3) {
    if (!fs.existsSync(dir) || depth < 0) return null;
    const direct = path.join(dir, 'manifest.json');
    if (fs.existsSync(direct)) return direct;
    if (depth === 0) return null;

    let entries = [];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return null;
    }
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const nested = _findManifestPath(path.join(dir, entry.name), depth - 1);
        if (nested) return nested;
    }
    return null;
}

function _readManifestIfPresent(manifestPath) {
    if (!manifestPath || !fs.existsSync(manifestPath)) return null;
    try {
        return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch {
        return null;
    }
}

function _isCoreScaffoldFile(relPath) {
    return relPath === 'manifest.json' ||
        relPath === '.gitkeep' ||
        relPath.startsWith('codices/.gitkeep') ||
        relPath.startsWith('grimoires/.gitkeep') ||
        relPath.startsWith('sagas/.gitkeep') ||
        relPath.startsWith('reference/.gitkeep');
}

function _coreDirHasUserContent(dir) {
    if (!fs.existsSync(dir)) return false;
    const stack = [{ abs: dir, rel: '' }];

    while (stack.length > 0) {
        const current = stack.pop();
        let entries = [];
        try {
            entries = fs.readdirSync(current.abs, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            const abs = path.join(current.abs, entry.name);
            const rel = current.rel ? (current.rel + '/' + entry.name) : entry.name;
            if (entry.isDirectory()) {
                stack.push({ abs, rel });
                continue;
            }
            if (_isCoreScaffoldFile(rel)) continue;
            return true;
        }
    }

    return false;
}

function _safeRel(rel) {
    const clean = rel.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!clean || clean === '.' || clean === '..') return null;
    const normalized = path.posix.normalize(clean);
    if (normalized.startsWith('../') || normalized.includes('/../') || normalized === '..') return null;
    return normalized;
}

function _stripPrefixFromPath(relPath, prefixes) {
    for (const prefix of prefixes) {
        const p = prefix.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
        if (!p) continue;
        if (relPath === p) return '';
        if (relPath.startsWith(p + '/')) return relPath.slice(p.length + 1);
    }
    return relPath;
}

function _resolveEntryRelativePath(entryName, packageId) {
    let rel = _safeRel(entryName);
    if (!rel) return null;

    if (packageId === 'green-fire-core') {
        rel = _stripPrefixFromPath(rel, [
            'archive/core',
            'core',
            'green-fire-core',
        ]);
    } else {
        rel = _stripPrefixFromPath(rel, [
            'archive/caches/' + packageId,
            'caches/' + packageId,
            packageId,
        ]);
    }

    return _safeRel(rel);
}

function _writeZipToTarget(buffer, packageId, targetDir, options = {}) {
    const zip = new AdmZip(Buffer.from(buffer));
    const base = path.resolve(targetDir);
    const overwrite = options.overwrite !== false;

    for (const entry of zip.getEntries()) {
        const rel = _resolveEntryRelativePath(entry.entryName, packageId);
        if (!rel) continue;

        const destination = path.resolve(path.join(base, rel));
        if (!destination.startsWith(base + path.sep) && destination !== base) {
            throw new Error('Unsafe zip path detected: ' + entry.entryName);
        }

        if (entry.isDirectory) {
            fs.mkdirSync(destination, { recursive: true });
            continue;
        }

        fs.mkdirSync(path.dirname(destination), { recursive: true });
        if (!overwrite && fs.existsSync(destination)) continue;
        fs.writeFileSync(destination, entry.getData());
    }
}

function _targetDirectoryForPackage(packageId) {
    if (packageId === 'green-fire-core') {
        return ARCHIVE_CORE_DIR;
    }
    return path.join(ARCHIVE_CACHES_DIR, packageId);
}

function listInstalledArchiveCaches() {
    const installed = [];
    const registry = _loadArchiveCacheRegistry();

    for (const packageId of CANONICAL_CACHE_PACKAGE_IDS) {
        const installPath = _targetDirectoryForPackage(packageId);
        const manifestPath = _findManifestPath(installPath);
        const manifest = _readManifestIfPresent(manifestPath);
        const hasData = _dirHasContent(installPath);
        const isInstalled = Boolean(manifest || hasData);
        const registryEntry = registry.caches[packageId] || null;
        installed.push({
            packageId,
            installPath,
            recommendedDestination: _recommendedDestinationForPackage(packageId),
            installed: isInstalled,
            version:   manifest && manifest.version ? String(manifest.version) : null,
            manifest,
            registry: registryEntry,
        });
    }

    return installed;
}

async function compareInstalledWithUpstream() {
    const upstream = await fetchAvailableArchiveCachePackages();
    const upstreamById = new Map(upstream.packages.map(p => [p.packageId, p]));
    const local = listInstalledArchiveCaches();

    const comparison = local.map(item => {
        const remote = upstreamById.get(item.packageId) || null;
        const localVersion = item.version || null;
        const upstreamVersion = remote && remote.version ? remote.version : null;

        let status = 'not-installed';
        if (item.installed) {
            if (!localVersion || !upstreamVersion) {
                status = 'version-unknown';
            } else {
                const cmp = compareVersionStrings(localVersion, upstreamVersion);
                if (cmp < 0) status = 'update-available';
                else if (cmp > 0) status = 'ahead-local';
                else status = 'up-to-date';
            }
        }

        return {
            packageId: item.packageId,
            installed: item.installed,
            installPath: item.installPath,
            recommendedDestination: item.recommendedDestination,
            localVersion,
            upstreamVersion,
            status,
            upstreamPackage: remote,
            manifest: item.manifest,
            registry: item.registry,
        };
    });

    return {
        source: upstream.source,
        offline: upstream.offline,
        fetchedAt: upstream.fetchedAt,
        warning: upstream.warning,
        comparison,
    };
}

async function installArchiveCachePackage({ packageId }) {
    if (!CANONICAL_CACHE_PACKAGE_ID_SET.has(packageId)) {
        throw new Error('Unknown packageId: ' + packageId);
    }

    const available = await fetchAvailableArchiveCachePackages();
    const remote = available.packages.find(p => p.packageId === packageId) || null;
    const resolvedUrl = CANONICAL_PACKAGE_DOWNLOAD_URLS[packageId];
    if (remote && remote.downloadUrl && remote.downloadUrl !== resolvedUrl) {
        console.warn(
            '[archive-cache] Upstream download URL mismatch for ' + packageId +
            '. Using canonical URL: ' + resolvedUrl,
        );
    }

    const targetDir = _targetDirectoryForPackage(packageId);
    if (packageId !== 'green-fire-core') {
        fs.rmSync(targetDir, { recursive: true, force: true });
    }
    fs.mkdirSync(targetDir, { recursive: true });

    const response = await axios.get(resolvedUrl, {
        timeout: 30000,
        responseType: 'arraybuffer',
    });

    _writeZipToTarget(response.data, packageId, targetDir);

    const manifestPath = _findManifestPath(targetDir);
    const manifest = _readManifestIfPresent(manifestPath);
    const installedVersion = manifest && manifest.version
        ? String(manifest.version)
        : remote && remote.version
            ? remote.version
            : null;
    const now = new Date().toISOString();
    const registry = _loadArchiveCacheRegistry();
    const existing = registry.caches[packageId] || {};
    registry.caches[packageId] = {
        packageId,
        title: remote && remote.title ? remote.title : packageId,
        installPath: targetDir,
        destination: _recommendedDestinationForPackage(packageId),
        installedVersion,
        installedAt: existing.installedAt || now,
        lastUpdated: now,
        source: available.source,
        downloadUrl: resolvedUrl,
    };
    registry.updatedAt = now;
    _saveArchiveCacheRegistry(registry);

    return {
        packageId,
        downloadUrl: resolvedUrl,
        installPath: targetDir,
        manifestPath,
        manifest,
        installedVersion,
        source: available.source,
        offline: available.offline,
        registry: registry.caches[packageId],
    };
}

function installBundledCoreCache(options = {}) {
    const now = new Date().toISOString();
    const force = options.force === true;

    if (!fs.existsSync(BUNDLED_CORE_CACHE_FILE)) {
        return {
            packageId: 'green-fire-core',
            installed: false,
            skipped: true,
            reason: 'bundled-core-cache-missing',
            bundledPath: BUNDLED_CORE_CACHE_FILE,
            installPath: ARCHIVE_CORE_DIR,
        };
    }

    if (!force && _coreDirHasUserContent(ARCHIVE_CORE_DIR)) {
        return {
            packageId: 'green-fire-core',
            installed: false,
            skipped: true,
            reason: 'core-has-user-content',
            bundledPath: BUNDLED_CORE_CACHE_FILE,
            installPath: ARCHIVE_CORE_DIR,
        };
    }

    fs.mkdirSync(ARCHIVE_CORE_DIR, { recursive: true });
    const zipBuffer = fs.readFileSync(BUNDLED_CORE_CACHE_FILE);
    _writeZipToTarget(zipBuffer, 'green-fire-core', ARCHIVE_CORE_DIR, {
        overwrite: !_coreDirHasUserContent(ARCHIVE_CORE_DIR),
    });

    const manifestPath = _findManifestPath(ARCHIVE_CORE_DIR);
    const manifest = _readManifestIfPresent(manifestPath);
    const installedVersion = manifest && manifest.version ? String(manifest.version) : null;

    const registry = _loadArchiveCacheRegistry();
    const existing = registry.caches['green-fire-core'] || {};
    registry.caches['green-fire-core'] = {
        packageId: 'green-fire-core',
        title: manifest && manifest.title ? manifest.title : 'Green Fire Core Archive',
        installPath: ARCHIVE_CORE_DIR,
        destination: 'archive/core',
        installedVersion,
        installedAt: existing.installedAt || now,
        lastUpdated: now,
        source: 'bundled',
        bundledPath: BUNDLED_CORE_CACHE_FILE,
    };
    registry.updatedAt = now;
    _saveArchiveCacheRegistry(registry);

    return {
        packageId: 'green-fire-core',
        installed: true,
        skipped: false,
        source: 'bundled',
        bundledPath: BUNDLED_CORE_CACHE_FILE,
        installPath: ARCHIVE_CORE_DIR,
        manifestPath,
        manifest,
        installedVersion,
        registry: registry.caches['green-fire-core'],
    };
}

async function fetchArchiveSignal() {
    try {
        const response = await axios.get(ARCHIVE_ENDPOINTS.signal, { timeout: 12000 });
        const payload = response.data && typeof response.data === 'object'
            ? response.data
            : { value: response.data };
        const fetchedAt = new Date().toISOString();
        _ensureCachesDir();
        fs.writeFileSync(
            ARCHIVE_SIGNAL_CACHE_FILE,
            JSON.stringify({ fetchedAt, payload }, null, 2),
            'utf8',
        );
        return {
            source: 'upstream',
            offline: false,
            fetchedAt,
            payload,
        };
    } catch (err) {
        if (fs.existsSync(ARCHIVE_SIGNAL_CACHE_FILE)) {
            try {
                const cached = JSON.parse(fs.readFileSync(ARCHIVE_SIGNAL_CACHE_FILE, 'utf8'));
                return {
                    source: 'local-cache',
                    offline: true,
                    fetchedAt: cached.fetchedAt || null,
                    payload: cached.payload || {},
                    warning: err.message,
                };
            } catch { /* ignore local parse failure */ }
        }
        return {
            source: 'offline-empty',
            offline: true,
            fetchedAt: null,
            payload: {},
            warning: err.message,
        };
    }
}

module.exports = {
    GREEN_FIRE_ARCHIVE_BASE_URL,
    ARCHIVE_ENDPOINTS,
    ARCHIVE_CACHE_INDEX_FILE,
    ARCHIVE_CACHE_REGISTRY_FILE,
    ARCHIVE_SIGNAL_CACHE_FILE,
    BUNDLED_CACHES_DIR,
    BUNDLED_CORE_CACHE_FILE,
    CANONICAL_CACHE_PACKAGE_IDS,
    CANONICAL_PACKAGE_DOWNLOAD_URLS,
    compareVersionStrings,
    normalizeUpstreamPackageIndex,
    fetchAvailableArchiveCachePackages,
    fetchArchiveSignal,
    loadArchiveCacheRegistry,
    listInstalledArchiveCaches,
    compareInstalledWithUpstream,
    installArchiveCachePackage,
    installBundledCoreCache,
};
