/**
 * Ember Node v.ᚠ — Phase 8.75 server
 *
 * Current active architecture:
 *   Storage Root         — all user data under DATA_ROOT (storageConfig.js)
 *   Threshold / Workshop / Hearth — three-room model with lifecycle states
 *   Intake Discipline    — files and tools land in Threshold, explicit admission required
 *   Source Lifecycle     — waiting → indexed → remembered (manifest/source metadata)
 *   Intake State         — waiting / inspected / flagged / admitted / rejected (intake.json)
 *   Tool Registry        — discovery, trust, role assignment, active Heart selection
 *   Chat Integration     — /api/chat routes through the active Heart tool
 *   Startup Checklist    — /api/startup-check summarises system state at launch
 *
 * Key API groups:
 *   /api/chat            — grounded Heart chat (resolves active Heart automatically)
 *   /api/sources         — source manifest CRUD + lifecycle transitions
 *   /api/threshold/*     — Threshold intake queue
 *   /api/detected-files  — local file scanner (unmanaged + changed)
 *   /api/tools           — tool registry, trust flow, Heart assignment
 *   /api/threads         — chat thread persistence
 *   /api/projects        — Workshop projects with linked sources
 *   /api/startup-check   — launch summary (centralised, single source of truth)
 *   /api/storage-info    — data root, directories, migration state
 *   /api/intake-state    — persistent intake decisions (files + tools)
 *
 * Legacy compatibility:
 *   POST /chat           — Phase 2 direct-Ollama endpoint; kept for backward compatibility
 *   resolveSourcePath()  — strips legacy data/ prefix from stored paths after migration
 */

'use strict';

const crypto    = require('crypto');
const express   = require('express');
const path      = require('path');
const fs        = require('fs');
const axios     = require('axios');
const rateLimit = require('express-rate-limit');
const { spawn } = require('child_process');

const {
    DATA_ROOT, ROOM_DIRS,
    INDEXES_DIR, PROJECTS_DIR, THREADS_DIR,
    USER_CARTRIDGES_DIR, SYSTEM_DIR, EXPORTS_DIR,
    ensureDataRoot, migrateLegacyData,
}                                            = require('./storageConfig');
const { listCartridges, loadCartridge, BUNDLED_CARTRIDGES_DIR } = require('./cartridgeLoader');
const { ingestFile, ingestCartridge, extractText, extractTextAsync, buildSourceRecord } = require('./ingest');
const { chunkText }                          = require('./chunker');
const { generateEmbedding, getEmbeddingStatus }              = require('./embeddings');
const {
    upsertChunks, upsertEmbeddings, upsertManifest,
    loadManifests, loadExcluded, setExcluded,
    loadChunks, loadEmbeddings, removeEmbeddingsByChunkIds,
}                                            = require('./indexStore');
const { retrieve, buildGroundedPrompt }      = require('./retrieval');
const { buildSignalTrace, formatSignalTraceSummary } = require('./signalTrace');
const { discoverTools, httpProbe }               = require('./toolDiscovery');


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
    return path.join(DATA_ROOT, normalized);
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

// ── Phase 7: Tool Registry ────────────────────────────────────────────────────

/** Path to the tool registry JSON file. */
const TOOLS_REGISTRY_PATH = path.join(SYSTEM_DIR, 'tools.json');

// ── Phase 8.5: Intake State Persistence ──────────────────────────────────────

/**
 * Path to the intake state JSON file.
 * Tracks user decisions (rejected, inspected, admitted, etc.) across restarts.
 */
const INTAKE_STATE_PATH = path.join(SYSTEM_DIR, 'intake.json');

/**
 * Load the persistent intake state from disk.
 *
 * Schema:
 *   {
 *     files: {
 *       "room/file.txt": {
 *         path, state, lastReviewed, lastKnownMtime, notes
 *       }
 *     },
 *     tools: {
 *       "tool-id": {
 *         id, state, lastReviewed
 *       }
 *     }
 *   }
 *
 * @returns {{ files: object, tools: object }}
 */
function loadIntakeState() {
    if (!fs.existsSync(INTAKE_STATE_PATH)) {
        return { files: {}, tools: {} };
    }
    try {
        return JSON.parse(fs.readFileSync(INTAKE_STATE_PATH, 'utf8'));
    } catch {
        return { files: {}, tools: {} };
    }
}

