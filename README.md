# Ember Node v.ᚠ

A local-first sovereign AI console descended from the Green Fire Archive.

## Current Architecture

- **🜂 Hearth** — Ember Prime continuity and remembered signal.
- **🜁 Ember Council** — Sentinel Archetypes and active refinement.
- **🜃 Archive** — installed memory and Reader surface.
- **🜄 Threshold** — intake, inspection, and runtime stewardship.
- **🜔 Signal Threads** — future saved thought lines (groundwork only).
- **Caches** — portable memory bundles.
- **Rolling Bootstrap** — unfolding continuity summary.
- **Fractal Memory Compression** — cache/document/archetype summary geometry.

> Workshop is retired. Ember Council is the active archetype room. Tools registry is retired. Threshold now handles Local AI and Runtime Stewardship. Caches replaced cartridges. Signal Threads are the successor to old project/thread concepts.

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
- Threshold cache drafts: `POST /api/threshold/cache-drafts`, `GET /api/threshold/cache-drafts`, `GET /api/threshold/cache-drafts/:id`, `POST /api/threshold/cache-drafts/:id/documents/add`, `DELETE /api/threshold/cache-drafts/:id/documents`, `GET /api/threshold/cache-drafts/:id/documents/content`, `POST /api/threshold/cache-drafts/:id/export`, `POST /api/threshold/cache-drafts/:id/install`, `DELETE /api/threshold/cache-drafts/:id`
- Reader: `GET /api/threshold/files/content`, `GET /api/archive/read`
- Runtime/model stewardship: `GET /api/ai/models`, `POST /api/ai/models/select`
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
