# Ember Node v.ᚠ — Development Roadmap

## Phase 1 ✓ — Local Node Foundation
- Local Node/Express server
- Ollama chat integration (gemma3:4b)
- Basic cartridge endpoints
- Room tab navigation scaffold

## Phase 2 ✓ — Green Fire UI Shell
- Green Fire Archive design system
- Five-room navigation (Hearth, Workshop, Threshold, Cartridges, System)
- Cartridge Shelf — browse, inspect, and read installed cartridges
- Workshop draft panel
- Threshold intake scaffold
- System room with live Ollama/model status
- data/ directory scaffold

## Phase 3 ✓ — Local Knowledge Engine
- Document ingestion pipeline (.txt, .md)
- Deterministic sliding-window chunker
- Local embeddings via Ollama (nomic-embed-text) with keyword fallback
- JSON-based local index (chunks, embeddings, manifests, exclusions)
- Room-aware retrieval — Hearth prioritised, Threshold excluded by default
- Grounded Heart chat via `/api/chat`
- Signal Trace — visible source provenance on every response
- Cartridge indexing from Workshop
- Workshop note saving
- Threshold file intake (drag-and-drop, file browse)
- cartridges/*/docs/ recursive reading and indexing
- `/api/sources`, `/api/index/cartridge/:id`, `/api/index/file` endpoints

## Phase 4 — Remember / Archive Mechanics
- Formal "Remember" action to promote Workshop material to Hearth
- Curated Hearth writes with user approval
- Archive management — browse, annotate, retire
- Workshop snapshot persistence

## Phase 5 — Offline Cartridge Engine + Export
- True offline cartridge engine
- Portable export/import for cartridges and remembered signal
- Export packaging via Threshold
- Desktop shell packaging
