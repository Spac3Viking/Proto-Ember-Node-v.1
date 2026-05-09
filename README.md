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

> Legacy Workshop/Tools/Projects/Cartridges architecture has been removed.

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
