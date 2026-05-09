# Ember Node Structure

## Elemental Rooms

- **🜂 Hearth** → Ember Prime continuity layer and remembered conversation.
- **🜁 Ember Council** → archetypal perspectives that shape interpretation, never replace continuity.
- **🜃 Archive** → installed memory, including `archive/core/`, `archive/caches/`, and `archive/mirror/`.
- **🜄 Threshold** → outside-file intake and inspection, with imported files landing in `threshold/inbox/`.
- **🜔 Signal Threads** → reserved for future saved conversations/research paths (not implemented yet).

Legacy Workshop/Tools/Projects/Cartridges architecture has been removed.

## Continuity Memory Layers

- **Archive Memory** → enduring Green Fire source material and trusted archive/caches.
- **Rolling Bootstrap** → evolving continuity summary at `system/memory/rolling-bootstrap.json`.
- **Signal Threads groundwork** → remembered thread summaries used as future thread anchors.
- **Threshold** → intake + inspection boundary before admission into remembered layers.
- **Ember Council** → archetypal interpretation context for active work.

## Reader Surface

- **Green Fire Reader** is the universal human-readable surface for imported and archive-readable files.
- Reader source labels identify origin, including **Source: Threshold** and **Source: Archive Cache**.
- Markdown is rendered for reading (with frontmatter removed), while `.txt` and `.json` open in raw mode.
- PDF files may be stored/listed in Threshold now; full PDF reading is a future phase.

## Cache Philosophy

Caches are portable memory bundles.

Examples include:

- Core Cache
- Codices Cache
- Sagas Cache
- Grimoires Cache
- Reference Cache
- Field Cache
- Community Cache
- Personal Cache
- Archive Mirror Cache

Caches may be downloaded, mirrored, shared via USB, forged locally, or transmitted between Nodes.

## Maintenance Controls

### Refresh Node

Refresh Node performs a safe reload pass:

- reloads app state
- refreshes cache/index state
- reloads configuration
- runs conservative legacy cleanup
- performs a soft UI restart

Refresh never wipes memory by itself.

### Incinerate Node Memory

Incineration permanently removes local transient memory and working state with explicit confirmation.

#### Recommended default: Purge Temporary Memory Only

Deletes:

- chats / threads
- drafts
- logs
- temporary indexes
- legacy cleanup targets

Preserves:

- `archive/core/`
- `archive/caches/`
- `system/config/`

#### Full Incineration

Deletes the temporary memory set plus broader local working files.

Optionally includes complete archive wipe when explicitly selected:

- `archive/core/`
- `archive/caches/`

No automatic archive cache deletion occurs without explicit confirmation.
