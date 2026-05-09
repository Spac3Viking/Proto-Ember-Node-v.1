# Ember Node v.ᚠ — Development Roadmap

## Phase 1 ✓ — Local Node Foundation
- Local Node/Express server
- Ollama chat integration (gemma3:4b)
- Basic cache endpoints
- Room tab navigation scaffold

## Phase 2 ✓ — Green Fire UI Shell
- Green Fire Archive design system
- Legacy multi-room navigation removed; structure is now Hearth, Ember Council, and Threshold
- Cache Shelf — browse, inspect, and read installed caches
- Ember Council drafts panel
- Threshold intake scaffold
- System room with live Ollama/model status
- data/ directory scaffold

## Phase 3 ✓ — Local Knowledge Engine
- Document ingestion pipeline (.txt, .md)
- Deterministic sliding-window chunker
- Local embeddings via Ollama (nomic-embed-text) with keyword fallback
- JSON-based local index (chunks, embeddings, manifests, exclusions)
- Room-aware retrieval — Hearth prioritised, Threshold excluded by default
- Grounded Council Chat via `/api/chat`
- Signal Trace — visible source provenance on every response
- Cache indexing from Ember Council
- Ember Council note saving
- Threshold file intake (drag-and-drop, file browse)
- caches/*/docs/ recursive reading and indexing
- `/api/sources`, `/api/index/cache/:id`, `/api/index/file` endpoints

## Phase 4 — Remember / Archive Mechanics
- Formal "Remember" action to promote Ember Council material to Hearth
- Curated Hearth writes with user approval
- Archive management — browse, annotate, retire
- Ember Council snapshot persistence

## Phase 5 — Local Storage Root + Data Separation
- `app/storageConfig.js` — configurable data root module
- `EMBER_DATA_ROOT` environment variable for custom data locations
- OS-appropriate default: `~/.ember-node` (Linux/macOS/Windows)
- First-run `ensureDataRoot()` creates the full directory tree automatically
- App code and user data fully separated — updates never touch user data
- `GET /api/storage-info` endpoint — inspect active data root at runtime
- `ingest.js`, `indexStore.js`, and `server.js` all resolve paths via storageConfig

## Phase 6 — Offline Cache Engine + Export
- True offline cache engine
- Portable export/import for caches and remembered signal
- Export packaging via Threshold
- Desktop shell packaging
