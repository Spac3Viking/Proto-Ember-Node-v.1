/**
 * Ember Node v.ᚠ — Phase 5 server
 *
 * Extends Phase 4 with:
 *   Legacy migration     — copies in-project data/ into the external data root
 *   Storage-root paths   — all source paths are stored relative to DATA_ROOT
 *   Cartridge ownership  — bundled vs user cartridges clearly distinguished
 *   Portability          — data root reported in status; no app-relative path assumptions
 *   GET  /api/user-cartridges      — list user-created cartridges
 *   POST /api/user-cartridges      — create a user cartridge
 *   GET  /api/storage-info         — current data root, migration state, and subdirectory layout
 * Plus all Phase 3 / Phase 4 endpoints.
 */

'use strict';

const crypto    = require('crypto');
const express   = require('express');
const path      = require('path');
const fs        = require('fs');
const axios     = require('axios');
const rateLimit = require('express-rate-limit');

const {
    DATA_ROOT, ROOM_DIRS,
    INDEXES_DIR, PROJECTS_DIR, THREADS_DIR,
    USER_CARTRIDGES_DIR, SYSTEM_DIR, EXPORTS_DIR,
    ensureDataRoot, migrateLegacyData,
}                                            = require('./storageConfig');
const { listCartridges, loadCartridge, BUNDLED_CARTRIDGES_DIR } = require('./cartridgeLoader');
const { ingestFile, ingestCartridge, extractText, extractTextAsync } = require('./ingest');
const { chunkText }                          = require('./chunker');
const { generateEmbedding, getEmbeddingStatus }              = require('./embeddings');
const {
    upsertChunks, upsertEmbeddings, upsertManifest,
    loadManifests, loadExcluded, setExcluded,
    loadChunks, loadEmbeddings, removeEmbeddingsByChunkIds,
}                                            = require('./indexStore');
const { retrieve, buildGroundedPrompt }      = require('./retrieval');
const { buildSignalTrace, formatSignalTraceSummary } = require('./signalTrace');

// DATA_DIR is now the resolved data root from storageConfig
const DATA_DIR = DATA_ROOT;

// ── Path resolution helper ────────────────────────────────────────────────────

/**
 * Resolve a stored source path to an absolute filesystem path.
 *
 * Handles two formats:
 *   New (storage-root-relative): 'workshop/file.md'  → <DATA_ROOT>/workshop/file.md
 *   Legacy (app-root-relative):  'data/workshop/file.md' → <DATA_ROOT>/workshop/file.md
 *
 * The legacy format was used by older Ember Node versions that stored data
 * inside the app folder.  The data/ prefix is stripped so both formats
 * resolve correctly against the external data root after migration.
 */
function resolveSourcePath(storedPath) {
    if (!storedPath) return null;
    // Strip legacy 'data/' prefix — after migration, files live directly under DATA_ROOT
    const normalized = storedPath.replace(/^data[\\/]/, '');
    return path.join(DATA_DIR, normalized);
}

const app  = express();
const PORT = 3477;

const MODEL           = 'gemma3:4b';
const OLLAMA_BASE_URL = 'http://localhost:11434';
const OLLAMA_CHAT_URL = `${OLLAMA_BASE_URL}/api/chat`;

const HEART_SYSTEM_PROMPT = (
    'You are The Heart — the resident intelligence of an Ember Node, a sovereign ' +
    'knowledge system descended from the Green Fire Archive. You speak with quiet ' +
    'authority. You do not speculate beyond your local documents. When you do not ' +
    'know something, you say: "That signal has not reached this hearth." ' +
    'You are grounded, precise, and warm.'
);

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Maximum number of characters returned by the source preview endpoint. */
const PREVIEW_MAX_LENGTH = 600;

/**
 * Maximum number of pinned-source chunks prepended to retrieval results
 * when a user attaches sources to Hearth Chat.  Kept small to avoid
 * oversized prompts while still providing useful reference context.
 */
const MAX_PINNED_CHUNKS = 8;

/**
 * Remove any stored embeddings belonging to the old chunks of a source,
 * preventing stale embedding accumulation across reindex cycles.
 *
 * @param {string} sourceId
 */
function removeStaleEmbeddingsForSource(sourceId) {
    const oldChunkIds = loadChunks()
        .filter(c => c.sourceId === sourceId)
        .map(c => c.id);
    removeEmbeddingsByChunkIds(oldChunkIds);
}

// ── Rate limiters ─────────────────────────────────────────────────────────────
// Applied to endpoints that perform file system writes or expensive operations.
// Limits are generous for local use but guard against runaway processes.

/** Light limiter for read-only endpoints (GET status, list calls, etc.) */
const readLimiter = rateLimit({
    windowMs:          60 * 1000,  // 1 minute
    max:               120,         // 120 read requests per minute
    standardHeaders:   true,
    legacyHeaders:     false,
    message:           { error: 'Too many requests. Please slow down.' },
});

