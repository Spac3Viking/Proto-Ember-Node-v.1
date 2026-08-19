'use strict';

/**
 * Ember Node v.ᚠ — Phase 11 Archive Routes
 *
 * GET  /api/archive          — list all trusted archive sources
 * POST /api/archive/bootstrap — re-scan and index archive directory
 * POST /api/archive/ingest   — ingest a file directly into the archive
 */

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const { readLimiter, writeLimiter, indexLimiter } = require('../rateLimiters');
const {
    ARCHIVE_DIR,
    ARCHIVE_DIRS,
    ARCHIVE_CORE_DIR,
    ARCHIVE_CACHES_DIR,
    DATA_ROOT,
}                                                = require('../storageConfig');
const {
    listArchiveSources,
    bootstrapArchive,
    registerArchiveSource,
    SOURCE_CLASS_ARCHIVE,
}                                                  = require('../archiveService');
const { extractTextAsync }                         = require('../ingest');
const { chunkText }                                = require('../chunker');
const { generateEmbedding }                        = require('../embeddings');
const {
    upsertManifest, loadChunks,
    upsertChunks, upsertEmbeddings, removeEmbeddingsByChunkIds,
}                                                  = require('../indexStore');
const {
    ARCHIVE_ENDPOINTS,
    CANONICAL_CACHE_PACKAGE_IDS,
    fetchAvailableArchiveCachePackages,
    fetchArchiveSignal,
    loadArchiveCacheRegistry,
    listInstalledArchiveCaches,
    compareInstalledWithUpstream,
    installArchiveCachePackage,
    listInstalledBundledReaderPackages,
    listInstalledBundledPackageMetadata,
    resolveInstalledBundledReaderDocument,
}                                                  = require('../archiveCacheService');
const {
    buildSourceAbstract,
    loadCacheSummaries,
    loadDocumentSummaries,
} = require('../memoryCompression');

const router = express.Router();

const VALID_SHELVES = Object.keys(ARCHIVE_DIRS);
const ALLOWED_EXTENSIONS = new Set(['.txt', '.md', '.pdf', '.docx']);
// Restrict cache IDs to simple filesystem-safe names to prevent traversal/injection via dynamic cache paths.
const CACHE_ID_PATTERN = /^[a-zA-Z0-9._-]+$/;

function stripMarkdownFrontmatter(text) {
    if (typeof text !== 'string') return '';
    return text.replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*(\r?\n)?/, '');
}

function extractMarkdownDisplayTitle(content, fallbackTitle) {
    const fallback = String(fallbackTitle || '').trim() || 'Untitled';
    const text = typeof content === 'string' ? content : '';
    const h1Match = text.match(/^\s*#\s+(.+?)\s*$/m);
    if (h1Match && h1Match[1]) {
        const title = h1Match[1].replace(/\s+/g, ' ').trim();
        if (title) return title;
    }
    const frontmatterMatch = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (frontmatterMatch && frontmatterMatch[1]) {
        const titleMatch = frontmatterMatch[1].match(/^\s*title\s*:\s*["']?(.+?)["']?\s*$/mi);
        if (titleMatch && titleMatch[1]) {
            const title = titleMatch[1].replace(/\s+/g, ' ').trim();
            if (title) return title;
        }
    }
    return fallback;
}

function toPosixRelative(baseDir, absPath) {
    return path.relative(baseDir, absPath).replace(/\\/g, '/');
}

function isPathInside(baseDir, targetPath) {
    const normalize = (value) => {
        const resolved = path.resolve(value);
        return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    };
    const root = normalize(baseDir);
    const target = normalize(targetPath);
    return target === root || target.startsWith(root + path.sep);
}

function isSafeReaderRelativePath(relativePath) {
    return typeof relativePath === 'string' && Boolean(relativePath) &&
        !relativePath.startsWith('/') && !relativePath.startsWith('\\') &&
        !/^[a-zA-Z]:/.test(relativePath) &&
        !/(?:^|[\\/])\.\.(?:[\\/]|$)/.test(relativePath);
}

function listMarkdownFilesRecursive(baseDir, entryRootKey, sourcePrefix, sourceLabel, summaryContext = null) {
    if (!fs.existsSync(baseDir)) return [];
    const out = [];
    const stack = [baseDir];
    while (stack.length > 0) {
        const dir = stack.pop();
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        entries.forEach(entry => {
            const abs = path.join(dir, entry.name);
            if (!isPathInside(baseDir, abs)) return;
            if (entry.isDirectory()) {
                stack.push(abs);
                return;
            }
            if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) return;
            const rel = toPosixRelative(baseDir, abs);
            const stat = fs.statSync(abs);
            out.push({
                entryId: Buffer.from(entryRootKey + '|' + rel, 'utf8').toString('base64url'),
                title: path.basename(entry.name, path.extname(entry.name)),
                sourcePath: sourcePrefix + '/' + rel,
                sourceLabel: sourceLabel || 'Archive',
                relativePath: rel,
                size: stat.size,
                updatedAt: stat.mtime.toISOString(),
                abstract: buildSourceAbstract({
                    sourceId: sourcePrefix + '/' + rel,
                    sourceName: path.basename(entry.name, path.extname(entry.name)),
                    title: path.basename(entry.name, path.extname(entry.name)),
                    cacheId: entryRootKey.startsWith('archive-cache/')
                        ? entryRootKey.slice('archive-cache/'.length)
                        : null,
                    documentSummaries: summaryContext && summaryContext.documentSummaries ? summaryContext.documentSummaries : null,
                    cacheSummaries: summaryContext && summaryContext.cacheSummaries ? summaryContext.cacheSummaries : null,
                }),
            });
        });
    }
    return out.sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));
}

