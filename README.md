# Ember Node v.ᚠ

A local-first human continuity instrument descended from the Green Fire Archive.

Ember Node's purpose is to help a person become more capable through
participation in reality — not more dependent on AI. AI is a companion and
instrument inside the Node, never its authority.

## Primary Architecture (Phase 20)

The Node's permanent primary architecture is three spaces:

- **SESSION** — What am I working on? (active work)
- **HEARTH** — What do I already have? (durable continuity)
- **THRESHOLD** — What is entering or leaving the Node? (intentional exchange)

Work inside Session follows a human cycle: **Observe → Reflect → Act →
Refine → Remember**. Compression is preferable to expansion: when a choice
exists between adding a new surface and folding a capability into an
existing one, folding wins.

Session → Thread → Hearth continuity is implemented. See
[`docs/PHASE_20_ARCHITECTURE.md`](docs/PHASE_20_ARCHITECTURE.md) for the
full architecture contract and compatibility boundaries.

## Historical / Advanced Systems

Council, archetypes, caches, model roles, runtime tuning, Prompt Bridges,
Forge, and Threads remain available as contextual tools reached
from within Session, Hearth, or Threshold — not additional primary
destinations. The list below documents the terminology from earlier
phases; it is historical context, not the primary map of the application:

- **🜂 Hearth** — Ember Prime continuity and remembered signal.
- **🜁 Ember Council** — Sentinel Archetypes and active refinement.
- **🜃 Archive** — installed memory and Reader surface.
- **🜄 Threshold** — intake, inspection, and runtime stewardship.
- **🜔 Threads** — canonical saved continuity lines. “Signal Thread” is the
  historical storage and API name; `/api/threads` remains legacy conversation
  compatibility.
- **Caches** — portable memory bundles.
- **Rolling Bootstrap** — unfolding continuity summary.
- **Fractal Memory Compression** — cache/document/archetype summary geometry.

Ember Node is also a **markdown-first continuity terminal**: active continuity exchange is centered on `.md`, `.txt`, copy/paste dialogue, bootstrap files, cache manifests, and README-driven handoffs.

Canonical terminology and paths are enforced: `council`, `documents/`, and manifest `documents[]`.

## Terminology Alignment

- **Installed Caches** = available local caches discovered from archive/core and archive/caches.
- **Loaded Caches** = active continuity context currently loaded for retrieval and chat.
- **Cache Loadout** = the currently loaded cache set.
- **Markdown Handoffs** = portable AI/human continuity `.md` documents.
- **Cache Drafts** = editable local cache bundles in `threshold/cache-drafts/`.
- **Continuity Bootstrap** = portable `.md` orientation summary export/import.
- **Rolling Bootstrap** = internal evolving continuity memory summary.
- **Prompt Bridges** = external AI instructions for producing handoffs/caches.

## Cache Level Meanings

- **Spark** = raw fragment / discovery
- **Ember** = refined synthesis
- **Flame** = integrated cross-domain continuity
- **Hearth** = foundational continuity structure

These levels indicate continuity refinement posture, not rarity, power, or loot progression.

## Quick Start

```bash
npm install
npm start
```

Open `http://localhost:3477`.

## Requirements

- Node.js 20.16+ (or 22.3+) — matches the `pdf-parse`/`pdfjs-dist` dependency's
  locked engine requirement; Node 18 is no longer sufficient. See `engines`
  in `package.json`.
- Ollama running locally (optional — the Ember Node starts and remains usable
  as a local archive and Session instrument without it; AI features simply
  report as unavailable until Ollama is running)
- Recommended model: `ollama pull gemma3:4b`

## Core Runtime Surfaces

