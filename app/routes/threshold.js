'use strict';

/**
 * Ember Node v.ᚠ — Threshold Routes
 *
 * GET  /api/threshold/list
 * POST /api/threshold/import
 * GET  /api/threshold/files
 * GET  /api/threshold/files/content
 * DELETE /api/threshold/files
 */

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const AdmZip  = require('adm-zip');
const { readLimiter, writeLimiter } = require('../rateLimiters');
const {
    DATA_ROOT,
    resolveSourcePath,
    ARCHIVE_CACHES_DIR,
    EXPORTS_DIR,
    IMPORTED_BOOTSTRAPS_DIR,
    ROLLING_BOOTSTRAP_PATH,
} = require('../storageConfig');
const { buildSourceRecord }      = require('../ingest');
const {
    upsertManifest, loadManifests,
}                                                  = require('../indexStore');
const { loadRollingBootstrap, refreshRollingBootstrap } = require('../bootstrap');
const { loadIntakeState, upsertIntakeRuntime } = require('../intakeState');
const {
    probeOllamaRuntime,
    launchOllamaRuntime,
} = require('../runtimeStewardship');
const { recordCacheInteraction } = require('../cacheInteractionMemory');
const {
    DETECT_SUPPORTED_EXTS,
    DETECT_IGNORE_FILES,
} = require('../startupCheck');

const router = express.Router();
const THRESHOLD_INBOX_DIR = path.join(DATA_ROOT, 'threshold', 'inbox');
const THRESHOLD_CACHE_DRAFTS_DIR = path.join(DATA_ROOT, 'threshold', 'cache-drafts');
const CACHE_DRAFT_EXPORTS_DIR = path.join(EXPORTS_DIR, 'cache-drafts');
const THRESHOLD_IMPORT_EXTS = new Set(['.md', '.txt', '.json', '.pdf']);
const THRESHOLD_DRAFT_SOURCE_EXTS = new Set(['.md', '.txt', '.json']);
const THRESHOLD_DRAFT_READER_EXTS = new Set(['.md', '.txt', '.json']);
const MAX_DRAFT_ID_LENGTH = 64;
const MAX_DOC_NAME_COLLISION_ATTEMPTS = 1000;
const DEFAULT_HANDOFF_STEM = 'threshold-handoff';
const GREEN_FIRE_HANDOFF_TYPES = new Set([
    'research-brief',
    'field-note',
    'bootstrap',
    'manual-summary',
    'cache-readme',
    'source-summary',
]);
const GREEN_FIRE_HANDOFF_STATUS = new Set(['unverified', 'reviewed', 'trusted', 'local']);
const MAX_IMPORTED_BOOTSTRAP_SUMMARY_LENGTH = 4000;
const SIGNAL_DENSITIES = new Set(['low', 'moderate', 'high']);

function isPathInside(baseDir, targetPath) {
    const normalize = (value) => {
        const resolved = path.resolve(value);
        return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    };
    const root = normalize(baseDir);
    const target = normalize(targetPath);
    return target === root || target.startsWith(root + path.sep);
}

function ensureThresholdInboxDir() {
    if (!fs.existsSync(THRESHOLD_INBOX_DIR)) {
        fs.mkdirSync(THRESHOLD_INBOX_DIR, { recursive: true });
    }
}

function ensureThresholdCacheDraftDirs() {
    if (!fs.existsSync(THRESHOLD_CACHE_DRAFTS_DIR)) {
        fs.mkdirSync(THRESHOLD_CACHE_DRAFTS_DIR, { recursive: true });
    }
    if (!fs.existsSync(CACHE_DRAFT_EXPORTS_DIR)) {
        fs.mkdirSync(CACHE_DRAFT_EXPORTS_DIR, { recursive: true });
    }
}