function resolveReaderEntry(entryId) {
    let decoded;
    try {
        decoded = Buffer.from(entryId, 'base64url').toString('utf8');
    } catch {
        return null;
    }
    const delim = decoded.indexOf('|');
    if (delim <= 0) return null;
    const rootKey = decoded.slice(0, delim);
    const requestedPath = decoded.slice(delim + 1);
    if (!isSafeReaderRelativePath(requestedPath)) return null;
    const relativePath = requestedPath.replace(/\\/g, '/');
    if (!relativePath.toLowerCase().endsWith('.md') && !relativePath.toLowerCase().endsWith('.txt')) return null;

    if (rootKey === 'archive-core') {
        const abs = path.resolve(ARCHIVE_CORE_DIR, relativePath);
        if (!isPathInside(ARCHIVE_CORE_DIR, abs)) return null;
        return {
            absolutePath: abs,
            sourcePath: 'archive/core/' + relativePath,
            sourceLabel: 'Core Cache',
        };
    }

    if (rootKey.startsWith('archive-cache/')) {
        const cacheId = rootKey.slice('archive-cache/'.length);
        if (!CACHE_ID_PATTERN.test(cacheId)) return null;
        const cacheRoot = path.join(ARCHIVE_CACHES_DIR, cacheId);
        const abs = path.resolve(cacheRoot, relativePath);
        if (!isPathInside(cacheRoot, abs)) return null;
        return {
            absolutePath: abs,
            sourcePath: 'archive/caches/' + cacheId + '/' + relativePath,
            sourceLabel: /codices/i.test(cacheId) ? 'Codices Cache' : 'Archive Cache',
        };
    }

    if (rootKey.startsWith('archive-cache-artifact/')) {
        const cacheId = rootKey.slice('archive-cache-artifact/'.length);
        if (!CACHE_ID_PATTERN.test(cacheId)) return null;
        const artifactsRoot = path.join(ARCHIVE_CACHES_DIR, cacheId, 'artifacts');
        const abs = path.resolve(artifactsRoot, relativePath);
        if (!isPathInside(artifactsRoot, abs)) return null;
        return {
            absolutePath: abs,
            sourcePath: 'archive/caches/' + cacheId + '/artifacts/' + relativePath,
            sourceLabel: /codices/i.test(cacheId) ? 'Codices Cache Artifact' : 'Archive Cache Artifact',
        };
    }

    if (rootKey.startsWith('archive-package/')) {
        const packageId = rootKey.slice('archive-package/'.length);
        if (!CACHE_ID_PATTERN.test(packageId)) return null;
        const document = resolveInstalledBundledReaderDocument(packageId, relativePath);
        if (!document) return null;
        return {
            absolutePath: document.absolutePath,
            sourcePath: 'archive/packages/' + packageId + '/' + relativePath,
            sourceLabel: document.title,
        };
    }

    return null;
}

function removeStaleEmbeddingsForSource(sourceId) {
    const oldChunkIds = loadChunks()
        .filter(c => c.sourceId === sourceId)
        .map(c => c.id);
    removeEmbeddingsByChunkIds(oldChunkIds);
}

/**
 * GET /api/archive
 * Returns all registered trusted archive sources.
 */