- Chat: `POST /api/chat`
- Threshold intake: `POST /api/threshold/import`, `GET /api/threshold/files`
- Threshold markdown intake: `POST /api/threshold/inbox/markdown`
- Threshold cache drafts: `POST /api/threshold/cache-drafts`, `GET /api/threshold/cache-drafts`, `GET /api/threshold/cache-drafts/:id`, `POST /api/threshold/cache-drafts/:id/documents/add`, `DELETE /api/threshold/cache-drafts/:id/documents`, `GET /api/threshold/cache-drafts/:id/documents/content`, `POST /api/threshold/cache-drafts/:id/export`, `POST /api/threshold/cache-drafts/:id/install`, `DELETE /api/threshold/cache-drafts/:id`
- Reader: `GET /api/threshold/files/content`, `GET /api/archive/read`
- Runtime/model stewardship: `GET /api/ai/models`, `POST /api/ai/models/select`
- Model roles: `POST /api/ai/models/roles` (roles fall back at runtime if the role model is unavailable)
- Continuity + memory: `GET /api/bootstrap`, `POST /api/bootstrap/refresh`, `POST /api/system/memory-compression/refresh`
- Concept index + court: `GET /api/status`, `GET /api/court`
- Cache manager: `GET /caches`, `GET /api/user-caches`, `POST /api/user-caches`

## Data Root

Default path:

- Windows: `~/Documents/Ember-Node-Data`
- Linux/macOS: `~/.ember-node`

Set `EMBER_NODE_DATA_ROOT` to override.

## Runtime Configuration

Canonical runtime configuration lives in `app/runtimeConfig.js`. Supported
environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `EMBER_NODE_HOST` | `127.0.0.1` | Web server bind host. Loopback by default — v118 is explicitly local, not LAN-ready. |
| `EMBER_NODE_PORT` | `3477` | Web server bind port. |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Base URL for the local Ollama runtime. Shared by runtime stewardship, embeddings, chat, and status reporting. |
| `EMBER_OLLAMA_TIMEOUT_MS` | `2000` | Timeout applied to Ollama model-health/tags requests, so a stopped Ollama never blocks the Node. |
| `EMBER_ARCHIVE_BASE_URL` | `https://greenfire-archive.replit.app` | Base URL for the optional hosted Green Fire Archive used for cache-package updates. A separate concern from Ollama; never assumed interchangeable with any other Green Fire domain. |
| `EMBER_NODE_DATA_ROOT` / `EMBER_DATA_ROOT` | platform default (see Data Root) | User data root. |

The Ember Node starts and remains usable as a local archive and Session
instrument even when Ollama is stopped or unreachable. `GET /api/status` is
the canonical status endpoint and distinguishes Ember Node server
availability from AI runtime reachability and model availability:

```json
{
  "serverAvailable": true,
  "model": "gemma3:4b",
  "ollamaBaseUrl": "http://localhost:11434",
  "ai": { "runtimeReachable": false, "configuredModel": "gemma3:4b", "modelAvailable": false },
  "aiRuntimeReachable": false,
  "aiModelAvailable": false
}
```

## Cache Draft Manifest (Normalized)

Threshold cache drafts use this normalized manifest structure:

```json
{
  "id": "winter-water-cache",
  "title": "Winter Water Cache",
  "version": "0.1.0",
  "type": "local-cache-draft",
  "status": "draft",
  "trusted": false,
  "auto_load": false,
  "created_at": "2026-01-01T00:00:00.000Z",
  "updated_at": "2026-01-01T00:00:00.000Z",
  "description": "",
  "source": "threshold",
  "recommended_destination": "archive/caches/winter-water-cache",
  "documents": [
    {
      "path": "documents/water-purification.md",
      "title": "Water Purification",
      "type": "research-brief",
      "tags": ["water", "sanitation"],
      "archetypes": ["builder", "scholar"],
      "status": "unverified"
    }
  ],
  "tags": [],
  "archetypes": [],
  "license": "unknown"
}
```

## Bundled Green Fire Core Cache — Content-Version Note

The Green Fire Core Cache bundled at `app/bundled-caches/green-fire-core-cache.zip`
is currently manifest version **1.4** (`green-fire-core/manifest.json`). No
v1.6 bundle is packaged in this build. Runtime and documentation claims are
kept in agreement with the files actually bundled — this note exists so a
future build does not silently relabel v1.4 content as v1.6. If a v1.6
bundle becomes available it should replace this file and this note should
be updated or removed.
