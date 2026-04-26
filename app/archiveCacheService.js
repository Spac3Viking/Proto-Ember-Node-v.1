'use strict';

const fs      = require('fs');
const path    = require('path');
const axios   = require('axios');
const AdmZip  = require('adm-zip');

const { ARCHIVE_CORE_DIR, ARCHIVE_CACHES_DIR } = require('./storageConfig');

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

function _writeZipToTarget(buffer, packageId, targetDir) {
    const zip = new AdmZip(Buffer.from(buffer));
    const base = path.resolve(targetDir);

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

    for (const packageId of CANONICAL_CACHE_PACKAGE_IDS) {
        const installPath = _targetDirectoryForPackage(packageId);
        const manifestPath = _findManifestPath(installPath);
        const manifest = _readManifestIfPresent(manifestPath);
        const hasData = _dirHasContent(installPath);
        const isInstalled = Boolean(manifest || hasData);
        installed.push({
            packageId,
            installPath,
            installed: isInstalled,
            version:   manifest && manifest.version ? String(manifest.version) : null,
            manifest,
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
            localVersion,
            upstreamVersion,
            status,
            upstreamPackage: remote,
            manifest: item.manifest,
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

async function installArchiveCachePackage({ packageId, downloadUrl }) {
    if (!CANONICAL_CACHE_PACKAGE_ID_SET.has(packageId)) {
        throw new Error('Unknown packageId: ' + packageId);
    }

    const available = await fetchAvailableArchiveCachePackages();
    const remote = available.packages.find(p => p.packageId === packageId) || null;
    const resolvedUrl = _normalizeDownloadUrl(downloadUrl || (remote && remote.downloadUrl));

    if (!resolvedUrl) {
        throw new Error('No download URL available for package: ' + packageId);
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

    return {
        packageId,
        downloadUrl: resolvedUrl,
        installPath: targetDir,
        manifestPath,
        manifest,
        installedVersion,
        source: available.source,
        offline: available.offline,
    };
}

module.exports = {
    GREEN_FIRE_ARCHIVE_BASE_URL,
    ARCHIVE_ENDPOINTS,
    ARCHIVE_CACHE_INDEX_FILE,
    CANONICAL_CACHE_PACKAGE_IDS,
    compareVersionStrings,
    normalizeUpstreamPackageIndex,
    fetchAvailableArchiveCachePackages,
    listInstalledArchiveCaches,
    compareInstalledWithUpstream,
    installArchiveCachePackage,
};
