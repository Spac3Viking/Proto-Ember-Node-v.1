# Ember Node v.ᚠ

A local-first sovereign AI console descended from the Green Fire Archive.

Ember Node is a personal workstation built around local models, local knowledge,
local memory discipline, explicit user control, modular cartridges, and offline
resilience.

The AI inside the system is called **The Heart** — a grounded resident intelligence,
not an oracle.

---

## Phase 2 — Offline Console + Cartridge Shelf

Phase 2 extends the working Phase 1 prototype into a coherent Ember Node shell:

- **Green Fire design system** — carved-stone aesthetic with amber and green laser light
- **Room-based navigation** — five rooms, one visible at a time
- **Fully functional Hearth chat** — local Ollama integration preserved
- **Cartridge Shelf** — browse, inspect, and read installed cartridges with manifest metadata
- **Workshop** — draft panel with snapshot scaffold
- **Threshold** — intake room scaffold for future document ingestion
- **System room** — live status for model, Ollama, and cartridge shelf
- **data/ scaffold** — directory structure prepared for future retrieval and memory phases

---

## The Three Primary Rooms

| Room | Rune | Purpose |
|------|------|---------|
| Hearth | ᚺ | Preserved signal, primary chat, curated continuity |
| Workshop | ᚹ | Drafting, experimentation, creation, building |
| Threshold | ᚦ | Inspection space for imported or untrusted material |
| Cartridges | ᚲ | Modular knowledge pack shelf and inspector |
| System | ᛟ | Status, configuration, and phase roadmap |

---

## Requirements

- [Node.js](https://nodejs.org/) 18+
- [Ollama](https://ollama.com/) running locally
- Model pulled: `ollama pull gemma3:4b`

---

## Quick Start

```bash
npm install
npm start
```

Open [http://localhost:3477](http://localhost:3477) in your browser.

---

## Cartridge System

Cartridges are modular knowledge packs stored in `./cartridges/`.

```
cartridges/
  green_fire/
    manifest.json
    README.md
  philosophy/
    manifest.json
    README.md
  survival/
    manifest.json
    README.md
  journals/
    manifest.json
    README.md
```

Each cartridge may include a `manifest.json` with fields:

```json
{
  "name": "Display Name",
  "id": "directory-id",
  "description": "What this cartridge contains",
  "version": "0.1.0",
  "type": "knowledge-pack",
  "permissions": {
    "writeHearth": false,
    "networkAccess": false
  }
}
```

No cartridge may silently write into Hearth.

---

## Data Directory

Phase 2 prepares the following scaffold for later retrieval and memory phases:

```
data/
  hearth/       — curated Hearth writes (Phase 4)
  workshop/     — Workshop snapshots (Phase 4)
  threshold/    — quarantined imports (Phase 3)
  system/       — system state (future)
  cartridges/   — cartridge runtime cache (future)
```

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/chat` | Forward message to Ollama (model: gemma3:4b) |
| `GET`  | `/cartridges` | List all installed cartridges with metadata |
| `GET`  | `/cartridges/:name` | Inspect a cartridge's manifest and content |

---

## Architecture Principles

- local-first continuity
- no silent actions
- memory must be earned
- imports land in Threshold first
- nothing writes to Hearth automatically
- network is an expedition, not a dependency
- chat is a pane, not the whole room
- cartridges are inserted / inspected intentionally

---

## Phase Roadmap

| Phase | Focus |
|-------|-------|
| Phase 1 ✓ | Local Node/Express + Ollama chat + basic cartridge endpoints |
| Phase 2 ✓ | Green Fire UI shell + Cartridge Shelf + room navigation |
| Phase 3   | Document ingestion, chunking, embeddings, retrieval, signal trace |
| Phase 4   | Remember / Archive mechanics, curated Hearth writes |
| Phase 5   | Offline cartridge engine, portable export/import, desktop shell |
