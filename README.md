# Ember Node v.ᚠ

A local-first sovereign AI console descended from the Green Fire Archive.

Ember Node is a recursive refinement engine — a personal workstation built around local
models, local knowledge, local memory discipline, explicit user control, modular
cartridges, and offline resilience.

The AI inside the system is called **The Heart** — a grounded resident intelligence that
answers from remembered local knowledge, not just the base model.

---

## Phase 3 — Local Knowledge Engine

Phase 3 implements the first true memory-and-retrieval loop:

- **Document ingestion** — `.txt` and `.md` files enter through Threshold
- **Chunking** — documents are split into retrievable overlapping chunks
- **Embeddings** — local vector generation via Ollama (`nomic-embed-text` default)
- **Keyword fallback** — retrieval works even without an embedding model
- **Room-aware retrieval** — Hearth sources are prioritised over Workshop; Threshold excluded by default
- **Grounded Heart responses** — The Heart answers from local remembered sources
- **Signal Trace** — every response shows which sources informed the answer
- **Cartridge indexing** — cartridges can be indexed from Workshop; their docs/ become retrievable knowledge
- **Workshop notes** — draft text can be saved as local Markdown and optionally indexed
- **Threshold file intake** — drag-and-drop `.txt`/`.md` intake with inspect and index controls

---

## The Three Primary Rooms

| Room | Rune | Purpose |
|------|------|---------|
| Hearth | ᚺ | Reflection and remembered signal — grounded Heart chat with Signal Trace |
| Workshop | ᚹ | Crafting, coding, and refinement — note saving, cartridge indexing, source management |
| Threshold | ᚦ | Boundary of exchange — file intake, staging, inspection before Hearth access |

Cartridges live inside Workshop. System identity lives inside Hearth.
See [docs/architecture.md](docs/architecture.md) for the full design charter.

---

## Requirements

