# Ember Node v.ᚠ

A local-first sovereign AI console descended from the Green Fire Archive.

Ember Node is a recursive refinement engine — a personal workstation built around local
models, local knowledge, local memory discipline, explicit user control, modular
caches, and offline resilience.

The AI inside the system is called **The Heart** — a grounded resident intelligence that
answers from remembered local knowledge, not just the base model.

Current room language is Hearth, Ember Council, Threshold, and Archive, with caches as portable memory bundles.

---

## Architecture: Shell over a User-Owned Archive

Ember Node is designed as a **shell over a user-owned archive**, not an app folder
that owns the data.

This means:

- **App code** and **user data** live in entirely separate locations.
- The user archive (rooms, threads, drafts, indexes, user caches) lives in an
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

### 3. Cache Ownership Clarity

Caches are now explicitly classified:

| Class | Location | Ownership |
|-------|----------|-----------|
| **Bundled** | `caches/` inside the app folder | App-owned. May change on update. |
| **User** | `<data-root>/caches/` | User-owned. Travels with the archive. |

- `GET /caches` returns bundled caches, each with `ownership: "bundled"`.
- `GET /api/user-caches` / `POST /api/user-caches` manage user-owned caches.
- `GET /api/status` and `GET /api/storage-info` report a cache breakdown
  (`bundled` count and `user` count).

### 4. Machine-to-Machine Portability

To move an Ember Node archive to a new machine:

1. Copy the data root directory (`~/.ember-node` or wherever `EMBER_DATA_ROOT` points)
   to the new machine.
2. Install Ember Node there.
3. Set `EMBER_DATA_ROOT` to the copied directory path.
4. Start the server.

Rooms, threads, drafts, indexes, and user caches resume intact.
Bundled caches come from the new app install (they are not user data).

---

## Phase 6 — Mobility Layer (Operational Completion)

Phase 6 completes the practical mobility layer, making Ember Node a real working local
workspace rather than a static retrieval viewer.

### What changed

**Indexed sources are now actionable.**  Every source card in Ember Council and
Hearth → Archive now exposes an action row with:

- **Inspect** — opens the Source Inspector panel
- **▾ Actions** dropdown:
  - *Remember to Hearth* — promotes an Ember Council/Threshold source to Hearth
  - *→ Hearth Chat* — attaches the source as active reference context for the chat
  - *→ Council Drafts* — inserts a labeled reference block into Council Drafts

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
- Quick action buttons: Remember, Send to Chat/Notepad

**Sources can be sent to Hearth Chat.**  Attaching a source to Hearth Chat adds it to
an active-references bar above the input.  These source IDs are passed to `/api/chat`
as `sourceIds`, which pins their chunks into the grounded retrieval context even if
not semantically top-ranked.

**Sources can be sent to Notepad.**  Inserts a labeled reference block (title, ID, room)
into the Council Drafts textarea.  Appends — does not overwrite existing content.

