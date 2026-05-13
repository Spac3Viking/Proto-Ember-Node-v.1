# Architecture Alignment Audit — Phase 16K

## Current Architecture

- **🜂 Hearth / Ember Prime** is the remembered continuity/chat center.
- **🜁 Ember Council** is the active archetype and cache refinement room.
- **🜃 Archive / Reader / Caches** provide installed memory and readable source surfaces.
- **🜄 Threshold** handles intake, inspection, cache drafts, and runtime guidance.
- **🜔 Signal Threads** remain groundwork-oriented (not full productized workflows yet).

## Accepted Current Terms

- Hearth / Ember Prime
- Ember Council
- Archive / Reader
- Threshold
- Signal Threads
- Installed Caches
- Loaded Caches
- Cache Loadout
- Markdown Handoffs
- Cache Drafts
- Continuity Bootstrap
- Rolling Bootstrap
- Fractal Memory Compression
- Prompt Bridges

## Deprecated Terms

- Workshop
- Tools (as a room/registry label)
- Cartridges
- Equipped Caches / Equip / Unequip (as primary naming)
- Heart Chat
- Current intelligence
- docs/ (for cache draft documents)
- handoff.md at draft root

## Migration Aliases Kept

- `workshop` → `council` compatibility normalization remains active in routing/storage migration paths.
- `docs/` → `documents/` compatibility remains active for legacy draft payloads/imports.
- `handoff.md` → `documents/handoff.md` compatibility remains active for legacy draft payloads/imports.

These aliases are intentional compatibility layers and should not be used as primary terminology in new visible docs/UI.

## Remaining Cleanup Candidates

### Classification of audited legacy occurrences

| Term / Pattern | Primary Occurrences | Classification | Notes |
|---|---|---|---|
| Workshop | `README.md`, `docs/ember-node-structure.md`, storage migration code, room-normalizers in chat/retrieval/threads/sources/ingest | migration alias / compatibility shim | Docs/UI text now reframed as explicit migration alias note. Code uses are intentional shims. |
| Tools (room/registry context) | `README.md`, `docs/ember-node-structure.md` legacy statement; `intakeState.js` legacy key fallback | migration alias / compatibility shim | Legacy text normalized; runtime fallback kept for backward compatibility. |
| Projects | `docs/architecture.md` (“project states”), CSS `.project-*` selectors, cache content examples | harmless CSS/internal naming or generic prose | Not architecture room naming; low-risk to defer. |
| Cartridges | `README.md`, `docs/ember-node-structure.md` legacy statement | migration alias | Included only in migration context. |
| Equipped / Equip / Unequip | removed in Phase 16Q-C | removed | Canonical cache language is now loaded/load/unload only. |
| Heart Chat | One roadmap line in `public/index.html` (“Hearth Chat references”) | harmless wording | Already aligned as **Hearth**, not **Heart**. |
| Current intelligence | none found | no active issue | No cleanup needed. |
| `docs/` | Threshold normalization comments/routes; tests for legacy payload migration; cache package `docs/` folders | compatibility shim + active cache-package convention | Draft-layer `docs/` is deprecated and normalized to `documents/`; cache package `docs/` remains valid. |
| `handoff.md` | Threshold normalization code/tests | compatibility shim | Kept only for migration to `documents/handoff.md`. |

### Low-risk cleanup completed in this phase

- Added explicit terminology alignment definitions in `README.md`.
- Updated `docs/ember-node-structure.md` with current term definitions and explicit migration alias labeling.
- Updated `docs/roadmap.md` wording to distinguish cache package `docs/` from cache draft `documents/`.
- Updated visible Threshold UI wording from **External AI Prompt Guides** to **Prompt Bridges**.

## Systems Verified

- **Hearth / Ember Prime**: room/tab and runtime assignment UI/API present.
- **Ember Council**: room/tab, archetype workflow, council chat, drafts, caches present.
- **Threshold intake**: intake UI and `/api/threshold/import` + file listing/content routes present.
- **Green Fire Reader**: archive/threshold read endpoints and reader integration present.
- **Markdown Handoff detection**: handoff template/prompt generation and draft import normalization present.
- **Prompt Bridges**: Threshold prompt-bridge UI block present (renamed in this phase).
- **Cache Drafts**: full create/list/read/add/export/install/delete route surface present.
- **Installed Caches**: installed cache listing UI/API present.
- **Loaded Caches**: loaded cache state UI/API present.
- **Cache Loadout**: system/chat trace and cache panel surfaces present.
- **Continuity Bootstrap export/import**: export button and bootstrap import handling present.
- **Rolling Bootstrap**: routes, status panel, refresh/copy/open/export controls present.
- **Fractal Memory Compression**: refresh endpoints and system controls present.
- **Ollama model selection**: model list/select endpoints and system/threshold UI present.
- **Response Depth profiles**: hearth/council response depth selectors and backend normalization present.
- **Signal Trace**: signal trace panel and trace metadata generation present.
- **Refresh / Incinerate controls**: node maintenance controls present in system panel.

## Recommended Next Steps

1. Keep compatibility aliases through the next migration window, then schedule telemetry-assisted removal criteria.
2. Add a small “Compatibility Aliases” subsection to developer-facing API docs so legacy endpoints are clearly non-primary.
3. When safe, rename internal `project-*` CSS class names only if UI refactors already touch those surfaces.
4. Continue enforcing `documents/` for all new cache draft payload examples and tests; keep `docs/` handling as read-only compatibility.
5. Re-run this audit after Signal Threads moves from groundwork to active persisted workflows.
