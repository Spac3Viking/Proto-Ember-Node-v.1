'use strict';

const fs      = require('fs');
const path    = require('path');
const axios   = require('axios');
const AdmZip  = require('adm-zip');

const { ARCHIVE_CORE_DIR, ARCHIVE_CACHES_DIR, ARCHIVE_PACKAGES_DIR, SYSTEM_DIR } = require('./storageConfig');
const { ARCHIVE_BASE_URL } = require('./runtimeConfig');

// Optional hosted Green Fire Archive used for cache-package updates. Centrally
// configured (EMBER_ARCHIVE_BASE_URL) — see app/runtimeConfig.js. This is a
// separate concern from the local Ollama runtime and is never assumed to be
// interchangeable with any other Green Fire domain (e.g. greenfirearchive.app).
const GREEN_FIRE_ARCHIVE_BASE_URL = ARCHIVE_BASE_URL;
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
const CANONICAL_CACHE_DOCUMENTS_DIR = 'documents';
const CANONICAL_CACHE_ARTIFACTS_DIR = 'artifacts';
const CANONICAL_DOCUMENTS_HINTS = new Set([
    'documents',
    'document',
    'summaries',
    'summary',
    'bootstrap',
    'bootstraps',
    'handoff',
    'handoffs',
    'distillation',
    'distillations',
    'distillation-notes',
    'notes',
    'markdown',
    'md',
]);
const CANONICAL_ARTIFACT_HINTS = new Set([
    'artifact',
    'artifacts',
    'assets',
    'images',
    'image',
    'img',
    'scan',
    'scans',
    'source',
    'sources',
    'raw',
    'reference',
    'references',
]);
const ARCHIVE_CACHE_INDEX_FILE = path.join(ARCHIVE_CACHES_DIR, '_green-fire-upstream-index.json');
const ARCHIVE_CACHE_REGISTRY_FILE = path.join(SYSTEM_DIR, 'archive-cache-registry.json');
const ARCHIVE_SIGNAL_CACHE_FILE = path.join(ARCHIVE_CACHES_DIR, '_green-fire-signal.json');
const APPLICATION_ROOT = path.resolve(__dirname, '..');
const CANONICAL_BUNDLED_PACKAGES = {
    'green-fire-core-cache': {
        zipPath: path.join(APPLICATION_ROOT, 'green-fire-core-cache.zip'),
        packageRole: 'node-core',
    },
    'green-fire-library': {
        zipPath: path.join(APPLICATION_ROOT, 'green-fire-library.zip'),
        packageRole: 'knowledge-library',
    },
};
const CANONICAL_BUNDLED_PACKAGE_IDS = Object.freeze(Object.keys(CANONICAL_BUNDLED_PACKAGES));
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
        relPath === 'codices/.gitkeep' ||
        relPath === 'grimoires/.gitkeep' ||
        relPath === 'sagas/.gitkeep' ||
        relPath === 'reference/.gitkeep';
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
    if (typeof rel !== 'string' || !rel ||
        rel.startsWith('/') || rel.startsWith('\\') || /^[a-zA-Z]:/.test(rel) ||
        /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(rel)) {
        return null;
    }
    const clean = rel.replace(/\\/g, '/');
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

function _canonicalizeCacheEntryPath(relPath, packageId) {
    if (packageId === 'green-fire-core') return _safeRel(relPath);
    const normalized = _safeRel(relPath);
    if (!normalized) return null;
    if (normalized === 'manifest.json') return normalized;
    if (normalized === 'README.md') return normalized;
    if (normalized.startsWith('continuity/')) return null;
    if (normalized.startsWith(CANONICAL_CACHE_DOCUMENTS_DIR + '/')) return normalized;
    if (normalized.startsWith(CANONICAL_CACHE_ARTIFACTS_DIR + '/')) return normalized;

    const ext = path.posix.extname(normalized).toLowerCase();
    const segs = normalized.split('/');
    const first = String(segs[0] || '').toLowerCase();
    const rest = segs.slice(1).join('/');

    if (CANONICAL_DOCUMENTS_HINTS.has(first)) {
        if (!rest) return null;
        return CANONICAL_CACHE_DOCUMENTS_DIR + '/' + rest;
    }
    if (CANONICAL_ARTIFACT_HINTS.has(first)) {
        if (!rest) return null;
        return CANONICAL_CACHE_ARTIFACTS_DIR + '/' + rest;
    }

    if (ext === '.md' || ext === '.txt') {
        return CANONICAL_CACHE_DOCUMENTS_DIR + '/' + normalized;
    }

    // Unknown entries default to artifacts so source material is preserved without polluting
    // the documents layer that the node uses for primary markdown-first retrieval.
    return CANONICAL_CACHE_ARTIFACTS_DIR + '/' + normalized;
}

