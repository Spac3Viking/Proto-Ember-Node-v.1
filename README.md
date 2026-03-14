# Ember Node v.ᚠ

A local-first sovereign AI console descended from the Green Fire Archive.

Ember Node is a recursive refinement engine — a personal workstation built around local
models, local knowledge, local memory discipline, explicit user control, modular
cartridges, and offline resilience.

The AI inside the system is called **The Heart** — a grounded resident intelligence that
answers from remembered local knowledge, not just the base model.

---

## Architecture: Shell over a User-Owned Archive

Ember Node is designed as a **shell over a user-owned archive**, not an app folder
that owns the data.

This means:

- **App code** and **user data** live in entirely separate locations.
- The user archive (rooms, threads, projects, indexes, user cartridges) lives in an
  external **data root** that belongs entirely to the user.
- Updating or reinstalling Ember Node never touches the user's data root.
- Moving an archive to a new machine is a folder copy — no special export needed.

---

## Phase 5 — Storage Stabilization

Phase 5 hardens the storage architecture with four structural improvements:

### 1. Legacy Migration

Older Ember Node versions stored data inside the app folder (`data/`).

On startup, Ember Node now detects that legacy layout and safely copies the contents
into the external data root.  Migration is:
- **copy-based** — originals are not deleted
- **non-destructive** — existing files in the data root are not overwritten
- **idempotent** — safe to run repeatedly
- **skipped automatically** if the data root already has content

Migration status is visible in `GET /api/storage-info` under the `migration` key.

### 2. Storage-Root-Native Paths

Source metadata paths are now stored **relative to the data root**, not the app folder.

Old format (removed):   `data/workshop/file.md`
New format:             `workshop/file.md`

All path reads and writes go through the data root.  No `__dirname`-based traversal
in stored records.  Legacy `data/...` paths in existing manifests are handled
transparently via a normalisation step.

### 3. Cartridge Ownership Clarity

Cartridges are now explicitly classified:

| Class | Location | Ownership |
|-------|----------|-----------|
| **Bundled** | `cartridges/` inside the app folder | App-owned. May change on update. |
| **User** | `<data-root>/cartridges/` | User-owned. Travels with the archive. |

- `GET /cartridges` returns bundled cartridges, each with `ownership: "bundled"`.
- `GET /api/user-cartridges` / `POST /api/user-cartridges` manage user-owned cartridges.
- `GET /api/status` and `GET /api/storage-info` report a cartridge breakdown
  (`bundled` count and `user` count).

### 4. Machine-to-Machine Portability

To move an Ember Node archive to a new machine:

1. Copy the data root directory (`~/.ember-node` or wherever `EMBER_DATA_ROOT` points)
   to the new machine.
2. Install Ember Node there.
3. Set `EMBER_DATA_ROOT` to the copied directory path.
4. Start the server.

Rooms, threads, projects, indexes, and user cartridges resume intact.
Bundled cartridges come from the new app install (they are not user data).

---

## Phase 6 — Mobility Layer (Operational Completion)

Phase 6 completes the practical mobility layer, making Ember Node a real working local
workspace rather than a static retrieval viewer.

### What changed

**Indexed sources are now actionable.**  Every source card in Workshop → Index and
Hearth → Archive now exposes an action row with:

- **Inspect** — opens the Source Inspector panel
- **▾ Actions** dropdown:
  - *Remember to Hearth* — promotes a Workshop/Threshold source to Hearth
  - *→ Hearth Chat* — attaches the source as active reference context for the chat
  - *→ Notepad* — inserts a labeled reference block into the Workshop Notepad
  - *→ Project* — attaches the source to a Workshop project

**Explicit Remember to Hearth is available.**  Users can explicitly promote any indexed
source to Hearth with a single action.  The source file is copied to `hearth/`, the
manifest is updated to `status: remembered`, and the source is immediately re-indexed
in the Hearth room context.  No automatic Remember behavior; this remains a conscious
user action.

**Sources can be inspected.**  The Source Inspector modal shows full metadata:
- Title, lifecycle status, room, shelf, description
- Source filename in monospace
- Collapsible *Path & Storage* section with storage-root-relative path and Source ID
- Plaintext preview excerpt (txt/md files)
- Quick action buttons: Remember, Send to Chat/Notepad/Project

**Sources can be sent to Hearth Chat.**  Attaching a source to Hearth Chat adds it to
an active-references bar above the input.  These source IDs are passed to `/api/chat`
as `sourceIds`, which pins their chunks into the grounded retrieval context even if
not semantically top-ranked.

**Sources can be sent to Notepad.**  Inserts a labeled reference block (title, ID, room)
into the Workshop Notepad textarea.  Appends — does not overwrite existing content.

