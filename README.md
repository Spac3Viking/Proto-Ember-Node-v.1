# Ember Node v.ᚠ

A local-first sovereign AI console descended from the Green Fire Archive.

Ember Node is now a **markdown-first continuity terminal**: active continuity exchange is centered on `.md`, `.txt`, copy/paste dialogue, bootstrap files, cache manifests, and README-driven handoffs.

## Current Architecture

- **🜂 Hearth** — Ember Prime continuity and remembered signal.
- **🜁 Ember Council** — Sentinel Archetypes and active refinement.
- **🜃 Archive** — installed memory and Reader surface.
- **🜄 Threshold** — intake, inspection, and runtime stewardship.
- **🜔 Signal Threads** — future saved thought lines (groundwork only).
- **Caches** — portable memory bundles.
- **Rolling Bootstrap** — unfolding continuity summary.
- **Fractal Memory Compression** — cache/document/archetype summary geometry.

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

- Node.js 18+
- Ollama running locally
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