**Archive items are usable references.**  Hearth → Archive items are rendered with the
same action row as Ember Council indexed items (minus Remember, since they are already Hearth
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
- **Room-aware retrieval** — Hearth sources are prioritised over Ember Council; Threshold excluded by default
- **Grounded Heart responses** — The Heart answers from local remembered sources
- **Signal Trace** — compact trace includes Active archetype, Route, Context, Model, and Provider
- **Cache indexing** — caches can be indexed from Ember Council; their docs/ become retrievable knowledge
- **Ember Council notes** — draft text can be saved as local Markdown and optionally indexed
- **Threshold file intake** — drag-and-drop `.md`/`.txt`/`.json`/`.pdf` import into `threshold/inbox/`
- **Green Fire Reader** — unified reading surface for Archive and Threshold files with source labeling

---

## The Three Primary Rooms

| Room | Rune | Purpose |
|------|------|---------|
| Hearth | ᚺ | Reflection and remembered signal — grounded Heart chat with Signal Trace |
| Ember Council | ᚹ | Archetypal perspectives for shaping, testing, and refining the signal (notes, projects, documents, source management) |
| Threshold | ᚦ | Boundary of exchange — file intake, staging, inspection before Hearth access |

Caches live inside Ember Council. System identity lives inside Hearth.
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

## Phase 13 — Windows Installer + Launcher + First-Run Setup

### Installer (NSIS)

Windows installer assets now live at:

- `installer/windows/Ember-Node-Installer.nsi`
- `installer/windows/Awaken-Ember-Node-Installed.bat`

Build the installer on Windows (with NSIS installed):

```bash
npm run installer:windows
```

This produces `Ember-Node-Setup.exe`, which installs Ember Node by default to:

- `%LOCALAPPDATA%\Programs\Ember Node\` (user-selectable in installer)

The installer creates:

- Desktop shortcut: **Awaken Ember Node**
- Start Menu launcher: **Awaken Ember Node**
- Shortcut icon: `installer/assets/ember-node-icon.ico` (generated from glyph PNG)

Icon source files:

- `installer/assets/ember-node-icon.png`
- `installer/assets/ember-node-icon.ico`

Regenerate `.ico` from `.png`:

```bash
npm run installer:icon
```

### Installed Launcher Behavior

The installed launcher (`Awaken-Ember-Node.bat`) supports one-click startup:

1. Resolves the external data root (`EMBER_NODE_DATA_ROOT`, fallback: `%USERPROFILE%\Documents\Ember-Node-Data`).
2. Performs first-run setup signaling without overwriting existing data.
3. Installs runtime dependencies (`npm install --omit=dev`) if `node_modules` is missing.
4. Optionally starts Ollama when installed and not already running.
5. Offers a first-run Ollama download assist if Ollama is not detected.
6. Starts Ember Node only when not already running, then opens `http://localhost:3477`.

User data remains outside the app install directory and is preserved across reinstalls/updates.

#### Requirements
- [Node.js](https://nodejs.org/) 18+ installed and on the system PATH.
- `npm` available (comes with Node.js).
- Ollama is **optional** — the launcher works without it and will note its absence.

Node.js is required to run Ember Node in this version. Future versions will bundle
the runtime. If Node.js is not detected, install from:
https://nodejs.org

---

## Runtime and Release Builds

The source repo does not include the portable Node.js runtime.
For public installer builds, place the portable Node.js Windows runtime into runtime/node/ before packaging.
The installer should include runtime/node/ in the final artifact.
User data is stored separately in Documents/Ember-Node-Data and is preserved across app updates.

---

### Portable Launcher (Repository Checkout)

For development checkouts, the root `Awaken-Ember-Node.bat` remains available for manual local launch.

---

## Architecture Principles

- local-first sovereignty
- no silent actions
- memory must be earned
- imports land in Threshold first
- nothing writes to Hearth automatically
- network is an expedition, not a dependency
- chat is a pane, not the whole room
- caches are knowledge packs, indexed intentionally
- all AI-generated changes require user review before being remembered
- remembered works fuel future creation
- retrieval must remain transparent — Signal Trace shows all sources
- the node is a forge, not a filing cabinet
- the app is a shell; the archive belongs to the user

---

## Cache System

Caches are modular knowledge packs.

### Bundled caches

Shipped with the app code in `./caches/`.  These are starter reference packs and
built-in seeds.  They may be updated or replaced when the app is updated.  They live
inside the app folder and are **not** part of the user archive.

```
caches/
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

### User caches

Created, edited, or imported by the user.  Stored in `<data-root>/caches/` as JSON
files.  These travel with the archive and survive app updates.

Use `POST /api/user-caches` to create one.
Use `GET /api/user-caches` to list them.

---

## Data Root

Ember Node keeps **app code** and **user data** in separate locations.

### Default location

| Platform | Default path |
|----------|-------------|
| Linux / macOS | `~/.ember-node` |
| Windows | `%USERPROFILE%\\Documents\\Ember-Node-Data` |

### Custom location

Set `EMBER_NODE_DATA_ROOT` to any absolute path before starting the server
(`EMBER_DATA_ROOT` is still supported for backward compatibility):

```bash
# Unix
EMBER_NODE_DATA_ROOT=/my/custom/data npm start

# Windows PowerShell
$env:EMBER_NODE_DATA_ROOT = "D:\EmberData"; npm start
```

On first run, Ember Node creates the full directory tree automatically.

### Layout

```
<data-root>/
  system/
    forge/          — Forge identity layer (archetypes, forge-core.json)
    bootstrap/      — Active bootstrap state
    memory/
      rolling-bootstrap.json — Rolling Bootstrap continuity summary
    config/         — System configuration
    prompts/        — System prompts
    tools/          — AI runtime registry state
  archive/
    core/           — Default trusted archive (Green Fire Core)
      codices/      — Green Fire Codices
      grimoires/    — Green Fire Grimoires
      sagas/        — Green Fire Sagas
      reference/    — Reference materials
      manifest.json — Core archive manifest (id, version, trusted, auto_load)
    caches/         — Downloadable archive expansions (one sub-dir per cache)
    caches/     — Modular functional/content modules (one sub-dir each)
  hearth/           — Curated Hearth sources (remembered knowledge)
    remembered-threads/
    maps/
  workshop/         — Ember Council notes and active drafts
    documents/
    notes/
    drafts/
    maps/
  threshold/        — Quarantined imports awaiting inspection
    waiting/
    changed/
    flagged/
    maps/
  projects/         — Ember Council project files
  threads/          — Chat thread records (partitioned by room)
    hearth/
    workshop/
    threshold/
  indexes/          — Local knowledge index (chunks, embeddings, manifests)
  caches/       — User-created cache metadata
  exports/          — Outbound packages
```

Note: the internal storage folder remains `workshop/` for backward compatibility with existing data and routes, while the visible UI name is **Ember Council**.

### Content Layer Distinctions

| Layer | Path | Role |
|-------|------|------|
| **System identity** | `system/forge/` | Forge archetype and identity files. Not archive content. |
| **Rolling Bootstrap** | `system/memory/rolling-bootstrap.json` | Evolving continuity summary (active themes, projects, open questions, decisions, archetype notes). |
| **Core trusted archive** | `archive/core/` | Default knowledge body for every new node. Trusted, archive-native, bypasses Threshold by default. |
| **Archive caches** | `archive/caches/` | Future downloadable archive expansions. Each cache is a self-contained sub-directory with its own `manifest.json`. Use the term *cache* / *caches* — not *pack* / *packs*. |
| **Archive caches** | `archive/caches/` | Future modular functional or content modules. Distinct from caches — may contain documents, prompts, assets, or specialised node modules. |

### Memory Layer Clarification

- **Archive Memory** — enduring source material under `archive/core/`, `archive/caches/`, and mirror-derived archive assets.
- **Rolling Bootstrap** — compact continuity memory that preserves unfolding context across sessions.
- **Signal Threads** — reserved future layer for saved conversations, research paths, and work trails.
- **Threshold** — intake + inspection boundary for outside materials.
- **Ember Council** — archetypal interpretation and active crafting context.

The data root is entirely user-owned. Updating or reinstalling Ember Node never touches it.
Use `GET /api/storage-info` to confirm which data root is active and see migration status.

### Safe reset guidance (manual only)

For a clean restart, users may manually clear chats/projects/drafts while preserving core memory paths.

Preserve:
- `Ember-Node-Data/archive/core/`
- `Ember-Node-Data/archive/caches/`
- `Ember-Node-Data/indexes/`
- `Ember-Node-Data/system/config/`

Optional clear (if present):
- `Ember-Node-Data/chats/`
- `Ember-Node-Data/threads/`
- `Ember-Node-Data/threshold/inbox/`
- `Ember-Node-Data/drafts/`
- `Ember-Node-Data/logs/`

No automatic deletion is performed by Ember Node.

### Signal Threads (reserved)

Signal Threads is a reserved term for future saved chats, research paths, saved works, and persistent lines of thought.
It is not implemented in the current runtime.

---

## API Endpoints

### Phase 2 (preserved)
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/chat` | Forward message to Ollama (backward-compatible) |
| `GET`  | `/caches` | List all bundled caches |
| `GET`  | `/caches/:name` | Inspect a bundled cache's manifest and content |

### Phase 3 (new)
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/chat` | Grounded chat — returns `{ answer, sources, grounded }`; accepts optional `sourceIds` to pin sources |
| `POST` | `/api/ingest` | Ingest a file into a room |
| `POST` | `/api/index/cache/:id` | Index all docs in a bundled cache |
| `POST` | `/api/index/file` | Index / re-index a file; pass `targetRoom` to transfer rooms |
| `GET`  | `/api/sources` | List indexed source manifests |
| `GET`  | `/api/sources/:id` | Get single source manifest + preview (Phase 6) |
| `POST` | `/api/sources/:id/exclude` | Toggle source exclusion from retrieval |
| `POST` | `/api/sources/:id/remember` | Promote source to Hearth — copies file and re-indexes (Phase 6) |
| `POST` | `/api/notes` | Save an Ember Council note (deterministic filename; creates manifest entry) |
| `GET`  | `/api/notes` | List Ember Council notes |
| `GET`  | `/api/threshold/list` | List Threshold intake queue files (legacy compatibility) |
| `POST` | `/api/threshold/import` | Import uploaded files into `threshold/inbox/` |
| `GET`  | `/api/threshold/files` | List imported Threshold inbox files |
| `GET`  | `/api/threshold/files/content` | Read a Threshold inbox file for Green Fire Reader |
| `DELETE` | `/api/threshold/files` | Delete a Threshold inbox file |
| `GET`  | `/api/status` | System status (chunks, sources, embeddings, storage root, cache breakdown) |
| `GET`  | `/api/storage-info` | Active data root, directory layout, migration state, cache counts |

### Phase 4 (new)
| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/threads` | List chat threads |
| `POST` | `/api/threads` | Create a new chat thread |
| `GET`  | `/api/threads/:id` | Get thread with messages |
| `POST` | `/api/threads/:id/messages` | Add message to thread |
| `GET`  | `/api/projects` | List Ember Council projects |
| `POST` | `/api/projects` | Create a project |
| `GET`  | `/api/projects/:id` | Get a project |
| `PUT`  | `/api/projects/:id` | Update a project |
| `POST` | `/api/projects/:id/sources` | Attach a source to a project (Phase 6) |
| `DELETE` | `/api/projects/:id/sources/:sourceId` | Remove a linked source from a project (Phase 6) |
| `GET`  | `/api/user-caches` | List user-owned caches |
| `POST` | `/api/user-caches` | Create a user cache |

### Phase 7 (new)
| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/tools`                   | List all AI runtimes in the registry |
| `POST` | `/api/tools/scan`              | Trigger a discovery scan |
| `POST` | `/api/tools/:id/trust`         | Trust or revoke an AI runtime |
| `POST` | `/api/tools/:id/role`          | Assign a role (mirror / forge) |
| `GET`  | `/api/tools/active`            | Get current Heart assignment |
| `POST` | `/api/tools/active`            | Set the active Heart |
| `POST` | `/api/tools/:id/launch`        | Attempt to start Ollama (ollama-local only) |

### Phase 8 / 8.5 (new)
| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/startup-check`               | Launch summary: intake counts, tool state, Heart status |
| `POST` | `/api/sources/:id/flag`            | Flag or unflag a Threshold source |
| `GET`  | `/api/intake-state`                | Full persistent intake state (files + tools) |
| `POST` | `/api/sources/:id/inspect`         | Mark a source as inspected in intake state |
| `POST` | `/api/sources/:id/reject`          | Persistently reject a source |
| `POST` | `/api/tools/:id/inspect`           | Mark a tool as inspected |
| `POST` | `/api/tools/:id/reject`            | Persistently reject a tool |

### Phase 11 / 12 (archive + cache integration)
| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/archive` | List trusted archive sources |
| `POST` | `/api/archive/bootstrap` | Re-scan and index trusted archive files |
| `POST` | `/api/archive/ingest` | Directly ingest a file into the trusted archive |
| `GET`  | `/api/archive/caches/available` | Detect canonical Green Fire cache packages from upstream downloads index (with offline fallback) |
| `POST` | `/api/archive/caches/install` | Install a canonical cache zip (`green-fire-core` merges into `archive/core/`; others install into `archive/caches/<package-id>/`) |
| `GET`  | `/api/archive/caches/installed` | List canonical cache install state + parsed local manifests |
| `GET`  | `/api/archive/caches/updates` | Compare local cache versions against upstream versions |

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
      "cacheId": "green_fire",
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
| Phase 1 ✓ | Local Node/Express + Ollama chat + basic cache endpoints |
| Phase 2 ✓ | Green Fire UI shell + Cache Shelf + room navigation |
| Phase 3 ✓ | Document ingestion, chunking, embeddings, retrieval, signal trace |
| Phase 3.2 ✓ | Deterministic source IDs, embeddings endpoint fallback, room-transfer file moves, Ember Council notes indexing, tiered rate limiting |
| Phase 4 ✓ | Threads, projects, user caches, Threshold intake, PDF/DOCX support |
| Phase 5 ✓ | Storage stabilization: external data root, legacy migration, storage-root-native paths, cache ownership clarity, portability readiness |
| Phase 6 ✓ | Mobility layer: actionable source cards, source inspector, Remember to Hearth, Send To (Chat/Notepad/Project), project linked sources, path visibility, cross-room reference flow |
| Phase 7 ✓ | AI runtime discovery, trust flow, role assignment, Heart selection, runtime registry |
| Phase 8 ✓ | Startup checklist, airlock discipline, AI setup readiness, changed-file detection |
| Phase 8.5 ✓ | Intake persistence, durable reject, changed-file flow, AI setup polish |
| Phase 8.75 ✓ | Cleanup pass: redundancy removal, DATA_DIR alias eliminated, path consolidation, duplicate constant consolidation, documentation update |
| Phase 8.95 ✓ | Backend modularization: `server.js` reduced to ~140 lines; routes split by domain into `app/routes/`; intake state extracted to `app/intakeState.js`; startup summary to `app/startupCheck.js`; tool registry to `app/toolRegistry.js` |
| Phase 10 ✓ | Launcher + local install experience: `Awaken-Ember-Node.bat` one-click launcher, optional Ollama auto-start, startup ritual banner, no-Heart setup guide, desktop shortcut docs, future installer groundwork |

---

## Backend Structure (Phase 8.95+)

`app/server.js` is now a **bootstrap-only** file (~140 lines).  It sets up
Express, mounts route modules, and starts the server.  All business logic lives
in dedicated modules:

### Service modules

| Module | Responsibility |
|---|---|
| `app/intakeState.js` | Threshold intake state: load, save, upsert file/runtime entries |
| `app/toolRegistry.js` | AI runtime registry: load, save, merge discovered runtimes, resolve active Heart |
| `app/startupCheck.js` | Startup summary: triageFile, changed-file scan, launch summary generator |
| `app/rateLimiters.js` | Shared rate limiter instances (read / write / index / chat) |

### Route modules (`app/routes/`)

| Module | Routes |
|---|---|
| `startup.js` | `GET /api/startup-check` |
| `sources.js` | `/api/ingest`, `/api/index/*`, `/api/sources/*`, `/api/notes` |
| `threshold.js` | `/api/threshold/list`, `/api/threshold/import`, `/api/threshold/files*` |
| `tools.js` | `/api/tools/*` |
| `chat.js` | `POST /chat` (legacy), `POST /api/chat` |
| `projects.js` | `/api/projects/*`, `/api/user-caches`, `/caches*` |
| `threads.js` | `/api/threads/*` |
| `system.js` | `/api/status`, `/api/ollama-status`, `/api/storage-info`, `/api/intake-state` |
| `archive.js` | `/api/archive*`, `/api/archive/caches*` |

---

## Phase 3.2 Stabilization Notes

- **Room transfers physically move files.** `POST /api/index/file` with a `targetRoom`
  body param now renames/copies the file to the correct room directory, updates
  `source.path`, and persists the manifest before indexing.

- **Source IDs are deterministic.** `buildSourceRecord` derives its ID from
  `room + cacheId + normalized-relative-path` — no `Date.now()`.  Re-ingesting
  the same file always produces the same identity; duplicate records do not accumulate.

- **Embeddings endpoint fallback.** The embedding layer tries `/api/embeddings` first,
  then `/api/embed` if that fails. The first working endpoint is cached per session.
  `/api/status` exposes `embeddingsActive`, `embeddingEndpoint`, and `retrievalMode`
  (`semantic` or `keyword-fallback`).

- **Tiered rate limiting.** Endpoints are now grouped:
  - `readLimiter` (120 req/min) — GET status, notes, threshold list
  - `chatLimiter` (30 req/min) — `POST /api/chat`
  - `writeLimiter` (60 req/min) — ingest, note saving, source exclude
  - `indexLimiter` (10 req/min) — cache and file indexing

- **Ember Council notes are first-class Ember Council sources.** Each saved note registers a
  manifest entry so it can be indexed via `POST /api/index/file` and retrieved by
  Hearth as an Ember Council source.  Notes with the same title overwrite their prior file,
  keeping source identity stable.

- **Reindexing cleans up stale embeddings.** Before replacing chunks for a source,
  the embeddings for the old chunk IDs are removed.  Repeated reindex cycles do not
  accumulate stale embedding entries.