function normalizeImportType(ext) {
    if (ext === '.md') return 'markdown';
    if (ext === '.txt') return 'text';
    if (ext === '.json') return 'json';
    if (ext === '.pdf') return 'pdf';
    return 'unknown';
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

function extractFrontmatterBlock(content) {
    const text = typeof content === 'string' ? content : '';
    const normalized = text.replace(/\r\n/g, '\n');
    if (!normalized.startsWith('---\n')) return '';
    const endMarker = '\n---\n';
    const endIdx = normalized.indexOf(endMarker, 4);
    if (endIdx >= 0) {
        return normalized.slice(4, endIdx);
    }
    const terminalEndIdx = normalized.indexOf('\n---', 4);
    if (terminalEndIdx >= 0 && terminalEndIdx + 4 === normalized.length) {
        return normalized.slice(4, terminalEndIdx);
    }
    return '';
}

function cleanFrontmatterValue(value) {
    const trimmed = String(value || '').trim();
    return trimmed.replace(/^["']|["']$/g, '').trim();
}

function parseFrontmatterList(value) {
    const raw = cleanFrontmatterValue(value);
    if (!raw) return [];
    const normalized = raw.startsWith('[') && raw.endsWith(']')
        ? raw.slice(1, -1)
        : raw;
    return normalized
        .split(',')
        .map(item => cleanFrontmatterValue(item))
        .filter(Boolean);
}

function parseSimpleFrontmatter(content) {
    const block = extractFrontmatterBlock(content);
    if (!block) return {};
    return block.split('\n').reduce((acc, line) => {
        const trimmed = String(line || '').trim();
        if (!trimmed) return acc;
        const delimiterIndex = trimmed.indexOf(':');
        if (delimiterIndex <= 0) return acc;
        const key = trimmed.slice(0, delimiterIndex).trim().toLowerCase();
        if (!/^[a-z0-9_-]+$/.test(key)) return acc;
        const value = trimmed.slice(delimiterIndex + 1).trim();
        acc[key] = value;
        return acc;
    }, {});
}

function parseGreenFireHandoff(content) {
    const frontmatter = parseSimpleFrontmatter(content);
    const hasFrontmatter = Object.keys(frontmatter).length > 0;
    const type = cleanFrontmatterValue(frontmatter.type || '').toLowerCase();
    const status = cleanFrontmatterValue(frontmatter.status || '').toLowerCase();
    const archetypes = parseFrontmatterList(frontmatter.archetypes || '');
    const tags = parseFrontmatterList(frontmatter.tags || '');
    const source = cleanFrontmatterValue(frontmatter.source || '');
    const license = cleanFrontmatterValue(frontmatter.license || '');

    const detected = Boolean(
        hasFrontmatter &&
        GREEN_FIRE_HANDOFF_TYPES.has(type) &&
        GREEN_FIRE_HANDOFF_STATUS.has(status)
    );

    return {
        detected,
        type: type || null,
        status: status || null,
        archetypes,
        tags,
        source: source || null,
        license: license || null,
    };
}

function isSentinelLoadoutBootstrapMarkdown(content, handoff) {
    if (!handoff || !handoff.detected || handoff.type !== 'bootstrap') return false;
    const text = String(content || '').toLowerCase();
    return text.includes('sentinel loadout bootstrap');
}

function sanitizeFilename(filename) {
    const base = path.basename(String(filename || '').replace(/\\/g, '/'));
    return base.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^_+/, '') || 'imported-file';
}

function uniqueInboxName(filename) {
    const safe = sanitizeFilename(filename);
    const ext = path.extname(safe).toLowerCase();
    const stem = path.basename(safe, ext);
    let candidate = safe;
    const timestamp = Date.now();
    let i = 1;
    while (fs.existsSync(path.join(THRESHOLD_INBOX_DIR, candidate))) {
        if (i === 1) {
            candidate = stem + '-' + timestamp + ext;
        } else {
            candidate = stem + '-' + timestamp + '-' + i + ext;
        }
        i++;
    }
    return candidate;
}

function normalizeMarkdownFilename(filename, fallbackStem) {
    const fallback = String(fallbackStem || '').trim() || DEFAULT_HANDOFF_STEM;
    const raw = String(filename || (fallback + '.md')).trim();
    const ext = path.extname(raw).toLowerCase();
    const withMarkdownExt = ext === '.md'
        ? raw
        : ext
            ? path.basename(raw, ext) + '.md'
            : raw + '.md';
    return sanitizeFilename(withMarkdownExt);
}

function createInboxMarkdownFromText(markdown, preferredFilename) {
    const content = typeof markdown === 'string' ? markdown : '';
    if (!content.trim()) {
        const error = new Error('markdown is required');
        error.status = 400;
        throw error;
    }
    ensureThresholdInboxDir();
    const uniqueFilename = uniqueInboxName(normalizeMarkdownFilename(preferredFilename, DEFAULT_HANDOFF_STEM));
    const absPath = path.resolve(THRESHOLD_INBOX_DIR, uniqueFilename);
    if (!isPathInside(THRESHOLD_INBOX_DIR, absPath)) {
        const error = new Error('Invalid markdown target path.');
        error.status = 400;
        throw error;
    }
    fs.writeFileSync(absPath, content, 'utf8');
    return {
        relPath: 'threshold/inbox/' + uniqueFilename,
        absPath,
        markdown: content,
    };
}

/**
 * Extract markdown text from a block input.
 * Accepted formats:
 * - string markdown
 * - object with `markdown` string
 * - object with `content` string
 * Precedence: markdown > content.
 *
 * @param {string|object} item
 * @returns {string}
 */
function extractMarkdownFromBlock(item) {
    if (typeof item === 'string') return item;
    if (item && typeof item.markdown === 'string') return item.markdown;
    if (item && typeof item.content === 'string') return item.content;
    return '';
}

/**
 * Resolve a preferred markdown filename for a block input.
 * Precedence: filename > name > title > generated fallback.
 *
 * @param {string|object} item
 * @param {number} index
 * @returns {string}
 */
function resolveMarkdownBlockFilename(item, index) {
    const fallback = `${DEFAULT_HANDOFF_STEM}-${index + 1}.md`;
    if (typeof item === 'string') return fallback;
    return item.filename || item.name || item.title || fallback;
}

function listThresholdInboxFiles() {
    ensureThresholdInboxDir();
    const entries = fs.readdirSync(THRESHOLD_INBOX_DIR, { withFileTypes: true });
    return entries
        .filter(entry => entry.isFile())
        .map(entry => {
            const ext = path.extname(entry.name).toLowerCase();
            if (!THRESHOLD_IMPORT_EXTS.has(ext)) return null;
            const absPath = path.join(THRESHOLD_INBOX_DIR, entry.name);
            let stats = null;
            try { stats = fs.statSync(absPath); } catch { return null; }
            const importedAt = (stats.birthtime || stats.mtime || new Date()).toISOString();
            let handoff = null;
            let sentinelLoadoutDetected = false;
            if (ext === '.md') {
                try {
                    const content = fs.readFileSync(absPath, 'utf8');
                    handoff = parseGreenFireHandoff(content);
                    sentinelLoadoutDetected = isSentinelLoadoutBootstrapMarkdown(content, handoff);
                } catch {
                    handoff = {
                        detected: false,
                        type: null,
                        status: null,
                        archetypes: [],
                        tags: [],
                        source: null,
                        license: null,
                    };
                    sentinelLoadoutDetected = false;
                }
            }
            return {
                name: entry.name,
                path: 'threshold/inbox/' + entry.name,
                type: normalizeImportType(ext),
                extension: ext.replace(/^\./, ''),
                size: stats.size,
                imported_at: importedAt,
                sourceLabel: 'Threshold',
                status: ext === '.pdf' ? 'pdf_stored' : 'ready',
                handoff,
                bootstrapDetected: Boolean(handoff && handoff.detected && handoff.type === 'bootstrap'),
                sentinelLoadoutDetected,
            };
        })
        .filter(Boolean)
        .sort((a, b) => b.imported_at.localeCompare(a.imported_at));
}

function resolveThresholdInboxPath(relPath) {
    const normalized = String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!normalized.startsWith('threshold/inbox/')) return null;
    const tail = normalized.slice('threshold/inbox/'.length);
    if (!tail || tail.includes('..')) return null;
    const absPath = path.resolve(THRESHOLD_INBOX_DIR, tail);
    if (!isPathInside(THRESHOLD_INBOX_DIR, absPath)) return null;
    return absPath;
}

function sanitizeDraftId(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return null;

    let out = '';
    let previousWasDash = false;
    for (let i = 0; i < raw.length && out.length < MAX_DRAFT_ID_LENGTH; i++) {
        const ch = raw[i];
        const isAlpha = ch >= 'a' && ch <= 'z';
        const isDigit = ch >= '0' && ch <= '9';
        const isAllowed = isAlpha || isDigit || ch === '.' || ch === '_' || ch === '-';
        if (isAllowed) {
            out += ch;
            previousWasDash = ch === '-';
            continue;
        }
        if (!previousWasDash && out.length > 0) {
            out += '-';
            previousWasDash = true;
        }
    }

    while (out.startsWith('-')) out = out.slice(1);
    while (out.endsWith('-')) out = out.slice(0, -1);
    if (!out) return null;

    const first = out[0];
    const firstValid = (first >= 'a' && first <= 'z') || (first >= '0' && first <= '9');
    if (!firstValid) return null;

    for (let i = 0; i < out.length; i++) {
        const ch = out[i];
        const isAlpha = ch >= 'a' && ch <= 'z';
        const isDigit = ch >= '0' && ch <= '9';
        if (!(isAlpha || isDigit || ch === '.' || ch === '_' || ch === '-')) return null;
    }
    return out;
}

function resolveCacheDraftDir(draftId) {
    const normalized = sanitizeDraftId(draftId);
    if (!normalized) return null;
    const abs = path.resolve(THRESHOLD_CACHE_DRAFTS_DIR, normalized);
    if (!isPathInside(THRESHOLD_CACHE_DRAFTS_DIR, abs)) return null;
    return { id: normalized, path: abs };
}

function listFilesRecursive(baseDir) {
    if (!fs.existsSync(baseDir)) return [];
    const out = [];
    const stack = [baseDir];
    while (stack.length > 0) {
        const current = stack.pop();
        const entries = fs.readdirSync(current, { withFileTypes: true });
        for (const entry of entries) {
            const abs = path.join(current, entry.name);
            if (!isPathInside(baseDir, abs)) continue;
            if (entry.isDirectory()) {
                stack.push(abs);
                continue;
            }
            if (!entry.isFile()) continue;
            out.push(abs);
        }
    }
    return out;
}

function isVisiblePath(relPath) {
    const parts = String(relPath || '').split('/').filter(Boolean);
    if (parts.length === 0) return false;
    return parts.every(part => !part.startsWith('.'));
}

function isAllowedDraftPayloadPath(relPath) {
    return relPath === 'manifest.json' ||
        relPath === 'README.md' ||
        relPath.startsWith('documents/');
}

function toRootRelative(absPath) {
    const rel = path.relative(DATA_ROOT, absPath).replace(/\\/g, '/');
    return rel.startsWith('../') ? null : rel;
}

function parseManifestIfPresent(filePath) {
    if (!fs.existsSync(filePath)) return null;
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return null;
    }
}

function normalizeStringList(value) {
    const input = Array.isArray(value) ? value : (value ? [value] : []);
    return Array.from(new Set(
        input
            .map(item => String(item || '').trim())
            .filter(Boolean),
    ));
}

function normalizeSignalDensity(value) {
    const density = String(value || '').trim().toLowerCase();
    return SIGNAL_DENSITIES.has(density) ? density : 'low';
}

function stripFrontmatter(content) {
    return String(content || '').replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*(\r?\n)?/, '');
}

function normalizeIsoTimestamp(value, fallback) {
    const candidate = String(value || '').trim();
    if (!candidate) return fallback;
    const date = new Date(candidate);
    return Number.isFinite(date.getTime()) ? date.toISOString() : fallback;
}

function documentTypeFromExt(ext) {
    if (ext === '.md') return 'research-brief';
    if (ext === '.txt') return 'field-note';
    if (ext === '.json') return 'source-summary';
    return 'document';
}

function titleFromDocumentPath(relPath) {
    const filename = path.basename(String(relPath || ''), path.extname(String(relPath || '')));
    const cleaned = filename.replace(/[_-]+/g, ' ').trim();
    return cleaned || 'Untitled';
}

function normalizeDraftDocumentPath(inputPath) {
    let normalized = String(inputPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!normalized) return null;
    // Backward compatibility for pre-normalization draft zips/manifests:
    // older payloads used top-level handoff.md and docs/ instead of documents/.
    if (normalized === 'handoff.md') {
        normalized = 'documents/handoff.md';
    }
    if (normalized.startsWith('docs/')) {
        normalized = 'documents/' + normalized.slice('docs/'.length);
    }
    if (!normalized.startsWith('documents/')) return null;
    if (normalized.includes('..')) return null;
    return normalized;
}

function normalizeDraftDocumentEntry(entry, fallbackPath) {
    const source = entry && typeof entry === 'object' ? entry : {};
    const relPath = normalizeDraftDocumentPath(source.path || fallbackPath);
    if (!relPath) return null;
    return {
        path: relPath,
        title: String(source.title || titleFromDocumentPath(relPath)).trim() || titleFromDocumentPath(relPath),
        type: String(source.type || documentTypeFromExt(path.extname(relPath).toLowerCase())).trim() || 'document',
        tags: Array.isArray(source.tags) ? source.tags.map(v => String(v).trim()).filter(Boolean) : [],
        archetypes: Array.isArray(source.archetypes) ? source.archetypes.map(v => String(v).trim()).filter(Boolean) : [],
        status: String(source.status || 'unverified').trim() || 'unverified',
    };
}