/**
 * Persist the intake state to disk.
 *
 * @param {{ files: object, tools: object }} state
 */
function saveIntakeState(state) {
    fs.writeFileSync(INTAKE_STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
}

/**
 * Update (or create) a file entry in the intake state and save immediately.
 *
 * @param {string} filePath  Storage-root-relative path (e.g. 'threshold/file.txt')
 * @param {object} updates   Fields to merge into the entry
 * @returns {object}         The updated entry
 */
function upsertIntakeFile(filePath, updates) {
    const state = loadIntakeState();
    const key   = filePath.replace(/\\/g, '/');
    const now   = new Date().toISOString();
    state.files[key] = Object.assign(
        { path: key },
        state.files[key] || {},
        updates,
        { lastReviewed: now },
    );
    saveIntakeState(state);
    return state.files[key];
}

/**
 * Update (or create) a tool entry in the intake state and save immediately.
 *
 * @param {string} toolId
 * @param {object} updates
 * @returns {object}       The updated entry
 */
function upsertIntakeTool(toolId, updates) {
    const state = loadIntakeState();
    const now   = new Date().toISOString();
    state.tools[toolId] = Object.assign(
        { id: toolId },
        state.tools[toolId] || {},
        updates,
        { lastReviewed: now },
    );
    saveIntakeState(state);
    return state.tools[toolId];
}

/**
 * Load the tool registry from disk.
 * Returns a default empty registry if the file does not exist.
 *
 * @returns {{ tools: object[], active: object }}
 */
function loadToolRegistry() {
    if (!fs.existsSync(TOOLS_REGISTRY_PATH)) {
        return { tools: [], active: {} };
    }
    try {
        return JSON.parse(fs.readFileSync(TOOLS_REGISTRY_PATH, 'utf8'));
    } catch {
        return { tools: [], active: {} };
    }
}

/**
 * Persist the tool registry to disk.
 *
 * @param {{ tools: object[], active: object }} registry
 */
function saveToolRegistry(registry) {
    fs.writeFileSync(TOOLS_REGISTRY_PATH, JSON.stringify(registry, null, 2), 'utf8');
}

/**
 * Merge a freshly discovered list of tools into the registry.
 *
 * Rules:
 *   - New tools (id not in registry) are added with trusted=false.
 *   - Existing tools keep their trust status, role, and active selection.
 *   - lastSeen is updated for all detected tools.
 *   - Tools no longer detected are kept with status='not_detected'.
 *
 * @param {object[]} detected  Array of tool records from discoverTools()
 * @returns {object[]}         Merged tools list
 */
function mergeDetectedTools(detected) {
    const registry = loadToolRegistry();
    const byId     = {};
    registry.tools.forEach(t => { byId[t.id] = t; });

    const now = new Date().toISOString();

    // Update or insert detected tools
    detected.forEach(d => {
        if (byId[d.id]) {
            // Preserve trust, role, and description; update detection fields
            byId[d.id].status   = d.status;
            byId[d.id].running  = (d.running === true);
            byId[d.id].lastSeen = d.status === 'detected' ? now : byId[d.id].lastSeen;
            // Update endpoint in case it changed
            if (d.endpoint !== undefined) byId[d.id].endpoint = d.endpoint;
        } else {
            // New tool — untrusted by default
            byId[d.id] = {
                ...d,
                trusted:  false,
                role:     null,
                running:  (d.running === true),
                lastSeen: d.status === 'detected' ? now : null,
            };
        }
    });

    // Mark tools that are no longer detected
    const detectedIds = new Set(detected.map(d => d.id));
    Object.values(byId).forEach(t => {
        if (!detectedIds.has(t.id)) {
            t.status  = 'not_detected';
            t.running = false;
        }
    });

    const merged = Object.values(byId);
    saveToolRegistry({ tools: merged, active: registry.active });
    return merged;
}

/**
 * Return the active Heart's chat URL and model name, falling back to the
 * built-in Ollama defaults when no Heart is assigned or the assigned tool
 * is unavailable.
 *
 * @returns {{ chatUrl: string, model: string, toolId: string|null }}
 */
function resolveActiveHeart() {
    const registry = loadToolRegistry();
    const heartId  = registry.active && registry.active.heart;
    if (heartId) {
        const tool = (registry.tools || []).find(t => t.id === heartId && t.trusted);
        if (tool && tool.interface === 'http' && tool.endpoint) {
            return {
                chatUrl: tool.endpoint.replace(/\/$/, '') + '/api/chat',
                model:   MODEL,
                toolId:  tool.id,
            };
        }
    }
    return { chatUrl: OLLAMA_CHAT_URL, model: MODEL, toolId: null };
}

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(express.json({ limit: '10mb' }));

// ── Phase 2: original chat endpoint (kept for backward compatibility) ─────────
// This endpoint bypasses retrieval and goes directly to Ollama.
// New code should use POST /api/chat which routes through the active Heart tool
// with grounded retrieval.  Kept to avoid breaking any existing integrations.

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

        // Resolve which Heart tool to use (falls back to built-in Ollama)
        const heart = resolveActiveHeart();

        const payload = {
            model:    heart.model,
            stream:   false,
            messages: [
                { role: 'system', content: HEART_SYSTEM_PROMPT },
                { role: 'user',   content: userContent },
            ],
        };

        const response = await axios.post(heart.chatUrl, payload);
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
        const roomDir = path.join(DATA_ROOT, room);
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
                const newRoomDir = path.join(DATA_ROOT, targetRoom);

                if (!fs.existsSync(newRoomDir)) {
                    fs.mkdirSync(newRoomDir, { recursive: true });
                }

                const newAbsPath = path.join(newRoomDir, path.basename(source.path));
                // Storage-root-relative new path (e.g. 'hearth/file.md')
                const newRelPath = path.relative(DATA_ROOT, newAbsPath).replace(/\\/g, '/');

                // Only move files that live inside the data root
                const dataRoot = path.resolve(DATA_ROOT);
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
        const hearthDir  = path.join(DATA_ROOT, 'hearth');
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

        const workshopDir = path.join(DATA_ROOT, 'workshop');
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
    const workshopDir = path.join(DATA_ROOT, 'workshop');
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
 * Augments each file record with its persistent intake state.
 */
app.get('/api/threshold/list', readLimiter, (req, res) => {
    const thresholdDir = path.join(DATA_ROOT, 'threshold');
    if (!fs.existsSync(thresholdDir)) return res.json({ files: [] });

    const manifests   = loadManifests();
    const intakeState = loadIntakeState();

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

    // Include any disk files not yet in manifests
    const manifestFiles = new Set(fromManifests.map(f => f.filename));
    const SUPPORTED_EXTS = new Set(['.txt', '.md', '.pdf', '.docx']);
    const extra = fs.readdirSync(thresholdDir)
        .filter(f => SUPPORTED_EXTS.has(path.extname(f).toLowerCase()) && !manifestFiles.has(f))
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

// ── Phase 6: Local file detection ────────────────────────────────────────────

const DETECT_SUPPORTED_EXTS = new Set(['.txt', '.md', '.pdf', '.docx']);
const DETECT_IGNORE_FILES   = new Set(['.gitkeep', '.DS_Store', 'Thumbs.db']);

/**
 * GET /api/detected-files
 * Scans threshold/, workshop/, and hearth/ for:
 *   - Unmanaged files: exist on disk but are not in the manifest index
 *   - Changed files:   in the manifest but mtime is newer than ingestTimestamp
 *
 * Never auto-imports, indexes, or mutates anything.
 * Returns { unmanaged: [...], changed: [...] }
 */
app.get('/api/detected-files', readLimiter, (req, res) => {
    const manifests    = loadManifests();
    const intakeState  = loadIntakeState();

    // Build lookup: storage-root-relative path → manifest record
    const byPath = {};
    Object.values(manifests).forEach(m => {
        if (m.path) byPath[m.path.replace(/\\/g, '/')] = m;
    });

    const unmanaged = [];
    const changed   = [];

    const rooms = ['threshold', 'workshop', 'hearth'];
    for (const room of rooms) {
        const roomDir = path.join(DATA_ROOT, room);
        if (!fs.existsSync(roomDir)) continue;

        let entries;
        try { entries = fs.readdirSync(roomDir, { withFileTypes: true }); }
        catch { continue; }

        for (const entry of entries) {
            if (!entry.isFile()) continue;
            if (DETECT_IGNORE_FILES.has(entry.name)) continue;
            const ext = path.extname(entry.name).toLowerCase();
            if (!DETECT_SUPPORTED_EXTS.has(ext)) continue;

            const relPath = room + '/' + entry.name;
            const absPath = path.join(roomDir, entry.name);

            let stats;
            try { stats = fs.statSync(absPath); }
            catch { continue; }

            const manifest    = byPath[relPath];
            const fileIntake  = intakeState.files && intakeState.files[relPath];
            const mtimeMs     = stats.mtime.getTime();

            if (!manifest) {
                // Unmanaged file — skip if persistently rejected and not changed since rejection
                if (fileIntake && fileIntake.state === 'rejected') {
                    const rejectedAt = new Date(fileIntake.lastReviewed).getTime();
                    if (mtimeMs <= rejectedAt + 2000) continue;
                }

                unmanaged.push({
                    filename:   entry.name,
                    path:       relPath,
                    room,
                    size:       stats.size,
                    mtime:      stats.mtime.toISOString(),
                    sourceType: ext.slice(1),
                });
            } else {
                // Only flag as changed when:
                //   1. The manifest has an ingestTimestamp (files without one were never indexed)
                //   2. The file's mtime is more than 2 seconds newer than the recorded timestamp
                // The 2-second grace window prevents false positives caused by filesystem
                // write timing differences on slower storage.
                if (!manifest.ingestTimestamp) continue;

                const ingestMs = new Date(manifest.ingestTimestamp).getTime();

                if (mtimeMs > ingestMs + 2000) {
                    // Skip if user rejected this update and file hasn't changed since rejection
                    if (fileIntake && fileIntake.state === 'rejected') {
                        const lastKnown = fileIntake.lastKnownMtime
                            ? new Date(fileIntake.lastKnownMtime).getTime()
                            : 0;
                        if (mtimeMs <= lastKnown + 2000) continue;
                    }

                    changed.push({
                        filename:        entry.name,
                        path:            relPath,
                        room,
                        sourceId:        manifest.id,
                        title:           manifest.title       || null,
                        description:     manifest.description || null,
                        shelf:           manifest.shelf       || null,
                        size:            stats.size,
                        mtime:           stats.mtime.toISOString(),
                        ingestTimestamp: manifest.ingestTimestamp,
                        sourceType:      ext.slice(1),
                    });
                }
            }
        }
    }

    res.json({ unmanaged, changed });
});

/**
 * POST /api/detected-files/import
 * Body: { filename, room, title?, description?, shelf? }
 *
 * Registers a locally-detected file that already exists on disk into the
 * manifest.  The file is NOT automatically indexed or moved.
 * User must choose to index it separately after review.
 */
app.post('/api/detected-files/import', writeLimiter, (req, res) => {
    try {
        const { filename, room, title = null, description = null, shelf = null } = req.body;

        if (!filename || typeof filename !== 'string') {
            return res.status(400).json({ error: 'filename is required' });
        }
        const validRooms = ['hearth', 'workshop', 'threshold'];
        if (!validRooms.includes(room)) {
            return res.status(400).json({ error: 'Invalid room "' + room + '"' });
        }

        const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
        const filePath = path.join(DATA_ROOT, room, safeName);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'File not found on disk: ' + safeName });
        }

        const source = buildSourceRecord({ filePath, room, title, description, shelf });
        upsertManifest(source.id, source);

        res.json({ success: true, source });
    } catch (error) {
        console.error('Error importing detected file:', error.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

/**
 * POST /api/detected-files/acknowledge
 * Body: { sourceId }
 *
 * Marks a changed file as "reviewed" by updating its ingestTimestamp to now.
 * The current indexed version is kept — no re-import occurs.
 * Also records the lastKnownMtime in the persistent intake state so the
 * file is not re-surfaced until it changes again.
 */
app.post('/api/detected-files/acknowledge', writeLimiter, (req, res) => {
    try {
        const { sourceId } = req.body;
        if (!sourceId || typeof sourceId !== 'string') {
            return res.status(400).json({ error: 'sourceId is required' });
        }

        const manifests = loadManifests();
        const source    = manifests[sourceId];
        if (!source) {
            return res.status(404).json({ error: 'Source not found in manifest' });
        }

        const now = new Date().toISOString();
        source.ingestTimestamp = now;
        upsertManifest(sourceId, source);

        // Persist lastKnownMtime so the file is not flagged as changed again
        // until it is actually modified after this point.
        if (source.path) {
            const absPath = resolveSourcePath(source.path);
            let mtime = now;
            if (absPath && fs.existsSync(absPath)) {
                try { mtime = fs.statSync(absPath).mtime.toISOString(); }
                catch { /* fall back to now */ }
            }
            upsertIntakeFile(source.path, {
                state:          'inspected',
                lastKnownMtime: mtime,
            });
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Error acknowledging file change:', error.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
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

// ── Phase 7: Tool Registry API ────────────────────────────────────────────────

/**
 * GET /api/tools
 * Returns all tools in the registry with their current status.
 * Augments each tool record with its persistent intake state (if any).
 */
app.get('/api/tools', readLimiter, (req, res) => {
    const registry    = loadToolRegistry();
    const intakeState = loadIntakeState();
    const tools = (registry.tools || []).map(t => {
        const intake = (intakeState.tools && intakeState.tools[t.id]) || null;
        return Object.assign({}, t, { intake });
    });
    res.json({ tools, active: registry.active || {} });
});

/**
 * POST /api/tools/scan
 * Triggers a discovery scan and merges results into the registry.
 * New tools appear as untrusted (status: 'detected', trusted: false).
 * Does NOT auto-trust anything.
 */
app.post('/api/tools/scan', writeLimiter, async (req, res) => {
    try {
        const detected = await discoverTools();
        const tools    = mergeDetectedTools(detected);
        const registry = loadToolRegistry();
        res.json({ success: true, tools, active: registry.active || {} });
    } catch (err) {
        console.error('[/api/tools/scan]', err.message);
        res.status(500).json({ error: 'Scan failed: ' + err.message });
    }
});

/**
 * POST /api/tools/:id/trust
 * Body: { trusted: boolean }
 * Marks a tool as trusted (or revokes trust).
 * Trusted tools move from Threshold → Workshop.
 * Does NOT auto-assign a role or make it the Heart.
 */
app.post('/api/tools/:id/trust', writeLimiter, (req, res) => {
    const toolId  = req.params.id;
    const trusted = req.body && typeof req.body.trusted === 'boolean' ? req.body.trusted : true;

    const registry = loadToolRegistry();
    const tool     = (registry.tools || []).find(t => t.id === toolId);
    if (!tool) return res.status(404).json({ error: 'Tool not found: ' + toolId });

    tool.trusted = trusted;
    // If trust is revoked, clear the role
    if (!trusted) {
        tool.role = null;
        // If this tool was the active Heart, clear that assignment
        if (registry.active && registry.active.heart === toolId) {
            delete registry.active.heart;
        }
    }
    saveToolRegistry(registry);
    res.json({ success: true, tool });
});

/**
 * POST /api/tools/:id/role
 * Body: { role: 'mirror' | 'forge' | null }
 * Assigns a classification role to a trusted tool.
 * Tool must be trusted before a role can be assigned.
 */
app.post('/api/tools/:id/role', writeLimiter, (req, res) => {
    const toolId = req.params.id;
    const role   = req.body && req.body.role !== undefined ? req.body.role : null;

    const VALID_ROLES = new Set(['mirror', 'forge', null]);
    if (!VALID_ROLES.has(role)) {
        return res.status(400).json({ error: 'role must be "mirror", "forge", or null' });
    }

    const registry = loadToolRegistry();
    const tool     = (registry.tools || []).find(t => t.id === toolId);
    if (!tool)         return res.status(404).json({ error: 'Tool not found: ' + toolId });
    if (!tool.trusted) return res.status(400).json({ error: 'Tool must be trusted before assigning a role.' });

    tool.role = role;
    saveToolRegistry(registry);
    res.json({ success: true, tool });
});

/**
 * GET /api/tools/active
 * Returns the current active assignments (e.g. which tool is the Heart).
 */
app.get('/api/tools/active', readLimiter, (req, res) => {
    const registry = loadToolRegistry();
    res.json({ active: registry.active || {} });
});

/**
 * POST /api/tools/active
 * Body: { heart: 'tool-id' | null }
 * Sets the active Heart.  Only one tool can be the Heart at a time.
 * Setting to null clears the Heart assignment.
 * The selected tool must be trusted.
 */
app.post('/api/tools/active', writeLimiter, (req, res) => {
    const heartId = req.body && req.body.heart !== undefined ? req.body.heart : null;

    const registry = loadToolRegistry();

    if (heartId !== null) {
        const tool = (registry.tools || []).find(t => t.id === heartId);
        if (!tool)         return res.status(404).json({ error: 'Tool not found: ' + heartId });
        if (!tool.trusted) return res.status(400).json({ error: 'Tool must be trusted before it can become the Heart.' });
    }

    if (!registry.active) registry.active = {};
    if (heartId === null) {
        delete registry.active.heart;
    } else {
        registry.active.heart = heartId;
    }
    saveToolRegistry(registry);
    res.json({ success: true, active: registry.active });
});

// ── Phase 8: Startup Checklist + Airlock + Tool Readiness ─────────────────────

/**
 * Classify a file by its extension for basic triage.
 * Returns a category string and a boolean indicating whether to flag the file.
 *
 * @param {string} filename
 * @returns {{ category: string, flag: boolean }}
 */
function triageFile(filename) {
    const ext = path.extname(filename).toLowerCase();
    const TEXT_DOCS = new Set(['.txt', '.md', '.pdf', '.docx', '.doc', '.odt', '.rtf', '.csv']);
    const ARCHIVES  = new Set(['.zip', '.tar', '.gz', '.bz2', '.7z', '.rar', '.tgz']);
    const SCRIPTS   = new Set(['.sh', '.bat', '.cmd', '.ps1', '.bash', '.zsh', '.fish', '.py', '.js', '.rb', '.pl']);
    const BINARIES  = new Set(['.exe', '.dll', '.so', '.dylib', '.bin', '.app', '.deb', '.rpm']);

    if (TEXT_DOCS.has(ext))  return { category: 'document', flag: false };
    if (ARCHIVES.has(ext))   return { category: 'archive',  flag: true  };
    if (SCRIPTS.has(ext))    return { category: 'script',   flag: true  };
    if (BINARIES.has(ext))   return { category: 'binary',   flag: true  };
    return { category: 'unknown', flag: true };
}

/**
 * Collect changed files by comparing mtime against ingestTimestamp.
 * Extracted as a helper so it can be reused by the startup check.
 *
 * @param {object} manifests
 * @returns {{ changed: object[] }}
 */
function getChangedFilesSummary(manifests) {
    const byPath = {};
    Object.values(manifests).forEach(m => {
        if (m.path) byPath[m.path.replace(/\\/g, '/')] = m;
    });

    const changed = [];

    for (const room of ['threshold', 'workshop', 'hearth']) {
        const roomDir = path.join(DATA_ROOT, room);
        if (!fs.existsSync(roomDir)) continue;

        let entries;
        try { entries = fs.readdirSync(roomDir, { withFileTypes: true }); }
        catch { continue; }

        for (const entry of entries) {
            if (!entry.isFile()) continue;
            if (DETECT_IGNORE_FILES.has(entry.name)) continue;
            const ext = path.extname(entry.name).toLowerCase();
            if (!DETECT_SUPPORTED_EXTS.has(ext)) continue;

            const relPath = room + '/' + entry.name;
            const absPath = path.join(roomDir, entry.name);
            let stats;
            try { stats = fs.statSync(absPath); }
            catch { continue; }

            const manifest = byPath[relPath];
            if (!manifest || !manifest.ingestTimestamp) continue;

            const ingestMs = new Date(manifest.ingestTimestamp).getTime();
            const mtimeMs  = stats.mtime.getTime();
            if (mtimeMs > ingestMs + 2000) {
                changed.push({ filename: entry.name, path: relPath, room, sourceId: manifest.id });
            }
        }
    }

    return { changed };
}

/**
 * GET /api/startup-check
 * Returns a structured summary of the system state for the launch banner.
 */
app.get('/api/startup-check', readLimiter, (req, res) => {
    const manifests = loadManifests();
    const registry  = loadToolRegistry();

    // File counts — Threshold intake states
    const allSources   = Object.values(manifests);
    const thFiles      = allSources.filter(m => m.room === 'threshold');
    const waitingFiles = thFiles.filter(m => !m.status || m.status === 'waiting').length;
    const flaggedFiles = thFiles.filter(m => m.status === 'flagged').length;

    // Changed files
    const { changed } = getChangedFilesSummary(manifests);
    const changedFiles = changed.length;

    // Tool counts
    const tools       = registry.tools || [];
    const trustedTools = tools.filter(t => t.trusted).length;
    const runningTools = tools.filter(t => t.running === true).length;
    const offlineTools = tools.filter(t => t.trusted && t.running === false).length;
    const newTools     = tools.filter(t => t.status === 'detected' && !t.trusted).length;

    // Active Heart
    const heartId              = registry.active && registry.active.heart;
    const heartTool            = heartId ? tools.find(t => t.id === heartId) : null;
    const activeHeartAvailable = heartTool ? (heartTool.running === true) : false;

    // Migration state
    const migrationState = MIGRATION_RESULT.performed ? 'migrated' : 'none';

    // Warnings
    const warnings = [];
    if (heartId && heartTool && !activeHeartAvailable) {
        warnings.push('Active Heart "' + (heartTool.name || heartId) + '" is offline');
    }
    if (tools.length > 0 && runningTools === 0) {
        warnings.push('No running tools detected');
    }

    res.json({
        waitingFiles,
        changedFiles,
        flaggedFiles,
        newTools,
        trustedTools,
        runningTools,
        offlineTools,
        activeHeart:           heartId || null,
        activeHeartAvailable,
        migrationState,
        warnings,
        lastScan:              new Date().toISOString(),
    });
});

/**
 * POST /api/sources/:id/flag
 * Body: { flagged: boolean }  (default true)
 * Sets or clears the 'flagged' status on a source manifest record.
 */
app.post('/api/sources/:id/flag', writeLimiter, (req, res) => {
    const { id }               = req.params;
    const { flagged = true }   = req.body || {};

    const manifests = loadManifests();
    const source    = manifests[id];
    if (!source) return res.status(404).json({ error: 'Source not found' });

    // Preserve non-waiting statuses (indexed, remembered) — only toggle on waiting/flagged
    const currentStatus = source.status || 'waiting';
    if (flagged) {
        source.status = 'flagged';
    } else {
        // Unflag: revert to waiting unless the file has moved rooms
        source.status = currentStatus === 'flagged' ? 'waiting' : currentStatus;
    }
    upsertManifest(id, source);
    res.json({ success: true, source });
});

/**
 * POST /api/tools/:id/launch
 * Attempt to start a known local tool.  Only ollama-local is supported.
 * Never runs silently — always user-initiated, no privilege escalation.
 */
app.post('/api/tools/:id/launch', writeLimiter, async (req, res) => {
    const toolId = req.params.id;

    const registry = loadToolRegistry();
    const tool     = (registry.tools || []).find(t => t.id === toolId);
    if (!tool) return res.status(404).json({ error: 'Tool not found: ' + toolId });

    // Only Ollama launch is supported at this time
    if (toolId !== 'ollama-local') {
        return res.status(400).json({
            error: 'Launch is only supported for ollama-local at this time.',
        });
    }

    // Check if already running
    const preProbe = await httpProbe(tool.endpoint + '/api/tags');
    if (preProbe.ok) {
        tool.running  = true;
        tool.lastSeen = new Date().toISOString();
        saveToolRegistry(registry);
        return res.json({ success: true, status: 'already_running', message: 'Ollama is already running.' });
    }

    // Attempt to spawn `ollama serve`
    try {
        const proc = spawn('ollama', ['serve'], { detached: true, stdio: 'ignore' });
        // Absorb spawn errors so they don't become unhandled events;
        // we detect Ollama availability via the HTTP probe below.
        proc.on('error', () => {});
        proc.unref();
    } catch (err) {
        return res.json({
            success: false,
            status:  'error',
            message: 'Could not start Ollama: ' + err.message + '. Try: ollama serve',
        });
    }

    // Re-probe after a short delay
    await new Promise(r => setTimeout(r, 2500));
    const postProbe = await httpProbe(tool.endpoint + '/api/tags');

    if (postProbe.ok) {
        tool.running  = true;
        tool.lastSeen = new Date().toISOString();
        saveToolRegistry(registry);
        return res.json({ success: true, status: 'launched', message: 'Ollama started successfully.' });
    }

    return res.json({
        success: false,
        status:  'launch_failed',
        message: 'Ollama was launched but did not respond in time. Try: ollama serve',
    });
});


// ── Phase 8.5: Intake State API ───────────────────────────────────────────────

/**
 * GET /api/intake-state
 * Returns the full persistent intake state (files and tools).
 */
app.get('/api/intake-state', readLimiter, (req, res) => {
    res.json(loadIntakeState());
});

/**
 * POST /api/sources/:id/inspect
 * Marks a source as inspected in the persistent intake state.
 * The file remains in the Threshold queue but is noted as seen.
 */
app.post('/api/sources/:id/inspect', writeLimiter, (req, res) => {
    const { id }    = req.params;
    const manifests = loadManifests();
    const source    = manifests[id];
    if (!source) return res.status(404).json({ error: 'Source not found' });

    const filePath = source.path;
    if (!filePath) return res.status(400).json({ error: 'Source has no stored path' });

    const entry = upsertIntakeFile(filePath, { state: 'inspected' });
    res.json({ success: true, intake: entry });
});

/**
 * POST /api/sources/:id/reject
 * Persistently rejects a source.
 *
 * The source is removed from the active intake queue and will not be
 * surfaced again unless the file changes on disk after this rejection.
 * Body: { notes? }  (optional note stored with the rejection)
 */
app.post('/api/sources/:id/reject', writeLimiter, (req, res) => {
    const { id }              = req.params;
    const { notes = null }    = req.body || {};
    const manifests           = loadManifests();
    const source              = manifests[id];
    if (!source) return res.status(404).json({ error: 'Source not found' });

    const filePath = source.path;
    if (!filePath) return res.status(400).json({ error: 'Source has no stored path' });

    // Record the file's current mtime so we can detect future changes
    const absPath = resolveSourcePath(filePath);
    let lastKnownMtime = null;
    if (absPath && fs.existsSync(absPath)) {
        try { lastKnownMtime = fs.statSync(absPath).mtime.toISOString(); }
        catch { /* ignore */ }
    }

    const entry = upsertIntakeFile(filePath, {
        state:          'rejected',
        lastKnownMtime,
        notes:          notes || undefined,
    });

    // Also reflect rejection in manifest status
    source.status = 'rejected';
    upsertManifest(id, source);

    res.json({ success: true, intake: entry });
});

/**
 * POST /api/tools/:id/inspect
 * Marks a tool as inspected in the persistent intake state.
 */
app.post('/api/tools/:id/inspect', writeLimiter, (req, res) => {
    const toolId   = req.params.id;
    const registry = loadToolRegistry();
    const tool     = (registry.tools || []).find(t => t.id === toolId);
    if (!tool) return res.status(404).json({ error: 'Tool not found: ' + toolId });

    const entry = upsertIntakeTool(toolId, { state: 'inspected' });
    res.json({ success: true, intake: entry });
});

/**
 * POST /api/tools/:id/reject
 * Persistently rejects a tool from the intake queue.
 *
 * The tool remains in the registry but is removed from the Threshold AI list.
 * It will resurface only if the tool's detection state changes.
 * Body: { notes? }
 */
app.post('/api/tools/:id/reject', writeLimiter, (req, res) => {
    const toolId           = req.params.id;
    const { notes = null } = req.body || {};
    const registry         = loadToolRegistry();
    const tool             = (registry.tools || []).find(t => t.id === toolId);
    if (!tool) return res.status(404).json({ error: 'Tool not found: ' + toolId });

    const entry = upsertIntakeTool(toolId, {
        state: 'rejected',
        notes: notes || undefined,
    });
    res.json({ success: true, intake: entry });
});


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

    // Phase 7: Non-blocking startup tool scan
    discoverTools().then(function(detected) {
        const tools = mergeDetectedTools(detected);
        const newTools = tools.filter(t => t.status === 'detected');
        if (newTools.length > 0) {
            console.log('[tools] Detected ' + newTools.length + ' tool(s): ' + newTools.map(t => t.name).join(', '));
        }
    }).catch(function(err) {
        console.warn('[tools] Startup scan failed:', err.message);
    });

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
    loadToolRegistry,
    saveToolRegistry,
    loadIntakeState,
    saveIntakeState,
    upsertIntakeFile,
    upsertIntakeTool,
    resolveActiveHeart,
    triageFile,
};