router.get('/api/archive', readLimiter, (req, res) => {
    const { shelf } = req.query;
    const documentSummaries = loadDocumentSummaries();
    const cacheSummaries = loadCacheSummaries();
    let sources = listArchiveSources();
    if (shelf) sources = sources.filter(s => s.shelf === shelf);
    sources = sources.map(source => ({
        ...source,
        abstract: buildSourceAbstract({
            sourceId: source.id,
            sourceName: source.title || source.file || source.id,
            title: source.title || source.file || source.id,
            cacheId: source.cacheId || null,
            documentSummaries,
            cacheSummaries,
        }),
    }));
    res.json({ sources, shelves: VALID_SHELVES });
});

/**
 * GET /api/archive/reader/catalog
 * Return a cache-aware markdown catalog for local archive roots.
 */
router.get('/api/archive/reader/catalog', readLimiter, (req, res) => {
    const includeArtifacts = String(req.query?.includeArtifacts ?? '')
        .trim()
        .toLowerCase() === 'true';
    const cacheSummaries = loadCacheSummaries();
    const documentSummaries = loadDocumentSummaries();
    const summaryContext = { documentSummaries, cacheSummaries };
    const coreFiles = listMarkdownFilesRecursive(
        ARCHIVE_CORE_DIR,
        'archive-core',
        'archive/core',
        'Core Cache',
        summaryContext,
    );
    const cacheGroups = fs.existsSync(ARCHIVE_CACHES_DIR)
        ? fs.readdirSync(ARCHIVE_CACHES_DIR, { withFileTypes: true })
            .filter(entry => entry.isDirectory() && CACHE_ID_PATTERN.test(entry.name))
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(entry => {
                const cacheId = entry.name;
                const cacheRoot = path.join(ARCHIVE_CACHES_DIR, cacheId);
                return {
                    cacheId,
                    title: cacheId,
                    sourcePath: 'archive/caches/' + cacheId,
                    abstract: cacheSummaries && cacheSummaries.caches && cacheSummaries.caches[cacheId]
                        ? {
                            summary: cacheSummaries.caches[cacheId].summary || '',
                            themes: Array.isArray(cacheSummaries.caches[cacheId].themes)
                                ? cacheSummaries.caches[cacheId].themes.slice(0, 3)
                                : [],
                            preferred_archetypes: Array.isArray(cacheSummaries.caches[cacheId].dominant_archetypes)
                                ? cacheSummaries.caches[cacheId].dominant_archetypes.slice(0, 3)
                                : [],
                        }
                        : null,
                    files: (() => {
                        const documentsRoot = path.join(cacheRoot, 'documents');
                        const artifactsRoot = path.join(cacheRoot, 'artifacts');
                        const cacheRootFiles = listMarkdownFilesRecursive(
                            cacheRoot,
                            'archive-cache/' + cacheId,
                            'archive/caches/' + cacheId,
                            /codices/i.test(cacheId) ? 'Codices Cache' : 'Archive Cache',
                            summaryContext,
                        ).filter(entry => entry.sourcePath === 'archive/caches/' + cacheId + '/README.md');
                        const hasDocumentsLayer = fs.existsSync(documentsRoot) && fs.statSync(documentsRoot).isDirectory();
                        const documentFiles = hasDocumentsLayer
                            ? listMarkdownFilesRecursive(
                                documentsRoot,
                                'archive-cache/' + cacheId,
                                'archive/caches/' + cacheId + '/documents',
                                /codices/i.test(cacheId) ? 'Codices Cache' : 'Archive Cache',
                                summaryContext,
                            )
                            : [];
                        const baseFiles = [...cacheRootFiles, ...documentFiles]
                            .sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));
                        if (!includeArtifacts) return baseFiles;
                        if (!fs.existsSync(artifactsRoot) || !fs.statSync(artifactsRoot).isDirectory()) {
                            return baseFiles;
                        }
                        const artifactFiles = listMarkdownFilesRecursive(
                            artifactsRoot,
                            'archive-cache-artifact/' + cacheId,
                            'archive/caches/' + cacheId + '/artifacts',
                            /codices/i.test(cacheId) ? 'Codices Cache Artifact' : 'Archive Cache Artifact',
                            summaryContext,
                        );
                        return [...baseFiles, ...artifactFiles]
                            .sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));
                    })(),
                };
            })
        : [];
    const packageGroups = listInstalledBundledReaderPackages().map(packageInfo => ({
        packageId: packageInfo.packageId,
        title: packageInfo.title,
        version: packageInfo.version,
        packageRole: packageInfo.packageRole,
        purposeSummary: packageInfo.purposeSummary,
        sourcePath: 'archive/packages/' + packageInfo.packageId,
        files: packageInfo.documents.map(document => ({
            entryId: Buffer.from(
                'archive-package/' + packageInfo.packageId + '|' + document.relativePath,
                'utf8',
            ).toString('base64url'),
            title: path.basename(document.relativePath, path.extname(document.relativePath)),
            sourcePath: 'archive/packages/' + packageInfo.packageId + '/' + document.relativePath,
            sourceLabel: packageInfo.title,
            relativePath: document.relativePath,
            size: document.size,
            updatedAt: document.updatedAt,
        })),
    }));

    res.json({
        success: true,
        roots: [
            {
                id: 'archive-core',
                title: 'archive/core',
                sourcePath: 'archive/core',
                files: coreFiles,
            },
            {
                id: 'archive-caches',
                title: 'archive/caches',
                sourcePath: 'archive/caches',
                caches: cacheGroups,
            },
            {
                id: 'archive-packages',
                title: 'Installed Packages',
                sourcePath: 'archive/packages',
                packages: packageGroups,
            },
        ],
    });
});