function _ensureCanonicalCacheLayers(targetDir, packageId) {
    if (packageId === 'green-fire-core') return;
    fs.mkdirSync(path.join(targetDir, CANONICAL_CACHE_DOCUMENTS_DIR), { recursive: true });
    fs.mkdirSync(path.join(targetDir, CANONICAL_CACHE_ARTIFACTS_DIR), { recursive: true });
}

function _writeZipToTarget(buffer, packageId, targetDir, options = {}) {
    const zip = new AdmZip(Buffer.from(buffer));
    const base = path.resolve(targetDir);
    const overwrite = options.overwrite ?? true;

    const entries = zip.getEntries();
    let hasManifest = false;
    let hasDocuments = false;
    for (const entry of entries) {
        const rel = _resolveEntryRelativePath(entry.entryName, packageId);
        if (!rel) continue;
        const normalized = _safeRel(rel);
        if (!normalized) continue;
        if (normalized === 'manifest.json') hasManifest = true;
        if (normalized.startsWith('documents/')) hasDocuments = true;
        if (normalized.startsWith('continuity/')) {
            throw new Error('Unsupported cache layer "continuity". Use "documents" instead.');
        }
    }
    if (packageId !== 'green-fire-core') {
        if (!hasManifest) throw new Error('Cache package missing required file: manifest.json');
        if (!hasDocuments) throw new Error('Cache package missing required folder: documents/');
    }

    for (const entry of entries) {
        const rel = _resolveEntryRelativePath(entry.entryName, packageId);
        if (!rel) continue;
        const canonicalRel = _canonicalizeCacheEntryPath(rel, packageId);
        if (!canonicalRel) continue;

        const destination = path.resolve(path.join(base, canonicalRel));
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
    _ensureCanonicalCacheLayers(targetDir, packageId);

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

function _packageInstallPath(packageId) {
    return path.join(ARCHIVE_PACKAGES_DIR, packageId);
}

function _isPathInside(baseDir, targetPath) {
    const relative = path.relative(baseDir, targetPath);
    return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

function _safePackageEntryPath(entryName, packageId) {
    const raw = String(entryName || '').replace(/\\/g, '/');
    if (!raw || raw.startsWith('/') || /^[a-zA-Z]:/.test(raw)) {
        throw new Error('Unsafe ZIP path: ' + entryName);
    }
    const normalized = path.posix.normalize(raw);
    if (normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
        throw new Error('Unsafe ZIP path: ' + entryName);
    }
    const parts = normalized.split('/');
    if (parts[0] !== packageId || parts.length < 2) {
        throw new Error('ZIP must contain exactly one package root: ' + packageId);
    }
    return parts.slice(1).join('/');
}

function _isZipSymlink(entry) {
    const attrs = entry.header && Number.isInteger(entry.header.attr) ? entry.header.attr : 0;
    return ((attrs >>> 16) & 0o170000) === 0o120000;
}

function _validatePackageDirectory(packageDir, packageId, packageRole) {
    const manifestPath = path.join(packageDir, 'manifest.json');
    const manifest = _readManifestIfPresent(manifestPath);
    if (!manifest || manifest.id !== packageId || manifest.schema_version !== '2.0' ||
        manifest.package_role !== packageRole || manifest.index_by_default !== true) {
        throw new Error('Invalid manifest for package: ' + packageId);
    }
    for (const declaredPath of [...(manifest.documents || []), ...(manifest.artifacts || [])]) {
        const rawPath = String(declaredPath || '').replace(/\\/g, '/');
        if (rawPath.startsWith('/') || /^[a-zA-Z]:/.test(rawPath)) {
            throw new Error('Unsafe manifest path: ' + declaredPath);
        }
        const safePath = _safeRel(rawPath);
        if (!safePath) throw new Error('Unsafe manifest path: ' + declaredPath);
        const candidate = path.resolve(packageDir, safePath);
        if (path.relative(packageDir, candidate).startsWith('..' + path.sep) || !fs.existsSync(candidate) ||
            !fs.lstatSync(candidate).isFile()) {
            throw new Error('Missing declared package file: ' + declaredPath);
        }
    }
    return manifest;
}

function _extractCanonicalPackage(zipPath, packageId, packageRole, stagingDir) {
    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries();
    const roots = new Set();
    for (const entry of entries) {
        if (_isZipSymlink(entry)) throw new Error('ZIP symlinks are not allowed: ' + entry.entryName);
        const raw = String(entry.entryName || '').replace(/\\/g, '/');
        if (!raw || raw.startsWith('/') || /^[a-zA-Z]:/.test(raw)) {
            throw new Error('Unsafe ZIP path: ' + entry.entryName);
        }
        const normalized = path.posix.normalize(raw);
        if (normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
            throw new Error('Unsafe ZIP path: ' + entry.entryName);
        }
        roots.add(normalized.split('/')[0]);
        const rel = _safePackageEntryPath(entry.entryName, packageId);
        if (!rel) continue;
        const destination = path.resolve(stagingDir, rel);
        if (path.relative(stagingDir, destination).startsWith('..' + path.sep)) {
            throw new Error('Unsafe ZIP path: ' + entry.entryName);
        }
        if (entry.isDirectory) {
            fs.mkdirSync(destination, { recursive: true });
        } else {
            fs.mkdirSync(path.dirname(destination), { recursive: true });
            fs.writeFileSync(destination, entry.getData());
        }
    }
    if (roots.size !== 1 || !roots.has(packageId)) {
        throw new Error('ZIP must contain exactly one package root: ' + packageId);
    }
    return _validatePackageDirectory(stagingDir, packageId, packageRole);
}

function validateBundledPackage(zipPath, packageId) {
    const definition = CANONICAL_BUNDLED_PACKAGES[packageId];
    if (!definition) throw new Error('Unknown canonical package: ' + packageId);
    fs.mkdirSync(ARCHIVE_PACKAGES_DIR, { recursive: true });
    const stagingDir = fs.mkdtempSync(path.join(ARCHIVE_PACKAGES_DIR, '.' + packageId + '-validate-'));
    try {
        return _extractCanonicalPackage(zipPath, packageId, definition.packageRole, stagingDir);
    } finally {
        fs.rmSync(stagingDir, { recursive: true, force: true });
    }
}

function installBundledCanonicalPackages(options = {}) {
    const packages = options.packages || CANONICAL_BUNDLED_PACKAGES;
    const force = options.force === true;
    fs.mkdirSync(ARCHIVE_PACKAGES_DIR, { recursive: true });
    return Object.entries(packages).map(([packageId, definition]) => {
        const targetDir = _packageInstallPath(packageId);
        if (!force) {
            try {
                const manifest = _validatePackageDirectory(targetDir, packageId, definition.packageRole);
                return { packageId, installed: false, skipped: true, reason: 'valid-package-present', installPath: targetDir, manifest };
            } catch {
                // A missing or invalid package is replaced only after its staged replacement validates.
            }

        }

        const stagingDir = fs.mkdtempSync(path.join(ARCHIVE_PACKAGES_DIR, '.' + packageId + '-staging-'));
        let previousDir = null;
        try {
            const manifest = _extractCanonicalPackage(definition.zipPath, packageId, definition.packageRole, stagingDir);
            if (fs.existsSync(targetDir)) {
                previousDir = path.join(ARCHIVE_PACKAGES_DIR, '.' + packageId + '-previous-' + Date.now());
                fs.renameSync(targetDir, previousDir);
            }
            fs.renameSync(stagingDir, targetDir);
            if (previousDir) fs.rmSync(previousDir, { recursive: true, force: true });
            return { packageId, installed: true, skipped: false, source: 'bundled', bundledPath: definition.zipPath, installPath: targetDir, manifest };
        } catch (err) {
            if (previousDir && !fs.existsSync(targetDir) && fs.existsSync(previousDir)) {
                try {
                    fs.renameSync(previousDir, targetDir);
                } catch {
                    // Preserve the original installation failure if rollback also fails.
                }
            }
            throw err;
        } finally {
            fs.rmSync(stagingDir, { recursive: true, force: true });
            if (previousDir && fs.existsSync(previousDir) && fs.existsSync(targetDir)) {
                fs.rmSync(previousDir, { recursive: true, force: true });
            }
        }
    });
}

/**
 * Return the installed canonical packages which remain valid according to
 * their package manifests. Only declared Markdown and plaintext documents are exposed to
 * the reader; package artifacts and metadata stay outside the reader path.
 *
 * @returns {Array<{packageId: string, title: string, version: string, packageRole: string, purposeSummary: string, documents: Array}>}
 */
function _readInstalledBundledReaderPackage(packageId) {
    const definition = CANONICAL_BUNDLED_PACKAGES[packageId];
    if (!definition) return null;

    const packageDir = _packageInstallPath(packageId);
    let manifest;
    try {
        manifest = _validatePackageDirectory(packageDir, packageId, definition.packageRole);
    } catch {
        return null;
    }

    const documents = [...new Set(manifest.documents || [])].flatMap(declaredPath => {
        const relPath = _safeRel(String(declaredPath || ''));
        const extension = path.extname(relPath).toLowerCase();
        if (!relPath || (extension !== '.md' && extension !== '.txt')) return [];
        const absolutePath = path.resolve(packageDir, relPath);
        if (!_isPathInside(packageDir, absolutePath)) return [];
        try {
            const stat = fs.lstatSync(absolutePath);
            if (!stat.isFile()) return [];
            return [{
                relativePath: relPath,
                size: stat.size,
                updatedAt: stat.mtime.toISOString(),
            }];
        } catch {
            return [];
        }
    });

    return {
        packageId,
        title: String(manifest.title || packageId),
        version: String(manifest.version || ''),
        packageRole: definition.packageRole,
        purposeSummary: typeof manifest.purpose_summary === 'string' ? manifest.purpose_summary : '',
        indexByDefault: manifest.index_by_default === true,
        artifactCount: Array.isArray(manifest.artifacts) ? manifest.artifacts.length : 0,
        documents,
    };
}

function listInstalledBundledReaderPackages() {
    return CANONICAL_BUNDLED_PACKAGE_IDS.flatMap(packageId => {
        const installedPackage = _readInstalledBundledReaderPackage(packageId);
        return installedPackage ? [installedPackage] : [];
    });
}

function listInstalledBundledPackageMetadata() {
    return listInstalledBundledReaderPackages().map(packageInfo => ({
        id: packageInfo.packageId,
        title: packageInfo.title,
        version: packageInfo.version,
        role: packageInfo.packageRole,
        indexByDefault: packageInfo.indexByDefault,
        documentCount: packageInfo.documents.length,
        artifactCount: packageInfo.artifactCount,
        installed: true,
    }));
}

/**
 * Resolve a reader document only when it is a Markdown or plaintext file explicitly
 * declared by a currently valid canonical package manifest.
 *
 * @param {string} packageId
 * @param {string} relativePath
 * @returns {{ absolutePath: string, packageId: string, title: string }|null}
 */
function resolveInstalledBundledReaderDocument(packageId, relativePath) {
    const installedPackage = _readInstalledBundledReaderPackage(packageId);
    if (!installedPackage) return null;

    const normalizedPath = _safeRel(String(relativePath || ''));
    if (!normalizedPath || !installedPackage.documents.some(document => document.relativePath === normalizedPath)) {
        return null;
    }

    const absolutePath = path.resolve(_packageInstallPath(packageId), normalizedPath);
    if (!_isPathInside(_packageInstallPath(packageId), absolutePath)) return null;
    return { absolutePath, packageId, title: installedPackage.title };
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
    APPLICATION_ROOT,
    CANONICAL_BUNDLED_PACKAGES,
    CANONICAL_BUNDLED_PACKAGE_IDS,
    CANONICAL_BUNDLED_PACKAGE_IDS,
    CANONICAL_CACHE_PACKAGE_IDS,
    CANONICAL_CACHE_DOCUMENTS_DIR,
    CANONICAL_CACHE_ARTIFACTS_DIR,
    CANONICAL_PACKAGE_DOWNLOAD_URLS,
    compareVersionStrings,
    normalizeUpstreamPackageIndex,
    fetchAvailableArchiveCachePackages,
    fetchArchiveSignal,
    loadArchiveCacheRegistry,
    listInstalledArchiveCaches,
    compareInstalledWithUpstream,
    installArchiveCachePackage,
    validateBundledPackage,
    installBundledCanonicalPackages,
    listInstalledBundledReaderPackages,
    listInstalledBundledPackageMetadata,
    resolveInstalledBundledReaderDocument,
};
