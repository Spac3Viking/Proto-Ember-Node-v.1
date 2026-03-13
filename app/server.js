/**
 * Ember Node v.ᚠ — Phase 3 server
 *
 * Extends the Phase 2 server with:
 *   POST /api/chat          — grounded chat with signal trace
 *   POST /api/ingest        — file ingestion into a room
 *   POST /api/index/cartridge/:id — index a cartridge's docs
 *   POST /api/index/file    — index a specific previously-ingested file
 *   GET  /api/sources       — list indexed source manifests
 *   POST /api/sources/:id/exclude — toggle source exclusion from retrieval
 *   POST /api/notes         — save a Workshop note
 *   GET  /api/notes         — list Workshop notes
 *   GET  /api/threshold/list — list files in Threshold intake
 */

'use strict';

const express   = require('express');
const path      = require('path');
const fs        = require('fs');
const axios     = require('axios');
const rateLimit = require('express-rate-limit');

const { listCartridges, loadCartridge }      = require('./cartridgeLoader');
const { ingestFile, ingestCartridge, DATA_DIR, extractText } = require('./ingest');
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

// ── Phase 3: ingestion ────────────────────────────────────────────────────────

/**
 * POST /api/ingest
 * Body: { filename, content, room?, cartridgeId? }
 * Saves the file to data/{room}/ and records its manifest.
 */
app.post('/api/ingest', writeLimiter, (req, res) => {
    try {
        const { filename, content, room = 'threshold', cartridgeId = null } = req.body;

        if (!filename || typeof filename !== 'string') {
            return res.status(400).json({ error: 'filename is required' });
        }
        if (typeof content !== 'string') {
            return res.status(400).json({ error: 'content is required' });
        }

        const ext = path.extname(filename).toLowerCase();
        if (ext !== '.txt' && ext !== '.md') {
            return res.status(400).json({ error: 'Only .txt and .md files are supported' });
        }

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
        fs.writeFileSync(filePath, content, 'utf8');

        const result = ingestFile({ filePath, room, cartridgeId });
        if (!result) {
            return res.status(500).json({ error: 'Failed to build source record' });
        }

        upsertManifest(result.source.id, result.source);
        res.json({ success: true, source: result.source });
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

                source.room = targetRoom;
                upsertManifest(sourceId, source);
            }
        }

        const filePath = path.join(__dirname, '..', source.path);
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'File not found on disk' });
        }

        const text = extractText(filePath);
        if (!text) {
            return res.status(400).json({ error: 'Could not extract text from file' });
        }

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

// ── Phase 3: Threshold intake ─────────────────────────────────────────────────

/**
 * GET /api/threshold/list
 */
app.get('/api/threshold/list', readLimiter, (req, res) => {
    const thresholdDir = path.join(DATA_DIR, 'threshold');
    if (!fs.existsSync(thresholdDir)) return res.json({ files: [] });

    const manifests = loadManifests();
    const files     = fs.readdirSync(thresholdDir)
        .filter(f => f.endsWith('.md') || f.endsWith('.txt'))
        .map(f => {
            const stats  = fs.statSync(path.join(thresholdDir, f));
            const source = Object.values(manifests).find(
                function(m) { return m.room === 'threshold' && m.file === f; }
            );
            return {
                filename: f,
                path:     'data/threshold/' + f,
                size:     stats.size,
                created:  (stats.birthtime || stats.mtime).toISOString(),
                sourceId: source ? source.id : null,
            };
        })
        .sort(function(a, b) { return b.created.localeCompare(a.created); });

    res.json({ files });
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