router.get('/api/archive/packages/installed', readLimiter, (req, res) => {
    res.json({ packages: listInstalledBundledPackageMetadata() });
});

/**
 * GET /api/archive/reader/document/:entryId
 * Return content for a catalog entry.
 */
router.get('/api/archive/reader/document/:entryId', readLimiter, (req, res) => {
    const resolved = resolveReaderEntry(req.params.entryId);
    if (!resolved) {
        return res.status(400).json({ error: 'Invalid reader entry.' });
    }
    if (!fs.existsSync(resolved.absolutePath)) {
        return res.status(404).json({ error: 'Reader entry not found.' });
    }
    const raw = fs.readFileSync(resolved.absolutePath, 'utf8');
    const isMarkdown = path.extname(resolved.absolutePath).toLowerCase() === '.md';
    const content = isMarkdown ? stripMarkdownFrontmatter(raw) : raw;
    const fallbackTitle = path.basename(resolved.absolutePath, path.extname(resolved.absolutePath));
    res.json({
        success: true,
        entryId: req.params.entryId,
        sourcePath: resolved.sourcePath,
        sourceLabel: resolved.sourceLabel || 'Archive Cache',
        title: isMarkdown ? extractMarkdownDisplayTitle(content, fallbackTitle) : fallbackTitle,
        contentType: isMarkdown ? 'text/markdown' : 'text/plain',
        content,
    });
});

/**
 * POST /api/archive/bootstrap
 * Re-scan the archive directory and register / index any new files.
 * Returns a summary of what was found and processed.
 */
router.post('/api/archive/bootstrap', indexLimiter, async (req, res) => {
    try {
        const result = await bootstrapArchive();
        res.json({ success: true, ...result });
    } catch (err) {
        console.error('[archive/bootstrap] Error:', err.message);
        res.status(500).json({ error: 'Archive bootstrap failed: ' + err.message });
    }
});

/**
 * POST /api/archive/ingest
 * Body: { filename, content, shelf, title?, description?, encoding? }
 *
 * Directly ingest a file into the trusted archive (bypasses Threshold).
 * shelf must be one of: codices, grimoires, sagas, literature, history, science, green-fire
 */
