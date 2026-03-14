/**
 * Ember Node v.ᚠ — Phase 4 server
 *
 * Extends Phase 3 with:
 *   POST /api/ingest         — file ingestion with metadata (title, description, shelf)
 *                              supports .txt, .md, .pdf, .docx (binary via base64)
 *   GET  /api/threads        — list chat threads
 *   POST /api/threads        — create a new chat thread
 *   GET  /api/threads/:id    — get thread with messages
 *   POST /api/threads/:id/messages — add message to thread
 *   GET  /api/projects       — list Workshop projects
 *   POST /api/projects       — create a project
 *   GET  /api/projects/:id   — get a project
 *   PUT  /api/projects/:id   — update a project
 *   GET  /api/user-cartridges      — list user-created cartridges
 *   POST /api/user-cartridges      — create a user cartridge
 * Plus all Phase 3 endpoints.
 */

'use strict';

const express   = require('express');
const path      = require('path');
const fs        = require('fs');
const axios     = require('axios');
const rateLimit = require('express-rate-limit');

const { listCartridges, loadCartridge }      = require('./cartridgeLoader');
const { ingestFile, ingestCartridge, DATA_DIR, extractText, extractTextAsync } = require('./ingest');
const { chunkText }                          = require('./chunker');
const { generateEmbedding, getEmbeddingStatus }              = require('./embeddings');
const {
    upsertChunks, upsertEmbeddings, upsertManifest,
    loadManifests, loadExcluded, setExcluded,
    loadChunks, loadEmbeddings, removeEmbeddingsByChunkIds,
}                                            = require('./indexStore');
const { retrieve, buildGroundedPrompt }      = require('./retrieval');
const { buildSignalTrace, formatSignalTraceSummary } = require('./signalTrace');

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
 * Body: { query, rooms?, cartridgeId? }
 * Response: { answer, sources, grounded }
 */
app.post('/api/chat', chatLimiter, async (req, res) => {
    try {
        const { query, rooms = null, cartridgeId = null } = req.body;
        if (!query || typeof query !== 'string') {
            return res.status(400).json({ error: 'query is required' });
        }

        // Retrieve relevant local chunks
        const retrieved = await retrieve({ query, rooms, cartridgeId });
        const sources   = buildSignalTrace(retrieved);

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
 * Saves the file to data/{room}/ and records its manifest.
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
            const metaRecord = {
                id:               [room, cartridgeId, safeName.replace(/[^a-z0-9]/gi, '-').toLowerCase()].filter(Boolean).join('-'),
                room,
                file:             safeName,
                path:             'data/' + room + '/' + safeName,
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
        const cartridgeDir = path.join(__dirname, '..', 'cartridges', cartridgeId);

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
                const oldAbsPath = path.join(__dirname, '..', source.path);
                const newRoomDir = path.join(DATA_DIR, targetRoom);

                if (!fs.existsSync(newRoomDir)) {
                    fs.mkdirSync(newRoomDir, { recursive: true });
                }

                const newAbsPath = path.join(newRoomDir, path.basename(source.path));
                const newRelPath = path.relative(path.join(__dirname, '..'), newAbsPath);

                // Only move files that live inside the data/ directory tree
                const dataRoot = path.resolve(DATA_DIR);
                if (path.resolve(oldAbsPath).startsWith(dataRoot)) {
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

        const filePath = path.join(__dirname, '..', source.path);
        if (!fs.existsSync(filePath)) {
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

        res.json({ success: true, filename, path: 'data/workshop/' + filename });
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
                path:     'data/workshop/' + f,
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
            const absPath = path.join(__dirname, '..', m.path);
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
                path:        'data/threshold/' + f,
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

const THREADS_DIR = path.join(DATA_DIR, 'threads');

function ensureThreadsDir() {
    if (!fs.existsSync(THREADS_DIR)) fs.mkdirSync(THREADS_DIR, { recursive: true });
}

function loadThread(id) {
    const file = path.join(THREADS_DIR, id + '.json');
    if (!fs.existsSync(file)) return null;
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function saveThread(thread) {
    ensureThreadsDir();
    fs.writeFileSync(path.join(THREADS_DIR, thread.id + '.json'), JSON.stringify(thread, null, 2), 'utf8');
}

/**
 * GET /api/threads
 * Returns all thread summaries (id, title, room, createdAt, messageCount).
 */
app.get('/api/threads', readLimiter, (req, res) => {
    ensureThreadsDir();
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
    const id     = 'thread-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
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

const PROJECTS_DIR = path.join(DATA_DIR, 'projects');

function ensureProjectsDir() {
    if (!fs.existsSync(PROJECTS_DIR)) fs.mkdirSync(PROJECTS_DIR, { recursive: true });
}

function loadProject(id) {
    const file = path.join(PROJECTS_DIR, id + '.json');
    if (!fs.existsSync(file)) return null;
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function saveProject(project) {
    ensureProjectsDir();
    fs.writeFileSync(path.join(PROJECTS_DIR, project.id + '.json'), JSON.stringify(project, null, 2), 'utf8');
}

/**
 * GET /api/projects
 */
app.get('/api/projects', readLimiter, (req, res) => {
    ensureProjectsDir();
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
    const id      = 'project-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
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

// ── Phase 4: User Cartridges ──────────────────────────────────────────────────

const USER_CARTRIDGES_DIR = path.join(DATA_DIR, 'cartridges');

function ensureUserCartridgesDir() {
    if (!fs.existsSync(USER_CARTRIDGES_DIR)) fs.mkdirSync(USER_CARTRIDGES_DIR, { recursive: true });
}

/**
 * GET /api/user-cartridges
 */
app.get('/api/user-cartridges', readLimiter, (req, res) => {
    ensureUserCartridgesDir();
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
    const id         = 'cartridge-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    const now        = new Date().toISOString();
    const cartridge  = { id, title, description, sources, notes, createdAt: now, updatedAt: now };
    ensureUserCartridgesDir();
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

app.get('/api/status', (req, res) => {
    const embStatus    = getEmbeddingStatus();
    const chunks       = loadChunks();
    const embeddings   = loadEmbeddings();
    const manifests    = loadManifests();

    res.json({
        model:               MODEL,
        ollamaBaseUrl:       OLLAMA_BASE_URL,
        port:                PORT,
        cartridgeCount:      listCartridges().length,
        indexedChunks:       chunks.length,
        indexedSources:      Object.keys(manifests).length,
        embeddingCount:      Object.keys(embeddings).length,
        embeddingsActive:    embStatus.working,
        embeddingEndpoint:   embStatus.activeEndpoint,
        embeddingModel:      embStatus.model,
        retrievalMode:       embStatus.working ? 'semantic' : 'keyword-fallback',
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