- [Node.js](https://nodejs.org/) 18+
- [Ollama](https://ollama.com/) running locally
- Chat model: `ollama pull gemma3:4b`
- Embedding model (optional, for vector retrieval): `ollama pull nomic-embed-text`

If the embedding model is not installed, Ember Node falls back to keyword-overlap scoring
automatically.

---

## Quick Start

```bash
npm install
npm start
```

Open [http://localhost:3477](http://localhost:3477) in your browser.

---

## Architecture Principles

- local-first sovereignty
- no silent actions
- memory must be earned
- imports land in Threshold first
- nothing writes to Hearth automatically
- network is an expedition, not a dependency
- chat is a pane, not the whole room
- cartridges are knowledge packs, indexed intentionally
- all AI-generated changes require user review before being remembered
- remembered works fuel future creation
- retrieval must remain transparent — Signal Trace shows all sources
- the node is a forge, not a filing cabinet

---

## Cartridge System

Cartridges are modular knowledge packs stored in `./cartridges/`.
Each may contain top-level `.md`/`.txt` files and a `docs/` subdirectory.

```
cartridges/
  green_fire/
    manifest.json
    README.md
    docs/
      first-codex.md
      signal-saga.md
  philosophy/
    manifest.json
    README.md
    docs/
      core-notes.md
  survival/
    manifest.json
    README.md
    docs/
      field-notes.md
  journals/
    manifest.json
    README.md
    docs/
      entry-guide.md
```

Cartridges can be indexed from the Workshop room. Once indexed, their content is
retrievable by the Heart during Hearth chat.

---

## Data Root

Ember Node keeps **app code** and **user data** in separate locations.

### Default location

| Platform | Default path |
|----------|-------------|
| Linux / macOS | `~/.ember-node` |
| Windows | `C:\Users\<you>\.ember-node` |

### Custom location

Set the `EMBER_DATA_ROOT` environment variable to any absolute path before starting the server:

```bash
# Unix
EMBER_DATA_ROOT=/my/custom/data npm start

# Windows PowerShell
$env:EMBER_DATA_ROOT = "D:\EmberData"; npm start
```

On first run, Ember Node creates the full directory tree automatically.

### Layout

```
<data-root>/
  hearth/       — curated Hearth sources (remembered knowledge)
  workshop/     — Workshop notes and active drafts
  threshold/    — quarantined imports awaiting inspection
  indexes/      — local knowledge index (chunks, embeddings, manifests)
  projects/     — Workshop project files
  threads/      — chat thread records
  cartridges/   — user-created cartridge metadata
  system/       — system state
  exports/      — outbound packages
```

The data root is entirely user-owned. Updating or reinstalling Ember Node never touches it.
Use `GET /api/storage-info` to confirm which data root is active.

---

## API Endpoints

### Phase 2 (preserved)
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/chat` | Forward message to Ollama (backward-compatible) |
| `GET`  | `/cartridges` | List all installed cartridges |
| `GET`  | `/cartridges/:name` | Inspect a cartridge's manifest and content |

### Phase 3 (new)
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/chat` | Grounded chat — returns `{ answer, sources, grounded }` |
| `POST` | `/api/ingest` | Ingest a file into a room |
| `POST` | `/api/index/cartridge/:id` | Index all docs in a cartridge |
| `POST` | `/api/index/file` | Index / re-index a file; pass `targetRoom` to transfer rooms |
| `GET`  | `/api/sources` | List indexed source manifests |
| `POST` | `/api/sources/:id/exclude` | Toggle source exclusion from retrieval |
| `POST` | `/api/notes` | Save a Workshop note (deterministic filename; creates manifest entry) |
| `GET`  | `/api/notes` | List Workshop notes |
| `GET`  | `/api/threshold/list` | List files in Threshold intake |
| `GET`  | `/api/status` | System status (chunks, sources, embeddings health, retrieval mode) |
| `GET`  | `/api/storage-info` | Active data root path and directory layout |

---

## Signal Trace

Every grounded Heart response includes a Signal Trace — a visible list of the local
sources that informed the answer:

```json
{
  "answer": "…",
  "sources": [
    {
      "room": "hearth",
      "shelf": "green_fire",
      "cartridgeId": "green_fire",
      "file": "first-codex.md",
      "chunkId": "hearth-green-fire-first-codex-md-000",
      "score": 0.87
    }
  ],
  "grounded": true
}
```

When no local sources are found, the Heart responds from the base model and the Signal
Trace indicates: *base model — no local sources*.

---

## Phase Roadmap

| Phase | Focus |
|-------|-------|
| Phase 1 ✓ | Local Node/Express + Ollama chat + basic cartridge endpoints |
| Phase 2 ✓ | Green Fire UI shell + Cartridge Shelf + room navigation |
| Phase 3 ✓ | Document ingestion, chunking, embeddings, retrieval, signal trace |
| Phase 3.2 ✓ | Deterministic source IDs, embeddings endpoint fallback, room-transfer file moves, Workshop notes indexing, tiered rate limiting |
| Phase 4   | Remember / Archive mechanics, curated Hearth writes |
| Phase 5 ✓ | Local storage root + data separation (`EMBER_DATA_ROOT`, `~/.ember-node` default, `ensureDataRoot`, `/api/storage-info`) |
| Phase 6   | Offline cartridge engine, portable export/import, desktop shell |

---

## Phase 3.2 Stabilization Notes

- **Room transfers physically move files.** `POST /api/index/file` with a `targetRoom`
  body param now renames/copies the file to the correct room directory, updates
  `source.path`, and persists the manifest before indexing.

- **Source IDs are deterministic.** `buildSourceRecord` derives its ID from
  `room + cartridgeId + normalized-relative-path` — no `Date.now()`.  Re-ingesting
  the same file always produces the same identity; duplicate records do not accumulate.

- **Embeddings endpoint fallback.** The embedding layer tries `/api/embeddings` first,
  then `/api/embed` if that fails. The first working endpoint is cached per session.
  `/api/status` exposes `embeddingsActive`, `embeddingEndpoint`, and `retrievalMode`
  (`semantic` or `keyword-fallback`).

- **Tiered rate limiting.** Endpoints are now grouped:
  - `readLimiter` (120 req/min) — GET status, notes, threshold list
  - `chatLimiter` (30 req/min) — `POST /api/chat`
  - `writeLimiter` (60 req/min) — ingest, note saving, source exclude
  - `indexLimiter` (10 req/min) — cartridge and file indexing

- **Workshop notes are first-class Workshop sources.** Each saved note registers a
  manifest entry so it can be indexed via `POST /api/index/file` and retrieved by
  Hearth as a Workshop source.  Notes with the same title overwrite their prior file,
  keeping source identity stable.

- **Reindexing cleans up stale embeddings.** Before replacing chunks for a source,
  the embeddings for the old chunk IDs are removed.  Repeated reindex cycles do not
  accumulate stale embedding entries.