router.post('/api/archive/ingest', writeLimiter, async (req, res) => {
    try {
        const {
            filename,
            content,
            shelf       = 'literature',
            title       = null,
            description = null,
            encoding    = 'utf8',
        } = req.body;

        if (!filename || typeof filename !== 'string') {
            return res.status(400).json({ error: 'filename is required' });
        }
        if (typeof content !== 'string') {
            return res.status(400).json({ error: 'content is required' });
        }
        if (!VALID_SHELVES.includes(shelf)) {
            return res.status(400).json({
                error: 'Invalid shelf "' + shelf + '". Valid shelves: ' + VALID_SHELVES.join(', '),
            });
        }

        const ext = path.extname(filename).toLowerCase();
        if (!ALLOWED_EXTENSIONS.has(ext)) {
            return res.status(400).json({
                error: 'Unsupported file type "' + ext + '". Allowed: ' + [...ALLOWED_EXTENSIONS].join(', '),
            });
        }

        const shelfDir = ARCHIVE_DIRS[shelf];
        if (!fs.existsSync(shelfDir)) {
            fs.mkdirSync(shelfDir, { recursive: true });
        }

        const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
        const filePath = path.join(shelfDir, safeName);

        if (encoding === 'base64') {
            const buffer = Buffer.from(content, 'base64');
            fs.writeFileSync(filePath, buffer);
        } else {
            fs.writeFileSync(filePath, content, 'utf8');
        }

        const source = registerArchiveSource(filePath, shelf);
        if (title)       { source.title       = title;       upsertManifest(source.id, source); }
        if (description) { source.description = description; upsertManifest(source.id, source); }

        // Index immediately
        try {
            const { text } = await extractTextAsync(filePath);
            if (text) {
                const chunks = chunkText({ text, sourceRecord: source });
                removeStaleEmbeddingsForSource(source.id);
                upsertChunks(chunks);

                const embeddingMap = {};
                for (const chunk of chunks) {
                    const vector = await generateEmbedding(chunk.text);
                    if (vector) embeddingMap[chunk.id] = vector;
                }
                if (Object.keys(embeddingMap).length > 0) {
                    upsertEmbeddings(embeddingMap);
                }
                source.status = 'remembered';
                upsertManifest(source.id, source);
            }
        } catch { /* indexing is best-effort */ }

        res.json({ success: true, source, shelf });
    } catch (error) {
        console.error('[archive/ingest] Error:', error.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

/**
 * GET /api/archive/caches/available
 * Fetch canonical cache package metadata from Green Fire Archive index.json.
 * Falls back to local cached metadata when upstream is unavailable.
 */
router.get('/api/archive/caches/available', readLimiter, async (req, res) => {
    try {
        const result = await fetchAvailableArchiveCachePackages();
        res.json({
            success: true,
            endpoints: ARCHIVE_ENDPOINTS,
            canonicalPackageIds: CANONICAL_CACHE_PACKAGE_IDS,
            ...result,
        });
    } catch (err) {
        res.status(500).json({ error: 'Could not load archive cache index: ' + err.message });
    }
});

/**
 * GET /api/archive/caches/installed
 * List canonical Green Fire cache packages installed in local data root.
 */
router.get('/api/archive/caches/installed', readLimiter, (req, res) => {
    const caches = listInstalledArchiveCaches();
    res.json({
        success: true,
        canonicalPackageIds: CANONICAL_CACHE_PACKAGE_IDS,
        caches,
    });
});

/**
 * GET /api/archive/caches/registry
 * Return persistent cache install/update registry metadata.
 */
router.get('/api/archive/caches/registry', readLimiter, (req, res) => {
    const registry = loadArchiveCacheRegistry();
    res.json({
        success: true,
        registry,
    });
});

/**
 * GET /api/archive/caches/updates
 * Compare local installed versions against upstream versions.
 */
router.get('/api/archive/caches/updates', readLimiter, async (req, res) => {
    try {
        const result = await compareInstalledWithUpstream();
        res.json({
            success: true,
            canonicalPackageIds: CANONICAL_CACHE_PACKAGE_IDS,
            ...result,
        });
    } catch (err) {
        res.status(500).json({ error: 'Could not compare archive cache versions: ' + err.message });
    }
});

/**
 * POST /api/archive/caches/install
 * Body: { packageId }
 *
 * Installs one canonical Green Fire cache zip package.
 * - green-fire-core merges into archive/core/
 * - all other canonical packages install into archive/caches/<package-id>/
 */
router.post('/api/archive/caches/install', writeLimiter, async (req, res) => {
    try {
        const packageId = typeof req.body.packageId === 'string' ? req.body.packageId.trim() : '';

        if (!packageId) {
            return res.status(400).json({ error: 'packageId is required' });
        }

        if (!CANONICAL_CACHE_PACKAGE_IDS.includes(packageId)) {
            return res.status(400).json({
                error: 'Unknown packageId "' + packageId + '". Valid IDs: ' + CANONICAL_CACHE_PACKAGE_IDS.join(', '),
            });
        }

        const installed = await installArchiveCachePackage({ packageId });
        const bootstrap = await bootstrapArchive();

        res.json({
            success: true,
            installed,
            bootstrap,
        });
    } catch (err) {
        res.status(500).json({ error: 'Archive cache install failed: ' + err.message });
    }
});

/**
 * GET /api/archive/signal
 * Return latest archive signal payload (dispatch/question) with offline fallback.
 */
router.get('/api/archive/signal', readLimiter, async (req, res) => {
    try {
        const signal = await fetchArchiveSignal();
        res.json({
            success: true,
            endpoint: ARCHIVE_ENDPOINTS.signal,
            ...signal,
        });
    } catch (err) {
        console.error('[archive/signal] Error:', err.message);
        res.status(500).json({ error: 'Could not load archive signal.' });
    }
});

/**
 * GET /api/archive/resources
 * Return canonical external resource links (Forge / Mythic Seed / signal/index endpoints).
 */
router.get('/api/archive/resources', readLimiter, (req, res) => {
    res.json({
        success: true,
        endpoints: ARCHIVE_ENDPOINTS,
    });
});

module.exports = router;