function listDraftDocumentPaths(draftRoot) {
    const documentsDir = path.join(draftRoot, 'documents');
    if (!fs.existsSync(documentsDir)) return [];
    return listFilesRecursive(documentsDir)
        .map(filePath => path.relative(draftRoot, filePath).replace(/\\/g, '/'))
        .filter(rel => rel.startsWith('documents/') && isVisiblePath(rel))
        .sort((a, b) => a.localeCompare(b));
}

function normalizeDraftManifest(manifest, draftId, updatedAtFallback) {
    const raw = manifest && typeof manifest === 'object' ? manifest : {};
    const nowIso = normalizeIsoTimestamp(updatedAtFallback, new Date().toISOString());
    const normalizedId = sanitizeDraftId(raw.id || draftId) || sanitizeDraftId(draftId) || 'cache-draft';
    const title = String(raw.title || raw.name || normalizedId).trim() || normalizedId;
    const createdAt = normalizeIsoTimestamp(raw.created_at || raw.generatedAt, nowIso);
    const updatedAt = normalizeIsoTimestamp(raw.updated_at || raw.generatedAt || nowIso, nowIso);
    const documentEntries = [];
    if (Array.isArray(raw.documents)) {
        raw.documents.forEach((entry) => {
            const normalizedEntry = normalizeDraftDocumentEntry(entry, typeof entry === 'string' ? entry : null);
            if (normalizedEntry) documentEntries.push(normalizedEntry);
            else if (typeof entry === 'string') {
                const fallback = normalizeDraftDocumentEntry(null, entry);
                if (fallback) documentEntries.push(fallback);
            } else if (entry && typeof entry.path === 'string') {
                const fallback = normalizeDraftDocumentEntry(null, entry.path);
                if (fallback) documentEntries.push(fallback);
            }
        });
    }
    if (documentEntries.length === 0 && raw.continuity && Array.isArray(raw.continuity.documents)) {
        raw.continuity.documents.forEach(rel => {
            const fallback = normalizeDraftDocumentEntry(null, rel);
            if (fallback) documentEntries.push(fallback);
        });
    }
    return {
        id: normalizedId,
        title,
        version: String(raw.version || '0.1.0').trim() || '0.1.0',
        type: 'local-cache-draft',
        status: String(raw.status || 'draft').trim() || 'draft',
        trusted: Boolean(raw.trusted),
        auto_load: Boolean(raw.auto_load),
        created_at: createdAt,
        updated_at: updatedAt,
        description: String(raw.description || '').trim(),
        source: 'threshold',
        recommended_destination: String(raw.recommended_destination || ('archive/caches/' + normalizedId)).trim() || ('archive/caches/' + normalizedId),
        derived_from: normalizeStringList(raw.derived_from),
        distilled_into: normalizeStringList(raw.distilled_into),
        continuity_themes: normalizeStringList(raw.continuity_themes),
        signal_density: normalizeSignalDensity(raw.signal_density),
        documents: documentEntries,
        tags: Array.isArray(raw.tags) ? raw.tags.map(v => String(v).trim()).filter(Boolean) : [],
        archetypes: Array.isArray(raw.archetypes) ? raw.archetypes.map(v => String(v).trim()).filter(Boolean) : [],
        license: String(raw.license || 'unknown').trim() || 'unknown',
    };
}

function syncManifestDocumentsFromDisk(normalizedManifest, draftRoot) {
    const byPath = new Map();
    (normalizedManifest.documents || []).forEach(entry => {
        const normalized = normalizeDraftDocumentEntry(entry, entry && entry.path ? entry.path : null);
        if (normalized) byPath.set(normalized.path, normalized);
    });
    const diskPaths = listDraftDocumentPaths(draftRoot);
    diskPaths.forEach(relPath => {
        if (!byPath.has(relPath)) {
            byPath.set(relPath, normalizeDraftDocumentEntry(null, relPath));
        }
    });
    return {
        ...normalizedManifest,
        documents: [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path)),
    };
}

function parseDraftManifestAtPath(manifestPath, draftId, updatedAtFallback) {
    const raw = parseManifestIfPresent(manifestPath) || {};
    const normalized = normalizeDraftManifest(raw, draftId, updatedAtFallback);
    const draftRoot = path.dirname(manifestPath);
    return syncManifestDocumentsFromDisk(normalized, draftRoot);
}

function resolveDraftDocumentAbsolutePath(draftId, relPath) {
    const resolved = resolveCacheDraftDir(draftId);
    if (!resolved || !fs.existsSync(resolved.path)) return null;
    const normalizedRel = normalizeDraftDocumentPath(relPath);
    if (!normalizedRel) return null;
    const absPath = path.resolve(resolved.path, normalizedRel);
    if (!isPathInside(resolved.path, absPath)) return null;
    if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) return null;
    return {
        draft: resolved,
        relPath: normalizedRel,
        absPath,
    };
}

function buildDraftDocumentEntryFromSource(source, relPath) {
    const fallbackTitle = titleFromDocumentPath(relPath);
    return normalizeDraftDocumentEntry({
        path: relPath,
        title: source.title || fallbackTitle,
        type: source.documentType || documentTypeFromExt(source.ext),
        tags: source.tags || [],
        archetypes: source.archetypes || [],
        status: source.documentStatus || 'unverified',
    }, relPath);
}

function collectCacheDraftSources({ relPath, relPaths, markdown, markdownBlocks, markdownFilename }) {
    const candidates = [];
    if (Array.isArray(relPaths)) {
        for (const value of relPaths) {
            const text = String(value || '').trim();
            if (text) candidates.push(text);
        }
    }
    const single = String(relPath || '').trim();
    if (single) candidates.push(single);
    const seen = new Set();
    const sources = [];
    for (const candidate of candidates) {
        const normalized = candidate.replace(/\\/g, '/');
        if (seen.has(normalized)) continue;
        seen.add(normalized);

        const absPath = resolveThresholdInboxPath(normalized);
        if (!absPath || !fs.existsSync(absPath)) {
            const error = new Error('Threshold source file not found.');
            error.status = 404;
            throw error;
        }
        const ext = path.extname(absPath).toLowerCase();
        if (!THRESHOLD_DRAFT_SOURCE_EXTS.has(ext)) {
            const allowed = Array.from(THRESHOLD_DRAFT_SOURCE_EXTS)
                .map(value => value.startsWith('.') ? value : '.' + value)
                .join(', ');
            const error = new Error('Cache draft source must be one of: ' + allowed + '.');
            error.status = 400;
            throw error;
        }
        const content = fs.readFileSync(absPath, 'utf8');
        const handoff = ext === '.md' ? parseGreenFireHandoff(content) : null;
        sources.push({
            relPath: toRootRelative(absPath) || normalized,
            absPath,
            ext,
            content,
            title: ext === '.md' ? extractMarkdownDisplayTitle(content, path.basename(absPath, ext)) : titleFromDocumentPath(path.basename(absPath)),
            documentType: handoff && handoff.type ? handoff.type : documentTypeFromExt(ext),
            tags: handoff && Array.isArray(handoff.tags) ? handoff.tags : [],
            archetypes: handoff && Array.isArray(handoff.archetypes) ? handoff.archetypes : [],
            documentStatus: handoff && handoff.status ? handoff.status : 'unverified',
        });
    }

    const singleMarkdown = typeof markdown === 'string' ? markdown.trim() : '';
    if (singleMarkdown) {
        const source = createInboxMarkdownFromText(markdown, markdownFilename);
        const handoff = parseGreenFireHandoff(source.markdown);
        sources.push(source);
        sources[sources.length - 1] = {
            ...source,
            ext: '.md',
            content: source.markdown,
            title: extractMarkdownDisplayTitle(source.markdown, path.basename(source.absPath, '.md')),
            documentType: handoff && handoff.type ? handoff.type : 'research-brief',
            tags: handoff && Array.isArray(handoff.tags) ? handoff.tags : [],
            archetypes: handoff && Array.isArray(handoff.archetypes) ? handoff.archetypes : [],
            documentStatus: handoff && handoff.status ? handoff.status : 'unverified',
        };
    }

    if (Array.isArray(markdownBlocks)) {
        for (let i = 0; i < markdownBlocks.length; i++) {
            const item = markdownBlocks[i];
            const text = extractMarkdownFromBlock(item);
            if (!String(text || '').trim()) continue;
            const preferredFilename = resolveMarkdownBlockFilename(item, i);
            const source = createInboxMarkdownFromText(text, preferredFilename);
            const handoff = parseGreenFireHandoff(source.markdown);
            sources.push({
                ...source,
                ext: '.md',
                content: source.markdown,
                title: extractMarkdownDisplayTitle(source.markdown, path.basename(source.absPath, '.md')),
                documentType: handoff && handoff.type ? handoff.type : 'research-brief',
                tags: handoff && Array.isArray(handoff.tags) ? handoff.tags : [],
                archetypes: handoff && Array.isArray(handoff.archetypes) ? handoff.archetypes : [],
                documentStatus: handoff && handoff.status ? handoff.status : 'unverified',
            });
        }
    }

    if (sources.length === 0) {
        const error = new Error('path or markdown is required');
        error.status = 400;
        throw error;
    }
    return sources;
}