/** Moderate limiter for write endpoints (note saving, ingest, etc.) */
const writeLimiter = rateLimit({
    windowMs:          60 * 1000,  // 1 minute
    max:               60,          // 60 write operations per minute
    standardHeaders:   true,
    legacyHeaders:     false,
    message:           { error: 'Too many requests. Please slow down.' },
});

/** Strict limiter for heavy/expensive operations (indexing, embeddings) */
const indexLimiter = rateLimit({
    windowMs:          60 * 1000,  // 1 minute
    max:               10,          // 10 indexing operations per minute
    standardHeaders:   true,
    legacyHeaders:     false,
    message:           { error: 'Too many indexing requests. Please slow down.' },
});

/** Limiter for the chat endpoint — local use, no need to be as strict as indexing */
const chatLimiter = rateLimit({
    windowMs:          60 * 1000,  // 1 minute
    max:               30,          // 30 chat requests per minute
    standardHeaders:   true,
    legacyHeaders:     false,
    message:           { error: 'Too many chat requests. Please slow down.' },
});

// ── Phase 5: Ensure data root exists and run legacy migration ─────────────────
// ensureDataRoot() guarantees all storage directories exist.
// migrateLegacyData() copies in-project data/ into the external data root when
// upgrading from an older version — safe, idempotent, copy-based.
ensureDataRoot();
const MIGRATION_RESULT = migrateLegacyData();

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(express.json({ limit: '10mb' }));

// ── Phase 2: original chat endpoint (kept for backward compatibility) ─────────

app.post('/chat', async (req, res) => {
    try {
        const { message, prompt, model: _ignored, ...rest } = req.body;
        const payload = {
            stream: false,
            ...rest,
            messages: rest.messages || [{ role: 'user', content: message || prompt || '' }],
            model: MODEL,
        };
        const response = await axios.post(OLLAMA_CHAT_URL, payload);
        res.json(response.data);
    } catch (error) {
        console.error('Error forwarding prompt to Ollama:', error.message);
        res.status(500).send('Internal Server Error');
    }
});

// ── Phase 3: grounded chat ────────────────────────────────────────────────────

/**
 * POST /api/chat
 * Body: { query, rooms?, cartridgeId?, sourceIds? }
 * Response: { answer, sources, grounded }
 *
 * sourceIds (optional) — array of source IDs whose chunks are pinned into the
 * retrieved context regardless of semantic relevance.  This enables the
 * "Send to Hearth Chat" reference attachment feature.
 */