**Projects support linked sources.**  Attaching a source to a project records it in
`project.linkedSources` (title, room, status, description).  The project detail panel
now shows the linked sources list with room and status badges and a remove button.

**Archive items are usable references.**  Hearth → Archive items are rendered with the
same action row as Workshop index items (minus Remember, since they are already Hearth
sources).

**Path visibility exists.**  The Source Inspector's collapsible *Path & Storage* section
exposes the storage-root-relative path and Source ID without cluttering the card itself.

### New API endpoints (Phase 6)

| Method | Path | Description |
|--------|------|-------------|
| `GET`    | `/api/sources/:id`                     | Get full source manifest + plaintext preview |
| `POST`   | `/api/sources/:id/remember`            | Promote source to Hearth (copies file, re-indexes) |
| `POST`   | `/api/projects/:id/sources`            | Attach a source to a project |
| `DELETE` | `/api/projects/:id/sources/:sourceId`  | Remove a linked source from a project |

`POST /api/chat` now accepts an optional `sourceIds` array.  Chunks from pinned sources
are prepended to the grounded retrieval context regardless of semantic score.

---



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
- the app is a shell; the archive belongs to the user

---

## Cartridge System

Cartridges are modular knowledge packs.

### Bundled cartridges

Shipped with the app code in `./cartridges/`.  These are starter reference packs and
built-in seeds.  They may be updated or replaced when the app is updated.  They live
inside the app folder and are **not** part of the user archive.

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
  journals/
```

### User cartridges

Created, edited, or imported by the user.  Stored in `<data-root>/cartridges/` as JSON
files.  These travel with the archive and survive app updates.

Use `POST /api/user-cartridges` to create one.
Use `GET /api/user-cartridges` to list them.

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
Use `GET /api/storage-info` to confirm which data root is active and see migration status.

---

## API Endpoints

### Phase 2 (preserved)
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/chat` | Forward message to Ollama (backward-compatible) |
| `GET`  | `/cartridges` | List all bundled cartridges |
| `GET`  | `/cartridges/:name` | Inspect a bundled cartridge's manifest and content |

### Phase 3 (new)
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/chat` | Grounded chat — returns `{ answer, sources, grounded }`; accepts optional `sourceIds` to pin sources |
| `POST` | `/api/ingest` | Ingest a file into a room |
| `POST` | `/api/index/cartridge/:id` | Index all docs in a bundled cartridge |
| `POST` | `/api/index/file` | Index / re-index a file; pass `targetRoom` to transfer rooms |
| `GET`  | `/api/sources` | List indexed source manifests |
| `GET`  | `/api/sources/:id` | Get single source manifest + preview (Phase 6) |
| `POST` | `/api/sources/:id/exclude` | Toggle source exclusion from retrieval |
| `POST` | `/api/sources/:id/remember` | Promote source to Hearth — copies file and re-indexes (Phase 6) |
| `POST` | `/api/notes` | Save a Workshop note (deterministic filename; creates manifest entry) |
| `GET`  | `/api/notes` | List Workshop notes |
| `GET`  | `/api/threshold/list` | List files in Threshold intake |
| `GET`  | `/api/status` | System status (chunks, sources, embeddings, storage root, cartridge breakdown) |
| `GET`  | `/api/storage-info` | Active data root, directory layout, migration state, cartridge counts |

### Phase 4 (new)
| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/threads` | List chat threads |
| `POST` | `/api/threads` | Create a new chat thread |
| `GET`  | `/api/threads/:id` | Get thread with messages |
| `POST` | `/api/threads/:id/messages` | Add message to thread |
| `GET`  | `/api/projects` | List Workshop projects |
| `POST` | `/api/projects` | Create a project |
| `GET`  | `/api/projects/:id` | Get a project |
| `PUT`  | `/api/projects/:id` | Update a project |
| `POST` | `/api/projects/:id/sources` | Attach a source to a project (Phase 6) |
| `DELETE` | `/api/projects/:id/sources/:sourceId` | Remove a linked source from a project (Phase 6) |
| `GET`  | `/api/user-cartridges` | List user-owned cartridges |
| `POST` | `/api/user-cartridges` | Create a user cartridge |

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
| Phase 4 ✓ | Threads, projects, user cartridges, Threshold intake, PDF/DOCX support |
| Phase 5 ✓ | Storage stabilization: external data root, legacy migration, storage-root-native paths, cartridge ownership clarity, portability readiness |
| Phase 6 ✓ | Mobility layer: actionable source cards, source inspector, Remember to Hearth, Send To (Chat/Notepad/Project), project linked sources, path visibility, cross-room reference flow |

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