function writeCacheDraftReadme({ draftId, title, description, updatedAt, documents }) {
    const readme = [
        '# ' + title,
        '',
        description || 'Cache draft generated from Threshold.',
        '',
        '## Cache Draft',
        '',
        '- id: `' + draftId + '`',
        '- source: threshold',
        '- updated: ' + updatedAt,
        '',
        '## Files',
        '',
        '- `manifest.json`',
        '- `README.md`',
        '- `documents/`',
        '',
        ...documents.map(entry => '- `' + entry.path + '`'),
        '',
        '## Note',
        '',
        'This cache draft is local-first and portable.',
        'Review all source material before treating this cache as trusted continuity memory.',
    ].join('\n');
    return readme + '\n';
}

function writeCacheDraftManifest({ draftPath, manifest }) {
    const manifestPath = path.join(draftPath, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
}

function buildCacheDraftState({ resolvedDraft, title, description }) {
    const manifestPath = path.join(resolvedDraft.path, 'manifest.json');
    const existingManifest = parseDraftManifestAtPath(manifestPath, resolvedDraft.id, new Date().toISOString());
    const now = new Date().toISOString();
    const normalized = {
        ...existingManifest,
        id: resolvedDraft.id,
        title: String(title || '').trim() || existingManifest.title || resolvedDraft.id,
        description: String(description || '').trim() || existingManifest.description || 'Cache draft generated from Threshold.',
        created_at: normalizeIsoTimestamp(existingManifest.created_at, now),
        updated_at: now,
        recommended_destination: 'archive/caches/' + resolvedDraft.id,
        source: 'threshold',
        type: 'local-cache-draft',
        status: existingManifest.status || 'draft',
        trusted: Boolean(existingManifest.trusted),
        auto_load: Boolean(existingManifest.auto_load),
    };
    return normalized;
}

function appendSourcesToCacheDraft({ draftId, sources, title, description }) {
    const resolvedDraft = resolveCacheDraftDir(draftId);
    if (!resolvedDraft) {
        const error = new Error('Invalid draftId.');
        error.status = 400;
        throw error;
    }
    ensureThresholdCacheDraftDirs();
    fs.mkdirSync(resolvedDraft.path, { recursive: true });
    const documentsDir = path.join(resolvedDraft.path, 'documents');
    fs.mkdirSync(documentsDir, { recursive: true });

    const manifest = buildCacheDraftState({ resolvedDraft, title, description });
    const usedDocNames = new Set(
        listDraftDocumentPaths(resolvedDraft.path).map(rel => path.basename(rel).toLowerCase()),
    );
    const appended = [];
    for (let i = 0; i < sources.length; i++) {
        const source = sources[i];
        const baseName = sanitizeFilename(path.basename(source.absPath)) || ('draft-doc-' + (i + 1));
        const baseExt = path.extname(baseName).toLowerCase();
        const stem = baseExt ? path.basename(baseName, baseExt) : baseName;
        const ext = THRESHOLD_DRAFT_SOURCE_EXTS.has(source.ext) ? source.ext : '.md';
        let candidate = stem + ext;
        let suffix = 2;
        let guard = 0;
        while (usedDocNames.has(candidate.toLowerCase())) {
            if (guard >= MAX_DOC_NAME_COLLISION_ATTEMPTS) {
                const error = new Error('Unable to generate unique cache draft document name.');
                error.status = 500;
                throw error;
            }
            candidate = stem + '-' + suffix + ext;
            suffix += 1;
            guard += 1;
        }
        usedDocNames.add(candidate.toLowerCase());
        const relPath = 'documents/' + candidate;
        const absDocPath = path.join(resolvedDraft.path, relPath);
        fs.mkdirSync(path.dirname(absDocPath), { recursive: true });
        fs.writeFileSync(absDocPath, source.content, 'utf8');
        appended.push(buildDraftDocumentEntryFromSource(source, relPath));
    }

    const byPath = new Map((manifest.documents || []).map(entry => [entry.path, normalizeDraftDocumentEntry(entry, entry.path)]));
    appended.forEach(entry => {
        if (entry) byPath.set(entry.path, entry);
    });
    const nextManifest = syncManifestDocumentsFromDisk({
        ...manifest,
        documents: [...byPath.values()].filter(Boolean),
        updated_at: new Date().toISOString(),
    }, resolvedDraft.path);

    writeCacheDraftManifest({ draftPath: resolvedDraft.path, manifest: nextManifest });
    fs.writeFileSync(
        path.join(resolvedDraft.path, 'README.md'),
        writeCacheDraftReadme({
            draftId: resolvedDraft.id,
            title: nextManifest.title,
            description: nextManifest.description,
            updatedAt: nextManifest.updated_at,
            documents: nextManifest.documents,
        }),
        'utf8',
    );

    return {
        resolvedDraft,
        manifest: nextManifest,
        appended,
    };
}

function createCacheDraftFromThresholdFile({
    relPath,
    relPaths,
    markdown,
    markdownBlocks,
    markdownFilename,
    draftId,
    title,
    description,
}) {
    const sources = collectCacheDraftSources({
        relPath,
        relPaths,
        markdown,
        markdownBlocks,
        markdownFilename,
    });
    const primarySource = sources[0];
    const resolvedDraft = resolveCacheDraftDir(
        draftId || path.basename(primarySource.absPath, path.extname(primarySource.absPath)),
    );
    if (!resolvedDraft) {
        const error = new Error('Invalid draftId.');
        error.status = 400;
        throw error;
    }

    const { manifest, appended } = appendSourcesToCacheDraft({
        draftId: resolvedDraft.id,
        sources,
        title: String(title || '').trim() || primarySource.title || resolvedDraft.id,
        description,
    });

    try {
        recordCacheInteraction({
            kind: 'cache_draft_created',
            draftId: resolvedDraft.id,
            sourcePaths: sources.map(source => source.relPath),
        });
    } catch { /* non-blocking memory update */ }

    return {
        id: resolvedDraft.id,
        path: 'threshold/cache-drafts/' + resolvedDraft.id,
        manifest,
        source_paths: sources.map(source => source.relPath),
        files: {
            manifest: 'threshold/cache-drafts/' + resolvedDraft.id + '/manifest.json',
            readme: 'threshold/cache-drafts/' + resolvedDraft.id + '/README.md',
            documents: appended.map(entry => 'threshold/cache-drafts/' + resolvedDraft.id + '/' + entry.path),
        },
    };
}

function addFilesToCacheDraft({ draftId, relPaths, title, description }) {
    const resolved = resolveCacheDraftDir(draftId);
    if (!resolved || !fs.existsSync(resolved.path)) {
        const error = new Error('Cache draft not found.');
        error.status = 404;
        throw error;
    }
    const sources = collectCacheDraftSources({
        relPaths,
        relPath: '',
        markdown: '',
        markdownBlocks: null,
        markdownFilename: null,
    });
    const { manifest, appended } = appendSourcesToCacheDraft({
        draftId: resolved.id,
        sources,
        title,
        description,
    });
    return {
        id: resolved.id,
        path: 'threshold/cache-drafts/' + resolved.id,
        manifest,
        added: appended,
    };
}

function readCacheDraft(draftId) {
    const resolved = resolveCacheDraftDir(draftId);
    if (!resolved || !fs.existsSync(resolved.path)) {
        const error = new Error('Cache draft not found.');
        error.status = 404;
        throw error;
    }
    const manifestPath = path.join(resolved.path, 'manifest.json');
    const readmePath = path.join(resolved.path, 'README.md');
    if (!fs.existsSync(manifestPath) || !fs.existsSync(readmePath)) {
        const error = new Error('Cache draft is incomplete (manifest.json + README.md required).');
        error.status = 400;
        throw error;
    }
    const stats = fs.statSync(manifestPath);
    const manifest = parseDraftManifestAtPath(
        manifestPath,
        resolved.id,
        (stats.mtime || stats.birthtime || new Date()).toISOString(),
    );
    return {
        id: resolved.id,
        path: 'threshold/cache-drafts/' + resolved.id,
        manifest,
        updatedAt: manifest.updated_at,
    };
}

function removeDocumentFromCacheDraft({ draftId, documentPath }) {
    const resolvedDoc = resolveDraftDocumentAbsolutePath(draftId, documentPath);
    if (!resolvedDoc) {
        const error = new Error('Draft document not found.');
        error.status = 404;
        throw error;
    }
    fs.unlinkSync(resolvedDoc.absPath);
    const manifestPath = path.join(resolvedDoc.draft.path, 'manifest.json');
    const currentManifest = parseDraftManifestAtPath(manifestPath, resolvedDoc.draft.id, new Date().toISOString());
    const nextManifest = syncManifestDocumentsFromDisk(
        {
            ...currentManifest,
            documents: currentManifest.documents.filter(entry => entry.path !== resolvedDoc.relPath),
            updated_at: new Date().toISOString(),
        },
        resolvedDoc.draft.path,
    );
    writeCacheDraftManifest({ draftPath: resolvedDoc.draft.path, manifest: nextManifest });
    fs.writeFileSync(
        path.join(resolvedDoc.draft.path, 'README.md'),
        writeCacheDraftReadme({
            draftId: resolvedDoc.draft.id,
            title: nextManifest.title,
            description: nextManifest.description,
            updatedAt: nextManifest.updated_at,
            documents: nextManifest.documents,
        }),
        'utf8',
    );
    return {
        id: resolvedDoc.draft.id,
        removed: resolvedDoc.relPath,
        manifest: nextManifest,
    };
}

function deleteCacheDraft(draftId) {
    const resolved = resolveCacheDraftDir(draftId);
    if (!resolved || !fs.existsSync(resolved.path)) {
        const error = new Error('Cache draft not found.');
        error.status = 404;
        throw error;
    }
    fs.rmSync(resolved.path, { recursive: true, force: true });
    const zipPath = path.join(CACHE_DRAFT_EXPORTS_DIR, resolved.id + '.zip');
    fs.rmSync(zipPath, { force: true });
    return {
        id: resolved.id,
        path: 'threshold/cache-drafts/' + resolved.id,
        deleted: true,
    };
}

function listCacheDrafts() {
    ensureThresholdCacheDraftDirs();
    const entries = fs.readdirSync(THRESHOLD_CACHE_DRAFTS_DIR, { withFileTypes: true });
    return entries
        .filter(entry => entry.isDirectory())
        .map(entry => {
            const resolved = resolveCacheDraftDir(entry.name);
            if (!resolved || !fs.existsSync(resolved.path)) return null;
            const manifestPath = path.join(resolved.path, 'manifest.json');
            const readmePath = path.join(resolved.path, 'README.md');
            if (!fs.existsSync(manifestPath) || !fs.existsSync(readmePath)) return null;
            const stats = fs.statSync(manifestPath);
            const fallbackUpdatedAt = (stats.mtime || stats.birthtime || new Date()).toISOString();
            const manifest = parseDraftManifestAtPath(manifestPath, resolved.id, fallbackUpdatedAt);
            return {
                id: resolved.id,
                path: 'threshold/cache-drafts/' + resolved.id,
                manifest,
                updatedAt: manifest.updated_at,
            };
        })
        .filter(Boolean)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function exportCacheDraftZip(draftId) {
    const resolved = resolveCacheDraftDir(draftId);
    if (!resolved || !fs.existsSync(resolved.path)) {
        const error = new Error('Cache draft not found.');
        error.status = 404;
        throw error;
    }
    const manifestPath = path.join(resolved.path, 'manifest.json');
    const readmePath = path.join(resolved.path, 'README.md');
    if (!fs.existsSync(manifestPath) || !fs.existsSync(readmePath)) {
        const error = new Error('Cache draft is incomplete (manifest.json + README.md required).');
        error.status = 400;
        throw error;
    }

    ensureThresholdCacheDraftDirs();
    const zip = new AdmZip();
    const requiredFiles = ['manifest.json', 'README.md'];
    for (const rel of requiredFiles) {
        const abs = path.join(resolved.path, rel);
        if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
        zip.addFile(resolved.id + '/' + rel, fs.readFileSync(abs));
    }
    const documentsDir = path.join(resolved.path, 'documents');
    const documentFiles = fs.existsSync(documentsDir) ? listFilesRecursive(documentsDir) : [];
    for (const filePath of documentFiles) {
        const rel = path.relative(resolved.path, filePath).replace(/\\/g, '/');
        if (!rel || rel.includes('..')) continue;
        if (!rel.startsWith('documents/')) continue;
        if (!isVisiblePath(rel)) continue;
        zip.addFile(resolved.id + '/' + rel, fs.readFileSync(filePath));
    }
    const exportPath = path.join(CACHE_DRAFT_EXPORTS_DIR, resolved.id + '.zip');
    zip.writeZip(exportPath);
    try {
        recordCacheInteraction({
            kind: 'cache_draft_exported',
            draftId: resolved.id,
            sourcePaths: [toRootRelative(exportPath) || ('exports/cache-drafts/' + resolved.id + '.zip')],
        });
    } catch { /* non-blocking memory update */ }

    return {
        id: resolved.id,
        exportPath: toRootRelative(exportPath) || ('exports/cache-drafts/' + resolved.id + '.zip'),
    };
}

function resolveExportZipPath(exportRelPath, draftId) {
    if (!exportRelPath) {
        return path.join(CACHE_DRAFT_EXPORTS_DIR, draftId + '.zip');
    }
    const candidate = resolveSourcePath(String(exportRelPath).replace(/\\/g, '/'));
    if (!candidate) return null;
    const abs = path.resolve(candidate);
    if (!isPathInside(EXPORTS_DIR, abs)) return null;
    return abs;
}

function installCacheDraftFromExport({ draftId, exportRelPath }) {
    const normalizedDraftId = sanitizeDraftId(draftId);
    if (!normalizedDraftId) {
        const error = new Error('Invalid draftId.');
        error.status = 400;
        throw error;
    }
    const zipPath = resolveExportZipPath(exportRelPath, normalizedDraftId);
    if (!zipPath || !fs.existsSync(zipPath)) {
        const error = new Error('Export zip not found.');
        error.status = 404;
        throw error;
    }

    const destinationRoot = path.join(ARCHIVE_CACHES_DIR, normalizedDraftId);
    fs.rmSync(destinationRoot, { recursive: true, force: true });
    fs.mkdirSync(destinationRoot, { recursive: true });

    const zip = new AdmZip(zipPath);
    for (const entry of zip.getEntries()) {
        let rel = String(entry.entryName || '').replace(/\\/g, '/').replace(/^\/+/, '');
        if (!rel) continue;
        if (rel.startsWith(normalizedDraftId + '/')) {
            rel = rel.slice(normalizedDraftId.length + 1);
        }
        if (!rel || rel === '.' || rel.includes('..')) continue;
        let normalizedRel = rel;
        if (normalizedRel === 'handoff.md') {
            normalizedRel = 'documents/handoff.md';
        }
        if (normalizedRel.startsWith('docs/')) {
            normalizedRel = 'documents/' + normalizedRel.slice('docs/'.length);
        }
        if (!isAllowedDraftPayloadPath(normalizedRel)) {
            continue;
        }
        if (!isVisiblePath(normalizedRel)) continue;

        const destination = path.resolve(destinationRoot, normalizedRel);
        if (!isPathInside(destinationRoot, destination)) {
            throw new Error('Unsafe zip path detected: ' + entry.entryName);
        }

        if (entry.isDirectory) {
            fs.mkdirSync(destination, { recursive: true });
            continue;
        }
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.writeFileSync(destination, entry.getData());
    }

    const manifestPath = path.join(destinationRoot, 'manifest.json');
    const readmePath = path.join(destinationRoot, 'README.md');
    if (!fs.existsSync(manifestPath) || !fs.existsSync(readmePath)) {
        const error = new Error('Installed cache is missing manifest.json or README.md.');
        error.status = 400;
        throw error;
    }
    try {
        recordCacheInteraction({
            kind: 'cache_draft_installed',
            draftId: normalizedDraftId,
            cacheId: normalizedDraftId,
            sourcePaths: [toRootRelative(zipPath) || ('exports/cache-drafts/' + normalizedDraftId + '.zip')],
        });
    } catch { /* non-blocking memory update */ }

    return {
        id: normalizedDraftId,
        installedPath: 'archive/caches/' + normalizedDraftId,
        exportPath: toRootRelative(zipPath) || ('exports/cache-drafts/' + normalizedDraftId + '.zip'),
        manifest: parseManifestIfPresent(manifestPath),
    };
}

/**
 * Build the current runtime stewardship view for Threshold.
 * Returns a single Ollama runtime card plus the active Ember Prime assignment.
 *
 * @returns {Promise<{runtimes: object[], active: object}>}
 */
async function buildRuntimeStewardshipView() {
    const probe = await probeOllamaRuntime();
    const intakeState = loadIntakeState();
    const intake = (intakeState.runtimes && intakeState.runtimes['ollama-local']) || null;
    const trusted = intake && intake.state === 'trusted';
    const rejected = intake && intake.state === 'rejected';
    return {
        runtimes: [
            {
                id: 'ollama-local',
                name: 'Ollama',
                type: 'model_host',
                interface: 'http',
                endpoint: 'http://localhost:11434',
                status: probe.ok ? 'detected' : 'not_detected',
                running: probe.ok,
                trusted,
                rejected: Boolean(rejected),
                intake,
                role: trusted ? 'ember_prime' : null,
                lastSeen: probe.ok ? new Date().toISOString() : null,
            },
        ],
        active: trusted ? { heart: 'ollama-local' } : {},
    };
}

function parseMultipartUploads(req) {
    return new Promise((resolve, reject) => {
        const contentType = req.headers['content-type'] || '';
        const boundaryMatch = contentType.match(/boundary=([^;]+)/i);
        if (!boundaryMatch) {
            reject(new Error('Expected multipart form-data upload.'));
            return;
        }

        const boundary = boundaryMatch[1].trim().replace(/^"|"$/g, '');
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('error', reject);
        req.on('end', () => {
            try {
                const body = Buffer.concat(chunks);
                const delimiter = Buffer.from('--' + boundary);
                const parts = [];
                let start = body.indexOf(delimiter);
                while (start !== -1) {
                    const next = body.indexOf(delimiter, start + delimiter.length);
                    if (next === -1) break;
                    const part = body.slice(start + delimiter.length, next);
                    start = next;
                    if (part.length === 0) continue;
                    const trimmed = part.slice(part.indexOf('\r\n') === 0 ? 2 : 0);
                    const headerEnd = trimmed.indexOf(Buffer.from('\r\n\r\n'));
                    if (headerEnd === -1) continue;
                    const headerText = trimmed.slice(0, headerEnd).toString('utf8');
                    const filenameMatch = headerText.match(/filename="([^"]*)"/i);
                    if (!filenameMatch) continue;
                    const filename = filenameMatch[1];
                    if (!filename) continue;
                    let content = trimmed.slice(headerEnd + 4);
                    if (content.slice(-2).toString() === '\r\n') {
                        content = content.slice(0, -2);
                    }
                    parts.push({ filename, buffer: content });
                }
                resolve(parts);
            } catch (err) {
                reject(err);
            }
        });
    });
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Auto-register any unmanaged files found in the threshold directory.
 * Creates manifest entries (without indexing) so files become actionable
 * in the Threshold intake queue immediately — no manual re-upload required.
 *
 * Safe to call repeatedly: uses upsertManifest which is idempotent.
 */
function autoRegisterThresholdFiles() {
    const thresholdDir = path.join(DATA_ROOT, 'threshold');
    if (!fs.existsSync(thresholdDir)) return;

    const manifests = loadManifests();
    const byPath    = {};
    Object.values(manifests).forEach(m => {
        if (m.path) byPath[m.path.replace(/\\/g, '/')] = m;
    });

    let entries;
    try { entries = fs.readdirSync(thresholdDir, { withFileTypes: true }); }
    catch { return; }

    for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (DETECT_IGNORE_FILES.has(entry.name)) continue;
        const ext = path.extname(entry.name).toLowerCase();
        if (!DETECT_SUPPORTED_EXTS.has(ext)) continue;

        const relPath = 'threshold/' + entry.name;
        if (byPath[relPath]) continue;   // already registered

        const absPath = path.join(thresholdDir, entry.name);
        try {
            const source = buildSourceRecord({
                filePath: absPath,
                room:     'threshold',
            });
            upsertManifest(source.id, source);
        } catch { /* skip files that cannot be read */ }
    }
}

// ── Phase 4: Threshold intake ─────────────────────────────────────────────────

/**
 * GET /api/threshold/list
 * Returns files in the Threshold intake queue, including metadata.
 * Augments each file record with its persistent intake state.
 *
 * Auto-registers any unmanaged files found in the threshold directory so
 * files placed directly in the folder appear immediately with sourceIds.
 */
router.get('/api/threshold/list', readLimiter, (req, res) => {
    // Auto-register unmanaged threshold files so they surface with sourceIds
    autoRegisterThresholdFiles();
    const thresholdDir = path.join(DATA_ROOT, 'threshold');
    if (!fs.existsSync(thresholdDir)) return res.json({ files: [] });

    const manifests   = loadManifests();
    const intakeState = loadIntakeState();

    const fromManifests = Object.values(manifests)
        .filter(m => m.room === 'threshold')
        .map(m => {
            let size = 0;
            const absPath = resolveSourcePath(m.path);
            if (fs.existsSync(absPath)) {
                try { size = fs.statSync(absPath).size; } catch { /* ignore */ }
            }
            const relPath = (m.path || '').replace(/\\/g, '/');
            const intake  = (intakeState.files && intakeState.files[relPath]) || null;
            return {
                filename:    m.file,
                path:        m.path,
                size,
                created:     m.ingestTimestamp,
                sourceId:    m.id,
                title:       m.title       || null,
                description: m.description || null,
                shelf:       m.shelf       || null,
                status:      m.status      || 'waiting',
                sourceType:  m.sourceType  || null,
                metaOnly:    m.metaOnly    || false,
                intake,
            };
        });

    const manifestFiles = new Set(fromManifests.map(f => f.filename));
    const extra = fs.readdirSync(thresholdDir)
        .filter(f => DETECT_SUPPORTED_EXTS.has(path.extname(f).toLowerCase()) && !manifestFiles.has(f))
        .map(f => {
            const stats   = fs.statSync(path.join(thresholdDir, f));
            const relPath = 'threshold/' + f;
            const intake  = (intakeState.files && intakeState.files[relPath]) || null;
            return {
                filename:    f,
                path:        relPath,
                size:        stats.size,
                created:     (stats.birthtime || stats.mtime).toISOString(),
                sourceId:    null,
                title:       null,
                description: null,
                shelf:       null,
                status:      'waiting',
                sourceType:  path.extname(f).toLowerCase().slice(1),
                metaOnly:    false,
                intake,
            };
        });

    const files = [...fromManifests, ...extra]
        .sort(function(a, b) { return b.created.localeCompare(a.created); });

    res.json({ files });
});

/**
 * POST /api/threshold/import
 * Accept one or more uploaded files and store them in threshold/inbox/.
 */
router.post('/api/threshold/import', writeLimiter, async (req, res) => {
    try {
        const contentType = req.headers['content-type'] || '';
        if (!/multipart\/form-data/i.test(contentType)) {
            return res.status(400).json({ error: 'Expected multipart form-data upload.' });
        }

        const uploads = await parseMultipartUploads(req);
        if (!Array.isArray(uploads) || uploads.length === 0) {
            return res.status(400).json({ error: 'No files uploaded.' });
        }

        ensureThresholdInboxDir();
        const imported = [];
        for (const upload of uploads) {
            const ext = path.extname(upload.filename || '').toLowerCase();
            if (!THRESHOLD_IMPORT_EXTS.has(ext)) {
                return res.status(400).json({
                    error: 'Unsupported file type "' + ext + '". Allowed: ' + [...THRESHOLD_IMPORT_EXTS].join(', '),
                });
            }
            const finalName = uniqueInboxName(upload.filename);
            const absPath = path.resolve(THRESHOLD_INBOX_DIR, finalName);
            if (!isPathInside(THRESHOLD_INBOX_DIR, absPath)) {
                return res.status(400).json({ error: 'Invalid upload target path.' });
            }
            fs.writeFileSync(absPath, upload.buffer);
            const stats = fs.statSync(absPath);
            imported.push({
                name: finalName,
                path: 'threshold/inbox/' + finalName,
                type: normalizeImportType(ext),
                size: stats.size,
                imported_at: (stats.birthtime || stats.mtime || new Date()).toISOString(),
            });
        }

        res.json({ imported });
    } catch (error) {
        console.error('Error importing threshold files:', error.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

/**
 * GET /api/threshold/files
 * List imported files in threshold/inbox/.
 */
router.get('/api/threshold/files', readLimiter, (req, res) => {
    try {
        res.json({ files: listThresholdInboxFiles() });
    } catch (error) {
        console.error('Error listing threshold files:', error.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

/**
 * POST /api/threshold/inbox/markdown
 * Body: { markdown: string, filename?: string }
 * Save pasted markdown/text payload as a Threshold inbox .md handoff file.
 */
router.post('/api/threshold/inbox/markdown', writeLimiter, (req, res) => {
    try {
        const markdown = req.body && typeof req.body.markdown === 'string'
            ? req.body.markdown
            : '';
        const filename = req.body && typeof req.body.filename === 'string'
            ? req.body.filename
            : null;
        if (!markdown.trim()) {
            return res.status(400).json({ error: 'markdown is required' });
        }
        const source = createInboxMarkdownFromText(markdown, filename);
        const stats = fs.statSync(source.absPath);
        const handoff = parseGreenFireHandoff(source.markdown);
        const sentinelLoadoutDetected = isSentinelLoadoutBootstrapMarkdown(source.markdown, handoff);
        return res.json({
            success: true,
            file: {
                name: path.basename(source.absPath),
                path: source.relPath,
                type: 'markdown',
                size: stats.size,
                imported_at: (stats.birthtime || stats.mtime || new Date()).toISOString(),
                handoff,
                bootstrapDetected: Boolean(handoff && handoff.detected && handoff.type === 'bootstrap'),
                sentinelLoadoutDetected,
            },
        });
    } catch (error) {
        const status = Number.isInteger(error.status) ? error.status : 500;
        return res.status(status).json({ error: status === 500 ? 'Internal Server Error' : error.message });
    }
});

router.post('/api/threshold/bootstrap/use', writeLimiter, (req, res) => {
    try {
        const relPath = String(req.body && req.body.path ? req.body.path : '').trim();
        if (!relPath) {
            return res.status(400).json({ error: 'path is required' });
        }
        const absPath = resolveThresholdInboxPath(relPath);
        if (!absPath || !fs.existsSync(absPath)) {
            return res.status(404).json({ error: 'Bootstrap file not found.' });
        }
        const ext = path.extname(absPath).toLowerCase();
        if (ext !== '.md') {
            return res.status(400).json({ error: 'Bootstrap import requires a .md file.' });
        }
        const content = fs.readFileSync(absPath, 'utf8');
        const handoff = parseGreenFireHandoff(content);
        const sentinelLoadoutDetected = isSentinelLoadoutBootstrapMarkdown(content, handoff);
        if (!handoff.detected || handoff.type !== 'bootstrap') {
            return res.status(400).json({ error: 'Bootstrap detected metadata not found (type: bootstrap).' });
        }

        const overwrite = Boolean(req.body && req.body.overwrite === true);
        const existing = loadRollingBootstrap();
        const existingSummary = existing && typeof existing.summary === 'string'
            ? existing.summary.trim()
            : '';
        if (existingSummary && !overwrite) {
            return res.status(409).json({
                error: 'Existing Rolling Bootstrap summary present. Confirm overwrite to continue.',
                confirmationRequired: true,
            });
        }

        const importedSummary = stripFrontmatter(content).trim().slice(0, MAX_IMPORTED_BOOTSTRAP_SUMMARY_LENGTH);
        const now = new Date().toISOString();
        const importedName = path.basename(absPath);
        fs.mkdirSync(IMPORTED_BOOTSTRAPS_DIR, { recursive: true });
        const importedTarget = path.join(IMPORTED_BOOTSTRAPS_DIR, now.replace(/[:.]/g, '-') + '-' + importedName);
        fs.writeFileSync(importedTarget, content, 'utf8');

        const refreshed = existing || refreshRollingBootstrap({});
        const updated = {
            ...refreshed,
            updated_at: now,
            summary: importedSummary || refreshed.summary || '',
            imported_bootstrap: {
                path: 'system/memory/imported-bootstraps/' + path.basename(importedTarget),
                imported_at: now,
                source: relPath.replace(/\\/g, '/'),
            },
        };
        fs.mkdirSync(path.dirname(ROLLING_BOOTSTRAP_PATH), { recursive: true });
        fs.writeFileSync(ROLLING_BOOTSTRAP_PATH, JSON.stringify(updated, null, 2), 'utf8');
        try {
            recordCacheInteraction({
                kind: 'bootstrap_imported',
                bootstrapPath: updated.imported_bootstrap.path,
                sourcePaths: [relPath.replace(/\\/g, '/')],
            });
        } catch { /* non-blocking memory update */ }
        return res.json({
            success: true,
            message: sentinelLoadoutDetected ? 'Sentinel Loadout Bootstrap detected' : 'Bootstrap detected',
            rollingBootstrap: updated,
            sentinelLoadoutDetected,
        });
    } catch (error) {
        const status = Number.isInteger(error.status) ? error.status : 500;
        return res.status(status).json({ error: status === 500 ? 'Internal Server Error' : error.message });
    }
});

/**
 * POST /api/threshold/cache-drafts
 * Body: { path?: "threshold/inbox/<name>", paths?: string[], draftId?, title?, description? }
 */
router.post('/api/threshold/cache-drafts', writeLimiter, (req, res) => {
    try {
        const relPath = req.body && req.body.path ? String(req.body.path) : '';
        const relPaths = Array.isArray(req.body && req.body.paths) ? req.body.paths : null;
        const markdown = req.body && typeof req.body.markdown === 'string' ? req.body.markdown : '';
        const markdownBlocks = Array.isArray(req.body && req.body.markdownBlocks) ? req.body.markdownBlocks : null;
        const markdownFilename = req.body && req.body.markdownFilename ? String(req.body.markdownFilename) : null;
        if (!relPath && (!relPaths || relPaths.length === 0) && !markdown.trim() && (!markdownBlocks || markdownBlocks.length === 0)) {
            return res.status(400).json({ error: 'path or markdown is required' });
        }
        const draft = createCacheDraftFromThresholdFile({
            relPath,
            relPaths,
            markdown,
            markdownBlocks,
            markdownFilename,
            draftId: req.body && req.body.draftId,
            title: req.body && req.body.title,
            description: req.body && req.body.description,
        });
        res.json({ success: true, draft });
    } catch (error) {
        const status = Number.isInteger(error.status) ? error.status : 500;
        res.status(status).json({ error: status === 500 ? 'Internal Server Error' : error.message });
    }
});

/**
 * GET /api/threshold/cache-drafts
 * List created cache drafts in threshold/cache-drafts/.
 */
router.get('/api/threshold/cache-drafts', readLimiter, (req, res) => {
    try {
        res.json({ drafts: listCacheDrafts() });
    } catch (error) {
        console.error('Error listing cache drafts:', error.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

/**
 * GET /api/threshold/cache-drafts/:id
 * Read a single cache draft and normalized manifest.
 */
router.get('/api/threshold/cache-drafts/:id', readLimiter, (req, res) => {
    try {
        const draft = readCacheDraft(req.params.id);
        res.json({ success: true, draft });
    } catch (error) {
        const status = Number.isInteger(error.status) ? error.status : 500;
        res.status(status).json({ error: status === 500 ? 'Internal Server Error' : error.message });
    }
});

/**
 * POST /api/threshold/cache-drafts/:id/documents/add
 * Body: { paths: ["threshold/inbox/<name>", ...], title?, description? }
 */
router.post('/api/threshold/cache-drafts/:id/documents/add', writeLimiter, (req, res) => {
    try {
        const relPaths = Array.isArray(req.body && req.body.paths) ? req.body.paths : [];
        if (relPaths.length === 0) {
            return res.status(400).json({ error: 'paths is required' });
        }
        const draft = addFilesToCacheDraft({
            draftId: req.params.id,
            relPaths,
            title: req.body && req.body.title,
            description: req.body && req.body.description,
        });
        res.json({ success: true, draft });
    } catch (error) {
        const status = Number.isInteger(error.status) ? error.status : 500;
        res.status(status).json({ error: status === 500 ? 'Internal Server Error' : error.message });
    }
});

/**
 * GET /api/threshold/cache-drafts/:id/documents/content?path=documents/<name>
 * Return reader-safe content for cache draft documents.
 */
router.get('/api/threshold/cache-drafts/:id/documents/content', readLimiter, (req, res) => {
    try {
        const resolvedDoc = resolveDraftDocumentAbsolutePath(req.params.id, req.query.path || '');
        if (!resolvedDoc) {
            return res.status(404).json({ error: 'Draft document not found.' });
        }
        const ext = path.extname(resolvedDoc.absPath).toLowerCase();
        if (!THRESHOLD_DRAFT_READER_EXTS.has(ext)) {
            return res.status(400).json({ error: 'Unsupported reader type.' });
        }
        const content = fs.readFileSync(resolvedDoc.absPath, 'utf8');
        const fallbackTitle = path.basename(resolvedDoc.absPath, ext);
        const handoff = ext === '.md' ? parseGreenFireHandoff(content) : null;
        const contentType = ext === '.md'
            ? 'text/markdown'
            : ext === '.json'
                ? 'application/json'
                : 'text/plain';
        res.json({
            success: true,
            id: resolvedDoc.draft.id,
            path: 'threshold/cache-drafts/' + resolvedDoc.draft.id + '/' + resolvedDoc.relPath,
            title: ext === '.md' ? extractMarkdownDisplayTitle(content, fallbackTitle) : fallbackTitle,
            contentType,
            content,
            sourceLabel: 'Threshold Cache Draft',
            sourceType: normalizeImportType(ext),
            handoff,
        });
    } catch (error) {
        const status = Number.isInteger(error.status) ? error.status : 500;
        res.status(status).json({ error: status === 500 ? 'Internal Server Error' : error.message });
    }
});

/**
 * DELETE /api/threshold/cache-drafts/:id/documents
 * Body: { path: "documents/<name>" }
 */
router.delete('/api/threshold/cache-drafts/:id/documents', writeLimiter, (req, res) => {
    try {
        const relPath = req.body && req.body.path ? String(req.body.path) : '';
        if (!relPath) return res.status(400).json({ error: 'path is required' });
        const updated = removeDocumentFromCacheDraft({
            draftId: req.params.id,
            documentPath: relPath,
        });
        res.json({ success: true, updated });
    } catch (error) {
        const status = Number.isInteger(error.status) ? error.status : 500;
        res.status(status).json({ error: status === 500 ? 'Internal Server Error' : error.message });
    }
});

/**
 * POST /api/threshold/cache-drafts/:id/export
 * Export a cache draft as zip in exports/cache-drafts/<id>.zip
 */
router.post('/api/threshold/cache-drafts/:id/export', writeLimiter, (req, res) => {
    try {
        const exported = exportCacheDraftZip(req.params.id);
        res.json({ success: true, exported });
    } catch (error) {
        const status = Number.isInteger(error.status) ? error.status : 500;
        res.status(status).json({ error: status === 500 ? 'Internal Server Error' : error.message });
    }
});

/**
 * POST /api/threshold/cache-drafts/:id/install
 * Body (optional): { exportPath: "exports/cache-drafts/<id>.zip" }
 */
router.post('/api/threshold/cache-drafts/:id/install', writeLimiter, (req, res) => {
    try {
        const installed = installCacheDraftFromExport({
            draftId: req.params.id,
            exportRelPath: req.body && req.body.exportPath ? String(req.body.exportPath) : null,
        });
        res.json({ success: true, installed });
    } catch (error) {
        const status = Number.isInteger(error.status) ? error.status : 500;
        res.status(status).json({ error: status === 500 ? 'Internal Server Error' : error.message });
    }
});

/**
 * DELETE /api/threshold/cache-drafts/:id
 * Remove a cache draft folder and matching export zip if present.
 */
router.delete('/api/threshold/cache-drafts/:id', writeLimiter, (req, res) => {
    try {
        const deleted = deleteCacheDraft(req.params.id);
        res.json({ success: true, deleted });
    } catch (error) {
        const status = Number.isInteger(error.status) ? error.status : 500;
        res.status(status).json({ error: status === 500 ? 'Internal Server Error' : error.message });
    }
});

/**
 * GET /api/threshold/files/content?path=threshold/inbox/<name>
 * Return reader-safe text content for markdown/text/json files.
 */
router.get('/api/threshold/files/content', readLimiter, (req, res) => {
    try {
        const relPath = String(req.query.path || '');
        const absPath = resolveThresholdInboxPath(relPath);
        if (!absPath) {
            return res.status(400).json({ error: 'Invalid threshold file path.' });
        }
        if (!fs.existsSync(absPath)) {
            return res.status(404).json({ error: 'File not found.' });
        }

        const ext = path.extname(absPath).toLowerCase();
        if (ext === '.pdf') {
            return res.status(400).json({ error: 'PDF stored — reader support later.' });
        }
        if (!['.md', '.txt', '.json'].includes(ext)) {
            return res.status(400).json({ error: 'Unsupported reader type.' });
        }

        const content = fs.readFileSync(absPath, 'utf8');
        const handoff = ext === '.md'
            ? parseGreenFireHandoff(content)
            : null;
        const sentinelLoadoutDetected = ext === '.md'
            ? isSentinelLoadoutBootstrapMarkdown(content, handoff)
            : false;
        if (handoff && handoff.detected) {
            try {
                recordCacheInteraction({
                    kind: 'threshold_handoff_viewed',
                    sourcePaths: [relPath.replace(/\\/g, '/')],
                    handoffType: handoff.type,
                    handoffStatus: handoff.status,
                });
            } catch { /* non-blocking memory update */ }
        }
        const contentType = ext === '.md'
            ? 'text/markdown'
            : ext === '.json'
                ? 'application/json'
                : 'text/plain';
        const fallbackTitle = path.basename(absPath, ext);
        res.json({
            success: true,
            name: path.basename(absPath),
            path: relPath.replace(/\\/g, '/'),
            title: ext === '.md'
                ? extractMarkdownDisplayTitle(content, fallbackTitle)
                : fallbackTitle,
            contentType,
            content,
            sourceLabel: 'Threshold',
            sourceType: normalizeImportType(ext),
            handoff,
            sentinelLoadoutDetected,
        });
    } catch (error) {
        console.error('Error reading threshold file:', error.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

/**
 * DELETE /api/threshold/files
 * Body: { path: "threshold/inbox/<name>" }
 */
router.delete('/api/threshold/files', writeLimiter, (req, res) => {
    try {
        const relPath = (req.body && req.body.path) || '';
        const absPath = resolveThresholdInboxPath(relPath);
        if (!absPath) {
            return res.status(400).json({ error: 'Invalid threshold file path.' });
        }
        if (!fs.existsSync(absPath)) {
            return res.status(404).json({ error: 'File not found.' });
        }
        fs.unlinkSync(absPath);
        res.json({ success: true, deleted: relPath.replace(/\\/g, '/') });
    } catch (error) {
        console.error('Error deleting threshold file:', error.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// ── Runtime stewardship (Threshold) ────────────────────────────────────────────

router.get('/api/runtimes', readLimiter, async (req, res) => {
    try {
        const view = await buildRuntimeStewardshipView();
        res.json(view);
    } catch (err) {
        res.status(500).json({ error: 'Could not load runtimes: ' + err.message });
    }
});

router.post('/api/runtimes/scan', writeLimiter, async (req, res) => {
    try {
        const view = await buildRuntimeStewardshipView();
        res.json({ success: true, runtimes: view.runtimes, active: view.active });
    } catch (err) {
        res.status(500).json({ error: 'Runtime scan failed: ' + err.message });
    }
});

router.post('/api/runtimes/:id/inspect', writeLimiter, (req, res) => {
    if (req.params.id !== 'ollama-local') return res.status(404).json({ error: 'Runtime not found' });
    const entry = upsertIntakeRuntime('ollama-local', { state: 'inspected' });
    res.json({ success: true, intake: entry });
});

router.post('/api/runtimes/:id/admit', writeLimiter, (req, res) => {
    if (req.params.id !== 'ollama-local') return res.status(404).json({ error: 'Runtime not found' });
    const entry = upsertIntakeRuntime('ollama-local', { state: 'trusted' });
    res.json({ success: true, intake: entry });
});

router.post('/api/runtimes/:id/reject', writeLimiter, (req, res) => {
    if (req.params.id !== 'ollama-local') return res.status(404).json({ error: 'Runtime not found' });
    const entry = upsertIntakeRuntime('ollama-local', { state: 'rejected' });
    res.json({ success: true, intake: entry });
});

router.post('/api/runtimes/:id/launch', writeLimiter, async (req, res) => {
    if (req.params.id !== 'ollama-local') return res.status(404).json({ error: 'Runtime not found' });
    const launch = await launchOllamaRuntime();
    if (launch.success) {
        return res.json({ success: true, status: launch.status });
    }
    return res.status(500).json({
        success: false,
        status: launch.status,
        error: launch.error || 'Ollama did not respond in time.',
    });
});

router.get('/api/runtimes/active', readLimiter, (req, res) => {
    const intakeState = loadIntakeState();
    const trusted = intakeState.runtimes && intakeState.runtimes['ollama-local'] && intakeState.runtimes['ollama-local'].state === 'trusted';
    res.json({ active: trusted ? { heart: 'ollama-local' } : {} });
});
router.post('/api/runtimes/active', writeLimiter, (req, res) => {
    const heartId = req.body && req.body.heart;
    if (heartId === null) {
        upsertIntakeRuntime('ollama-local', { state: 'inspected' });
        return res.json({ success: true, active: {} });
    }
    if (heartId !== 'ollama-local') return res.status(404).json({ error: 'Runtime not found' });
    upsertIntakeRuntime('ollama-local', { state: 'trusted' });
    return res.json({ success: true, active: { heart: 'ollama-local' } });
});

module.exports = router;
module.exports.autoRegisterThresholdFiles = autoRegisterThresholdFiles;