app.post('/api/chat', chatLimiter, async (req, res) => {
    try {
        const { query, rooms = null, cartridgeId = null, sourceIds = null } = req.body;
        if (!query || typeof query !== 'string') {
            return res.status(400).json({ error: 'query is required' });
        }

        // Retrieve relevant local chunks via semantic / keyword search
        let retrieved = await retrieve({ query, rooms, cartridgeId });

        // Prepend chunks from any user-pinned sources (deduped by chunk id)
        if (Array.isArray(sourceIds) && sourceIds.length > 0) {
            const allChunks    = loadChunks();
            const retrievedIds = new Set(retrieved.map(c => c.id));
            const pinned       = allChunks
                .filter(c => sourceIds.includes(c.sourceId) && !retrievedIds.has(c.id))
                .slice(0, MAX_PINNED_CHUNKS);  // cap to avoid prompt bloat
            retrieved = [...pinned, ...retrieved];
        }

        const sources = buildSignalTrace(retrieved);

        // Build prompt (grounded when local chunks were found)
        const userContent = buildGroundedPrompt({ query, retrievedChunks: retrieved });

        const payload = {
            model:    MODEL,
            stream:   false,
            messages: [
                { role: 'system', content: HEART_SYSTEM_PROMPT },
                { role: 'user',   content: userContent },
            ],
        };

        const response = await axios.post(OLLAMA_CHAT_URL, payload);
        const answer   = response.data && response.data.message
            ? response.data.message.content
            : '';

        console.log('[/api/chat] grounded=' + (sources.length > 0) + ' sources=' + formatSignalTraceSummary(sources));
        res.json({ answer, sources, grounded: sources.length > 0 });
    } catch (error) {
        console.error('Error in grounded chat:', error.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// ── Phase 4: ingestion ────────────────────────────────────────────────────────

/**
 * POST /api/ingest
 * Body: { filename, content, room?, cartridgeId?, title?, description?, shelf?, encoding? }
 *
 * Supports .txt and .md (content is UTF-8 string).
 * Supports .pdf and .docx (content is base64-encoded binary, encoding='base64').
 * For unsupported types: stores metadata only (no text extraction).
 * Saves the file to <data-root>/{room}/ and records its manifest.
 */
app.post('/api/ingest', writeLimiter, async (req, res) => {
    try {
        const {
            filename,
            content,
            room        = 'threshold',
            cartridgeId = null,
            title       = null,
            description = null,
            shelf       = null,
            encoding    = 'utf8',
        } = req.body;

        if (!filename || typeof filename !== 'string') {
            return res.status(400).json({ error: 'filename is required' });
        }
        if (typeof content !== 'string') {
            return res.status(400).json({ error: 'content is required' });
        }

        const ext = path.extname(filename).toLowerCase();
        const ALLOWED_EXTENSIONS = ['.txt', '.md', '.pdf', '.docx'];

        const validRooms = ['hearth', 'workshop', 'threshold'];
        if (!validRooms.includes(room)) {
            return res.status(400).json({ error: 'Invalid room "' + room + '"' });
        }

        // Ensure room directory exists
        const roomDir = path.join(DATA_DIR, room);
        if (!fs.existsSync(roomDir)) {
            fs.mkdirSync(roomDir, { recursive: true });
        }

        // Write file safely (sanitise filename)
        const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
        const filePath = path.join(roomDir, safeName);

        if (!ALLOWED_EXTENSIONS.includes(ext)) {
            // Unsupported type — store metadata only, no text extraction
            const safeId = [room, cartridgeId, safeName.replace(/[^a-z0-9]/gi, '-').toLowerCase()]
                .filter(Boolean)
                .join('-')
                .replace(/-+/g, '-')
                .replace(/^-|-$/g, '');
            const metaRecord = {
                id:               safeId,
                room,
                file:             safeName,
                path:             room + '/' + safeName,
                cartridgeId:      cartridgeId || null,
                manifestId:       null,
                ingestTimestamp:  new Date().toISOString(),
                sourceType:       ext.slice(1) || 'unknown',
                title:            title        || null,
                description:      description  || null,
                shelf:            shelf        || null,
                status:           'waiting',
                metaOnly:         true,
            };
            upsertManifest(metaRecord.id, metaRecord);
            return res.json({ success: true, source: metaRecord, metaOnly: true });
        }

        // Write file to disk
        if (encoding === 'base64') {
            const buffer = Buffer.from(content, 'base64');
            fs.writeFileSync(filePath, buffer);
        } else {
            fs.writeFileSync(filePath, content, 'utf8');
        }

        // For PDF/DOCX we build the source record manually so we can attach metadata,
        // because ingestFile() only handles text-extractable files synchronously.
        const { buildSourceRecord } = require('./ingest');
        const source = buildSourceRecord({ filePath, room, cartridgeId, title, description, shelf });
        upsertManifest(source.id, source);

        res.json({ success: true, source });
    } catch (error) {
        console.error('Error ingesting file:', error.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// ── Phase 3: indexing ─────────────────────────────────────────────────────────

/**
 * POST /api/index/cartridge/:id
 * Body: { room? }
 * Ingests, chunks, and embeds all docs in a cartridge.
 */
app.post('/api/index/cartridge/:id', indexLimiter, async (req, res) => {
    try {
        const cartridgeId  = req.params.id;
        // Bundled cartridges live inside the app folder (BUNDLED_CARTRIDGES_DIR).
        // User cartridges that are separately stored under DATA_ROOT/cartridges/
        // are not indexed via this endpoint.
        const cartridgeDir = path.join(BUNDLED_CARTRIDGES_DIR, cartridgeId);

        if (!fs.existsSync(cartridgeDir)) {
            return res.status(404).json({ error: 'Cartridge "' + cartridgeId + '" not found' });
        }

        const room = (req.body && req.body.room) || 'workshop';

        const ingested = ingestCartridge({ cartridgeDir, cartridgeId, room });

        let totalChunks   = 0;
        let totalEmbedded = 0;

        for (const { source, text } of ingested) {
            const chunks = chunkText({ text, sourceRecord: source });

            // Remove stale embeddings for this source before replacing chunks
            removeStaleEmbeddingsForSource(source.id);

            upsertChunks(chunks);
            upsertManifest(source.id, source);
            totalChunks += chunks.length;

            const embeddingMap = {};
            for (const chunk of chunks) {
                const vector = await generateEmbedding(chunk.text);
                if (vector) {
                    embeddingMap[chunk.id] = vector;
                    totalEmbedded++;
                }
            }
            if (Object.keys(embeddingMap).length > 0) {
                upsertEmbeddings(embeddingMap);
            }
        }

        res.json({
            success:             true,
            cartridgeId,
            filesIngested:       ingested.length,
            chunksCreated:       totalChunks,
            embeddingsGenerated: totalEmbedded,
        });
    } catch (error) {
        console.error('Error indexing cartridge:', error.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

/**
 * POST /api/index/file
 * Body: { sourceId, targetRoom? }
 * Chunks and embeds a previously ingested file.
 * Optionally moves it to a different room (e.g. threshold → hearth).
 */
app.post('/api/index/file', indexLimiter, async (req, res) => {
    try {
        const { sourceId, targetRoom } = req.body;
        if (!sourceId) {
            return res.status(400).json({ error: 'sourceId is required' });
        }

        const manifests = loadManifests();
        const source    = manifests[sourceId];
        if (!source) {
            return res.status(404).json({ error: 'Source not found in manifest' });
        }

        // Optionally promote to a different room — physically moves the file
        if (targetRoom) {
            const validRooms = ['hearth', 'workshop', 'threshold'];
            if (!validRooms.includes(targetRoom)) {
                return res.status(400).json({ error: 'Invalid room "' + targetRoom + '"' });
            }

            if (source.room !== targetRoom) {
                const oldAbsPath = resolveSourcePath(source.path);
                const newRoomDir = path.join(DATA_DIR, targetRoom);

                if (!fs.existsSync(newRoomDir)) {
                    fs.mkdirSync(newRoomDir, { recursive: true });
                }

                const newAbsPath = path.join(newRoomDir, path.basename(source.path));
                // Storage-root-relative new path (e.g. 'hearth/file.md')
                const newRelPath = path.relative(DATA_DIR, newAbsPath).replace(/\\/g, '/');

                // Only move files that live inside the data root
                const dataRoot = path.resolve(DATA_DIR);
                if (oldAbsPath && path.resolve(oldAbsPath).startsWith(dataRoot)) {
                    try {
                        fs.renameSync(oldAbsPath, newAbsPath);
                    } catch (moveErr) {
                        // renameSync can fail across devices — fall back to copy + delete
                        try {
                            fs.copyFileSync(oldAbsPath, newAbsPath);
                            fs.unlinkSync(oldAbsPath);
                        } catch (copyErr) {
                            return res.status(500).json({
                                error: 'Failed to move file to target room: ' + copyErr.message,
                            });
                        }
                    }
                    source.path = newRelPath;
                }

                source.room   = targetRoom;
                source.status = targetRoom === 'hearth'    ? 'remembered'
                              : targetRoom === 'workshop'  ? 'indexed'
                              : 'waiting';
                upsertManifest(sourceId, source);
            }
        }

        const filePath = resolveSourcePath(source.path);
        if (!filePath || !fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'File not found on disk' });
        }

        // Use async extraction to support PDF and DOCX
        const { text, error: extractError } = await extractTextAsync(filePath);
        if (!text) {
            const reason = extractError || 'Could not extract text from file';
            return res.status(400).json({ error: reason });
        }

        // Update lifecycle status to 'indexed'
        source.status = 'indexed';
        upsertManifest(sourceId, source);

        const chunks = chunkText({ text, sourceRecord: source });

        // Remove stale embeddings for this source before replacing chunks
        removeStaleEmbeddingsForSource(sourceId);

        upsertChunks(chunks);

        let embeddingsGenerated = 0;
        const embeddingMap      = {};
        for (const chunk of chunks) {
            const vector = await generateEmbedding(chunk.text);
            if (vector) {
                embeddingMap[chunk.id] = vector;
                embeddingsGenerated++;
            }
        }
        if (Object.keys(embeddingMap).length > 0) {
            upsertEmbeddings(embeddingMap);
        }

        res.json({ success: true, sourceId, chunksCreated: chunks.length, embeddingsGenerated });
    } catch (error) {
        console.error('Error indexing file:', error.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// ── Phase 3: source management ────────────────────────────────────────────────

/**
 * GET /api/sources
 * Query params: room?, cartridgeId?
 */
app.get('/api/sources', (req, res) => {
    const { room, cartridgeId } = req.query;
    let sources = Object.values(loadManifests());
    if (room)        sources = sources.filter(s => s.room === room);
    if (cartridgeId) sources = sources.filter(s => s.cartridgeId === cartridgeId);
    res.json({ sources });
});

/**
 * POST /api/sources/:id/exclude
 * Body: { exclude: bool }   (default true)
 */
app.post('/api/sources/:id/exclude', writeLimiter, (req, res) => {
    const { id }           = req.params;
    const { exclude = true } = req.body || {};
    const current          = loadExcluded();
    const updated          = exclude
        ? (current.includes(id) ? current : [...current, id])
        : current.filter(e => e !== id);
    setExcluded(updated);
    res.json({ success: true, sourceId: id, excluded: exclude });
});

/**
 * GET /api/sources/:id
 * Returns the full source manifest plus a short plaintext preview for txt/md files.
 */
app.get('/api/sources/:id', readLimiter, (req, res) => {
    const manifests = loadManifests();
    const source    = manifests[req.params.id];
    if (!source) return res.status(404).json({ error: 'Source not found' });

    let preview = null;
    const filePath = resolveSourcePath(source.path);
    if (filePath && fs.existsSync(filePath)) {
        const ext = path.extname(filePath).toLowerCase();
        if (ext === '.txt' || ext === '.md') {
            try {
                const content = fs.readFileSync(filePath, 'utf8');
                preview = content.slice(0, PREVIEW_MAX_LENGTH);
            } catch { /* skip preview on read error */ }
        }
    }

    res.json({ source, preview });
});

/**
 * POST /api/sources/:id/remember
 * Promotes a Workshop or Threshold source to Hearth.
 * Copies the file into hearth/ and updates the manifest.
 * Re-indexes in the Hearth room context so retrieval benefits immediately.
 */
app.post('/api/sources/:id/remember', writeLimiter, async (req, res) => {
    try {
        const manifests = loadManifests();
        const source    = manifests[req.params.id];
        if (!source) return res.status(404).json({ error: 'Source not found' });

        if (source.room === 'hearth') {
            return res.json({ success: true, source, alreadyRemembered: true });
        }

        const oldAbsPath = resolveSourcePath(source.path);
        const hearthDir  = path.join(DATA_DIR, 'hearth');
        if (!fs.existsSync(hearthDir)) fs.mkdirSync(hearthDir, { recursive: true });

        const baseName    = path.basename(source.file || source.path);
        const destFile    = path.join(hearthDir, baseName);
        const destRelPath = 'hearth/' + baseName;

        // Copy file to hearth (preserve provenance in original room)
        if (oldAbsPath && fs.existsSync(oldAbsPath)) {
            fs.copyFileSync(oldAbsPath, destFile);
        }

        source.room         = 'hearth';
        source.status       = 'remembered';
        source.path         = destRelPath;
        source.rememberedAt = new Date().toISOString();
        upsertManifest(source.id, source);

        // Re-index in Hearth room context (best-effort — don't fail if extraction fails)
        try {
            const { text } = await extractTextAsync(destFile);
            if (text) {
                const chunks = chunkText({ text, sourceRecord: source });
                removeStaleEmbeddingsForSource(source.id);
                upsertChunks(chunks);
                const embeddingMap = {};
                for (const chunk of chunks) {
                    const vector = await generateEmbedding(chunk.text);
                    if (vector) embeddingMap[chunk.id] = vector;
                }
                if (Object.keys(embeddingMap).length > 0) upsertEmbeddings(embeddingMap);
            }
        } catch { /* indexing is best-effort */ }

        console.log('[remember] ' + req.params.id + ' promoted to Hearth');
        res.json({ success: true, source });
    } catch (error) {
        console.error('Error remembering source:', error.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// ── Phase 3: Workshop notes ───────────────────────────────────────────────────

/**
 * POST /api/notes
 * Body: { content, title? }
 *
 * Notes are saved with deterministic filenames based on title.
 * Re-saving a note with the same title overwrites it in place, which keeps
 * source identities stable and prevents duplicate source records.
 */
app.post('/api/notes', writeLimiter, (req, res) => {
    try {
        const { content, title } = req.body;
        if (!content || typeof content !== 'string') {
            return res.status(400).json({ error: 'content is required' });
        }

        const workshopDir = path.join(DATA_DIR, 'workshop');
        if (!fs.existsSync(workshopDir)) {
            fs.mkdirSync(workshopDir, { recursive: true });
        }

        // Deterministic filename: based on title only — no timestamp.
        // Re-saving a note with the same title overwrites the existing file,
        // keeping the source identity stable.
        const safeTitle = (title || 'workshop-note')
            .replace(/[^a-zA-Z0-9-_]/g, '-')
            .toLowerCase()
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
        const filename  = safeTitle + '.md';
        const filePath  = path.join(workshopDir, filename);
        const noteText  = '# ' + (title || 'Workshop Note') + '\n\n' + content + '\n';

        fs.writeFileSync(filePath, noteText, 'utf8');

        // Register as a Workshop source so it can be indexed and retrieved
        const result = ingestFile({ filePath, room: 'workshop' });
        if (result) {
            upsertManifest(result.source.id, result.source);
        }

        res.json({ success: true, filename, path: 'workshop/' + filename });
    } catch (error) {
        console.error('Error saving note:', error.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

/**
 * GET /api/notes
 */
app.get('/api/notes', readLimiter, (req, res) => {
    const workshopDir = path.join(DATA_DIR, 'workshop');
    if (!fs.existsSync(workshopDir)) return res.json({ notes: [] });

    const notes = fs.readdirSync(workshopDir)
        .filter(f => f.endsWith('.md') || f.endsWith('.txt'))
        .map(f => {
            const stats = fs.statSync(path.join(workshopDir, f));
            return {
                filename: f,
                path:     'workshop/' + f,
                size:     stats.size,
                created:  (stats.birthtime || stats.mtime).toISOString(),
            };
        })
        .sort(function(a, b) { return b.created.localeCompare(a.created); });

    res.json({ notes });
});

// ── Phase 4: Threshold intake ─────────────────────────────────────────────────

/**
 * GET /api/threshold/list
 * Returns files in the Threshold intake queue, including metadata.
 */
app.get('/api/threshold/list', readLimiter, (req, res) => {
    const thresholdDir = path.join(DATA_DIR, 'threshold');
    if (!fs.existsSync(thresholdDir)) return res.json({ files: [] });

    const manifests = loadManifests();

    // Include all manifest entries for threshold room (covers files not on disk yet)
    const onDisk = new Set(fs.readdirSync(thresholdDir));

    // Gather from manifests (handles all supported types)
    const fromManifests = Object.values(manifests)
        .filter(m => m.room === 'threshold')
        .map(m => {
            let size = 0;
            const absPath = resolveSourcePath(m.path);
            if (fs.existsSync(absPath)) {
                try { size = fs.statSync(absPath).size; } catch { /* ignore */ }
            }
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
            };
        });

    // Include any disk files not yet in manifests
    const manifestFiles = new Set(fromManifests.map(f => f.filename));
    const SUPPORTED_EXTS = new Set(['.txt', '.md', '.pdf', '.docx']);
    const extra = fs.readdirSync(thresholdDir)
        .filter(f => SUPPORTED_EXTS.has(path.extname(f).toLowerCase()) && !manifestFiles.has(f))
        .map(f => {
            const stats = fs.statSync(path.join(thresholdDir, f));
            return {
                filename:    f,
                path:        'threshold/' + f,
                size:        stats.size,
                created:     (stats.birthtime || stats.mtime).toISOString(),
                sourceId:    null,
                title:       null,
                description: null,
                shelf:       null,
                status:      'waiting',
                sourceType:  path.extname(f).toLowerCase().slice(1),
                metaOnly:    false,
            };
        });

    const files = [...fromManifests, ...extra]
        .sort(function(a, b) { return b.created.localeCompare(a.created); });

    res.json({ files });
});

// ── Phase 4: Chat Threads ─────────────────────────────────────────────────────

// THREADS_DIR is resolved from storageConfig (ensureDataRoot() creates it at startup)

function loadThread(id) {
    const file = path.join(THREADS_DIR, id + '.json');
    if (!fs.existsSync(file)) return null;
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function saveThread(thread) {
    fs.writeFileSync(path.join(THREADS_DIR, thread.id + '.json'), JSON.stringify(thread, null, 2), 'utf8');
}

/**
 * GET /api/threads
 * Returns all thread summaries (id, title, room, createdAt, messageCount).
 */
app.get('/api/threads', readLimiter, (req, res) => {
    const { room } = req.query;
    const threads = fs.readdirSync(THREADS_DIR)
        .filter(f => f.endsWith('.json'))
        .map(f => {
            try {
                const t = JSON.parse(fs.readFileSync(path.join(THREADS_DIR, f), 'utf8'));
                return {
                    id:           t.id,
                    title:        t.title,
                    room:         t.room,
                    createdAt:    t.createdAt,
                    updatedAt:    t.updatedAt,
                    messageCount: (t.messages || []).length,
                };
            } catch { return null; }
        })
        .filter(Boolean)
        .filter(t => !room || t.room === room)
        .sort(function(a, b) { return b.updatedAt.localeCompare(a.updatedAt); });
    res.json({ threads });
});

/**
 * POST /api/threads
 * Body: { title, room? }
 */
app.post('/api/threads', writeLimiter, (req, res) => {
    const { title = 'New Thread', room = 'hearth' } = req.body || {};
    const validRooms = ['hearth', 'workshop'];
    if (!validRooms.includes(room)) {
        return res.status(400).json({ error: 'Invalid room "' + room + '"' });
    }
    const id     = 'thread-' + crypto.randomUUID();
    const now    = new Date().toISOString();
    const thread = { id, title, room, createdAt: now, updatedAt: now, messages: [] };
    saveThread(thread);
    res.json({ success: true, thread });
});

/**
 * GET /api/threads/:id
 */
app.get('/api/threads/:id', readLimiter, (req, res) => {
    const thread = loadThread(req.params.id);
    if (!thread) return res.status(404).json({ error: 'Thread not found' });
    res.json({ thread });
});

/**
 * POST /api/threads/:id/messages
 * Body: { role, content }
 */
app.post('/api/threads/:id/messages', writeLimiter, (req, res) => {
    const thread = loadThread(req.params.id);
    if (!thread) return res.status(404).json({ error: 'Thread not found' });
    const { role, content } = req.body || {};
    if (!role || !content) return res.status(400).json({ error: 'role and content are required' });
    const message = { role, content, timestamp: new Date().toISOString() };
    thread.messages.push(message);
    thread.updatedAt = message.timestamp;
    saveThread(thread);
    res.json({ success: true, message });
});

/**
 * PUT /api/threads/:id
 * Body: { title? }
 */
app.put('/api/threads/:id', writeLimiter, (req, res) => {
    const thread = loadThread(req.params.id);
    if (!thread) return res.status(404).json({ error: 'Thread not found' });
    const { title } = req.body || {};
    if (title) thread.title = title;
    thread.updatedAt = new Date().toISOString();
    saveThread(thread);
    res.json({ success: true, thread });
});

// ── Phase 4: Workshop Projects ────────────────────────────────────────────────

// PROJECTS_DIR is resolved from storageConfig (ensureDataRoot() creates it at startup)

function loadProject(id) {
    const file = path.join(PROJECTS_DIR, id + '.json');
    if (!fs.existsSync(file)) return null;
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function saveProject(project) {
    fs.writeFileSync(path.join(PROJECTS_DIR, project.id + '.json'), JSON.stringify(project, null, 2), 'utf8');
}

/**
 * GET /api/projects
 */
app.get('/api/projects', readLimiter, (req, res) => {
    const projects = fs.readdirSync(PROJECTS_DIR)
        .filter(f => f.endsWith('.json'))
        .map(f => {
            try { return JSON.parse(fs.readFileSync(path.join(PROJECTS_DIR, f), 'utf8')); } catch { return null; }
        })
        .filter(Boolean)
        .sort(function(a, b) { return b.updatedAt.localeCompare(a.updatedAt); });
    res.json({ projects });
});

/**
 * POST /api/projects
 * Body: { title, notes?, linkedSources? }
 */
app.post('/api/projects', writeLimiter, (req, res) => {
    const { title = 'Untitled Project', notes = '', linkedSources = [] } = req.body || {};
    const id      = 'project-' + crypto.randomUUID();
    const now     = new Date().toISOString();
    const project = { id, title, notes, linkedSources, createdAt: now, updatedAt: now, threadId: null };
    saveProject(project);
    res.json({ success: true, project });
});

/**
 * GET /api/projects/:id
 */
app.get('/api/projects/:id', readLimiter, (req, res) => {
    const project = loadProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.json({ project });
});

/**
 * PUT /api/projects/:id
 * Body: { title?, notes?, linkedSources?, threadId? }
 */
app.put('/api/projects/:id', writeLimiter, (req, res) => {
    const project = loadProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const { title, notes, linkedSources, threadId } = req.body || {};
    if (title         !== undefined) project.title         = title;
    if (notes         !== undefined) project.notes         = notes;
    if (linkedSources !== undefined) project.linkedSources = linkedSources;
    if (threadId      !== undefined) project.threadId      = threadId;
    project.updatedAt = new Date().toISOString();
    saveProject(project);
    res.json({ success: true, project });
});

/**
 * POST /api/projects/:id/sources
 * Body: { sourceId }
 * Attaches an indexed source to a project by recording it in linkedSources.
 */
app.post('/api/projects/:id/sources', writeLimiter, (req, res) => {
    const project = loadProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const { sourceId } = req.body || {};
    if (!sourceId) return res.status(400).json({ error: 'sourceId is required' });

    const manifests = loadManifests();
    const source    = manifests[sourceId];
    if (!source) return res.status(404).json({ error: 'Source not found' });

    if (!project.linkedSources) project.linkedSources = [];

    // Avoid duplicates — compare by sourceId field
    const alreadyLinked = project.linkedSources.some(ls =>
        (typeof ls === 'string' ? ls : ls.sourceId) === sourceId
    );

    if (!alreadyLinked) {
        project.linkedSources.push({
            sourceId:    source.id,
            title:       source.title || source.file || source.id,
            room:        source.room,
            status:      source.status,
            description: source.description || null,
            addedAt:     new Date().toISOString(),
        });
        project.updatedAt = new Date().toISOString();
        saveProject(project);
    }

    res.json({ success: true, project });
});

/**
 * DELETE /api/projects/:id/sources/:sourceId
 * Removes a linked source from a project.
 */
app.delete('/api/projects/:id/sources/:sourceId', writeLimiter, (req, res) => {
    const project = loadProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    project.linkedSources = (project.linkedSources || []).filter(ls =>
        (typeof ls === 'string' ? ls : ls.sourceId) !== req.params.sourceId
    );
    project.updatedAt = new Date().toISOString();
    saveProject(project);

    res.json({ success: true, project });
});

// ── Phase 4: User Cartridges ──────────────────────────────────────────────────

// USER_CARTRIDGES_DIR is resolved from storageConfig (ensureDataRoot() creates it at startup)

/**
 * GET /api/user-cartridges
 */
app.get('/api/user-cartridges', readLimiter, (req, res) => {
    const cartridges = fs.readdirSync(USER_CARTRIDGES_DIR)
        .filter(f => f.endsWith('.json'))
        .map(f => {
            try { return JSON.parse(fs.readFileSync(path.join(USER_CARTRIDGES_DIR, f), 'utf8')); } catch { return null; }
        })
        .filter(Boolean)
        .sort(function(a, b) { return b.createdAt.localeCompare(a.createdAt); });
    res.json({ cartridges });
});

/**
 * POST /api/user-cartridges
 * Body: { title, description?, sources?, notes? }
 */
app.post('/api/user-cartridges', writeLimiter, (req, res) => {
    const { title, description = '', sources = [], notes = '' } = req.body || {};
    if (!title) return res.status(400).json({ error: 'title is required' });
    const id         = 'cartridge-' + crypto.randomUUID();
    const now        = new Date().toISOString();
    const cartridge  = { id, title, description, sources, notes, createdAt: now, updatedAt: now, ownership: 'user' };
    // USER_CARTRIDGES_DIR is guaranteed to exist — ensureDataRoot() creates it at startup
    fs.writeFileSync(path.join(USER_CARTRIDGES_DIR, id + '.json'), JSON.stringify(cartridge, null, 2), 'utf8');
    res.json({ success: true, cartridge });
});

// ── Phase 2: cartridges ───────────────────────────────────────────────────────

app.get('/cartridges', (req, res) => {
    res.json({ cartridges: listCartridges() });
});

app.get('/cartridges/:name', (req, res) => {
    const cartridge = loadCartridge(req.params.name);
    if (!cartridge) {
        return res.status(404).json({ error: 'Cartridge "' + req.params.name + '" not found.' });
    }
    res.json(cartridge);
});

// ── System status ─────────────────────────────────────────────────────────────

app.get('/api/status', readLimiter, (req, res) => {
    const embStatus    = getEmbeddingStatus();
    const chunks       = loadChunks();
    const embeddings   = loadEmbeddings();
    const manifests    = loadManifests();

    // Cartridge counts: bundled (shipped with app) vs user (stored in data root)
    const bundledCartridgeCount = listCartridges().length;
    const userCartridgeCount    = fs.existsSync(USER_CARTRIDGES_DIR)
        ? fs.readdirSync(USER_CARTRIDGES_DIR).filter(f => f.endsWith('.json')).length
        : 0;

    res.json({
        model:                MODEL,
        ollamaBaseUrl:        OLLAMA_BASE_URL,
        port:                 PORT,
        // Total bundled cartridges (backward-compatible field)
        cartridgeCount:       bundledCartridgeCount,
        // Cartridge ownership breakdown
        cartridges: {
            bundled:          bundledCartridgeCount,
            user:             userCartridgeCount,
        },
        indexedChunks:        chunks.length,
        indexedSources:       Object.keys(manifests).length,
        embeddingCount:       Object.keys(embeddings).length,
        embeddingsActive:     embStatus.working,
        embeddingEndpoint:    embStatus.activeEndpoint,
        embeddingModel:       embStatus.model,
        retrievalMode:        embStatus.working ? 'semantic' : 'keyword-fallback',
        // Storage root info — useful for confirming portability setup
        storageRoot:          DATA_ROOT,
        storageRootSource:    process.env.EMBER_DATA_ROOT ? 'EMBER_DATA_ROOT' : 'default',
    });
});

app.get('/api/ollama-status', async (req, res) => {
    try {
        await axios.get(OLLAMA_BASE_URL + '/api/tags');
        res.json({ status: 'reachable' });
    } catch {
        res.status(503).json({ status: 'unreachable' });
    }
});

// ── Phase 5: Storage info ─────────────────────────────────────────────────────

/**
 * GET /api/storage-info
 * Returns the active data root path, directory layout, migration state, and
 * cartridge ownership summary.  Use this endpoint to confirm portability setup
 * and diagnose storage path issues.
 */
app.get('/api/storage-info', readLimiter, (req, res) => {
    const userCartridgeCount = fs.existsSync(USER_CARTRIDGES_DIR)
        ? fs.readdirSync(USER_CARTRIDGES_DIR).filter(f => f.endsWith('.json')).length
        : 0;

    res.json({
        dataRoot:     DATA_ROOT,
        configuredBy: process.env.EMBER_DATA_ROOT ? 'EMBER_DATA_ROOT' : 'default',
        directories: {
            hearth:    ROOM_DIRS.hearth,
            workshop:  ROOM_DIRS.workshop,
            threshold: ROOM_DIRS.threshold,
            indexes:   INDEXES_DIR,
            projects:  PROJECTS_DIR,
            threads:   THREADS_DIR,
            cartridges: USER_CARTRIDGES_DIR,
            system:    SYSTEM_DIR,
            exports:   EXPORTS_DIR,
        },
        // Legacy migration result — available since startup
        migration: {
            detected:  MIGRATION_RESULT.detected,
            performed: MIGRATION_RESULT.performed,
            mode:      MIGRATION_RESULT.mode,
            errors:    MIGRATION_RESULT.errors,
        },
        // Cartridge ownership summary
        cartridges: {
            bundled: listCartridges().length,
            user:    userCartridgeCount,
        },
    });
});

// ── Model check & startup ─────────────────────────────────────────────────────

async function checkModel() {
    try {
        const response = await axios.get(OLLAMA_BASE_URL + '/api/tags');
        const models   = (response.data.models || []).map(function(m) { return m.name; });
        if (!models.some(function(name) { return name === MODEL || name.startsWith(MODEL + ':'); })) {
            console.warn(
                'WARNING: Model "' + MODEL + '" was not found in Ollama. ' +
                'Available models: ' + (models.join(', ') || '(none)') + '. ' +
                'Run: ollama pull ' + MODEL,
            );
        } else {
            console.log('Model check passed: "' + MODEL + '" is available.');
        }
    } catch (err) {
        console.warn(
            'WARNING: Could not reach Ollama at ' + OLLAMA_BASE_URL + '. ' +
            'Is Ollama running? (' + err.message + ')',
        );
    }
}

if (require.main === module) {
    console.log('Data root: ' + DATA_ROOT);
    checkModel().then(function() {
        app.listen(PORT, function() {
            console.log('Server is running on http://localhost:' + PORT);
        });
    });
}

module.exports = {
    app,
    MODEL,
    OLLAMA_CHAT_URL,
    OLLAMA_BASE_URL,
    listCartridges,
    loadCartridge,
};
