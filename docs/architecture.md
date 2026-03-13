# Ember Node v.ᚠ — Architecture Rewrite

*Design Charter — Living Document*

---

## Identity

Ember Node is a local-first sovereign AI forge for thought, code, and memory.

It is not a chatbot. It is not a SaaS platform. It is a personal knowledge engine and
refinement console that allows users to:

- interact with remembered knowledge
- refine new works
- shape code and language with AI assistance
- curate trusted sources
- package knowledge outward
- bring external responses back for refinement

The AI resident in the system is called **The Heart**. The Heart assists the user but does
not silently change the system. No AI-generated change becomes remembered automatically.
Every change of consequence must pass through user review and approval.

Ember Node is descended from the Green Fire Archive — the larger philosophical and literary
body this system is built to serve. Where the Archive is the library, the Ember Node is the
personal workstation a scholar carries out of the Archive. It allows the user to interact
with remembered Green Fire works, refine new works in the same tradition, package and
distribute knowledge, and build tools around the philosophy.

---

## Recursive Refinement

Ember Node is a recursive refinement engine.

The system exists to support a continuous loop of:

1. gathering signal
2. refining signal
3. remembering signal
4. recombining remembered signal
5. exporting curated signal
6. receiving external responses
7. refining again

This recursive loop is one of the central operational principles of Green Fire. The node is
not a static repository. It is a forge that continually strengthens its own signal through
recursive refinement. Each pass through the loop ideally produces sharper, more intentional
material.

---

## Language Note — Remembered, Not Canonical

Nothing in Ember Node is treated as permanently authoritative or fixed doctrine.

The word **remembered** is used throughout this document in place of "canonical."

Remembered means:

- intentionally preserved
- curated through reflection
- revisitable and revisable
- living rather than fixed
- part of a growing memory ecology

Examples: remembered works, remembered prompts, remembered shelves, remembered sources,
remembered archives. This language reflects a living memory system, not rigid doctrine.

---

## The Three-Room Model

Ember Node is structured around three primary rooms:

| Room | Rune | Identity |
|------|------|----------|
| Hearth | ᚺ | Reflection and Remembered Signal |
| Workshop | ᚹ | Crafting, Coding, and Refinement |
| Threshold | ᚦ | Boundary of Exchange |

These three rooms replace the previous five-room model. The Cartridges room and System room
are dissolved as separate spaces:

- **System identity** belongs inside Hearth
- **Cartridges** belong inside Workshop

This creates a simpler and more meaningful architecture where each room has a distinct and
coherent purpose.

---

## Hearth — Room of Reflection and Remembered Signal

Hearth is the reflective center of the Ember Node. It holds the remembered layer of the
system. It is where users interact with the Heart in a stable environment and reflect on
preserved knowledge.

### What Hearth Contains

- Heart chat interface
- remembered prompts
- remembered documents
- remembered shelves
- remembered system identity
- remembered knowledge collections
- the internal Archive section
- trusted references
- curated memory

### Hearth Is Reflective and Generative

Hearth does not only preserve knowledge — it also helps generate future knowledge.
Remembered works can be intentionally drawn back into Workshop to serve as high-quality
context for new creation. This is a core principle of the system.

### Remembered Works Feed Future Creation

Refined works preserved in Hearth should be usable as source material for new drafts,
research, code, and philosophical exploration. Examples include:

- codices
- sagas
- grimoires
- essays
- manuals
- curated document collections

These works are not static. They act as fuel for future refinement.

### Hearth Archive Section

Within Hearth there is an Archive area that can house:

- Green Fire codices
- Green Fire sagas
- Green Fire grimoires
- remembered books
- remembered source collections
- a local copy of the Green Fire Archive PWA (future)
- curated research materials

This Archive represents the remembered signal body of the node.

### Hearth Shelves

Hearth organizes remembered material through visible shelves:

| Shelf | Purpose |
|-------|---------|
| Archive Shelf | Green Fire works, codices, sagas, grimoires |
| Remembered Books Shelf | curated reading and reference |
| Remembered Sources Shelf | trusted external materials |
| Prompt Shelf | curated prompt library |
| Heart Identity Shelf | remembered system identity and configuration |

Shelves are visible organizing structures rather than abstract folders. They support
intentional curation and clear navigation.

---

## Workshop — Room of Crafting, Coding, and Refinement

Workshop is the active creation environment. It is where the user and the Heart shape works
together. Workshop should feel like a forge, a lab, and a drafting studio — a place of
active making.

### What Workshop Contains

- notepad and scratchpad
- draft writing area
- code editing and experimentation
- cartridge shelf and cartridge development
- tools and manuals
- works in progress
- review queues
- build experiments
- branch-like project states
- snapshot and iteration workflows

### Workshop Is Where Remembered Signal Is Recombined

Remembered works from Hearth can be brought into Workshop to:

- inspire new writing
- serve as AI context
- guide coding and design
- support research
- refine philosophical ideas
- build new cartridges
- generate export packages

Workshop is where remembered signal becomes new signal.

### Code and Symbolic Systems

Workshop is explicitly a space for:

- learning code
- shaping code with AI assistance
- experimenting with software design
- treating code as a symbolic language

The system supports collaborative development between user and Heart. Code is not a separate
domain — it is another form of signal subject to the same refinement process.

### Workshop Shelves

| Shelf | Purpose |
|-------|---------|
| Tool Shelf | active utilities and scripts |
| Manual Shelf | technical references and guides |
| Draft Shelf | works in progress |
| Build Shelf | active build experiments and project states |
| Cartridge Shelf | installed and in-development cartridges |
| Notes Shelf | scratchpad material and quick captures |
| To-Read Shelf | queued incoming material |
| Review Shelf | items awaiting user inspection or approval |

---

## Threshold — Boundary of Exchange

Threshold is the intake and export boundary of the Ember Node. It is not merely an import
room. It is both inbound and outbound — the membrane between the node and the outside world.

### Threshold Is Both Inbound and Outbound

Inbound — material entering the node:

- incoming external files
- PDFs and documents
- outside research material
- AI responses from external systems
- imported knowledge packages
- returned drafts

Outbound — material leaving the node:

- staging of export artifacts
- packaging of outward material
- knowledge packages
- cartridges and AI context bundles
- publication outputs

Nothing that enters through Threshold writes itself into Hearth automatically. All incoming
material is quarantined for inspection before it can move deeper into the node.

### Threshold Shelves

| Shelf | Purpose |
|-------|---------|
| Incoming Shelf | newly arrived material awaiting review |
| Sorting Shelf | material being triaged and categorized |
| Inspection Shelf | material under close examination |
| Packaging Shelf | works being prepared for export |
| Export Shelf | finalized outbound packages |
| Return Shelf | external responses returning for refinement |

---

## Material Flow Through the Node

Ember Node is a circulation system. Material does not simply accumulate — it moves, is
refined, and returns changed.

### Step 1 — Import Through Threshold

Material enters the node through Threshold. Examples include documents, research material,
external AI responses, returned drafts, and source texts. All incoming material lands in
Threshold first. Nothing bypasses this boundary.

### Step 2 — Examination in Workshop

Selected material is pulled from Threshold into Workshop. There it may be examined,
annotated, refined, merged, coded, turned into new writing, converted into cartridges, or
discarded.

### Step 3 — Remembering in Hearth

If material becomes meaningful and refined, the user may choose to remember it. It moves
into Hearth and becomes part of the remembered signal body of the node. This transition
requires an explicit user action — nothing moves into Hearth automatically.

### Step 4 — Reflection in Hearth

The user interacts with remembered works and the Heart. This reflective space supports
deeper thinking, synthesis, and deliberate engagement with the node's accumulated signal.

### Step 5 — Return to Workshop

Remembered works may be intentionally pulled back into Workshop. This allows recombination,
new drafts, philosophical development, new code, cartridge creation, and further refinement.
The act of returning remembered works to Workshop is one of the key creative gestures of the
node.

### Step 6 — Export Through Threshold

Refined works may be staged in Threshold for export. Examples include documents, knowledge
packages, cartridges, AI context bundles, and publication outputs.

### Step 7 — External Responses Return Through Threshold

External systems may generate responses or transformations. Those responses return through
Threshold and re-enter Workshop for further refinement.

### The Recursive Loop

```
Threshold → Workshop → Hearth → Workshop → Threshold
```

Each cycle ideally produces more refined signal. There is no endpoint — the loop continues
as long as the node is in use. This is what it means for Ember Node to be a forge: it does
not store signal passively; it continuously strengthens signal through use.

---

## The AI Review Rule

No AI-generated change becomes remembered automatically.

All AI-generated changes must pass through a review process before they can enter the
remembered layer of the node. The user must always approve system-level changes.

No silent edits. No hidden commits. No automatic writes to Hearth.

One possible workflow:

```
Draft → Review → Approve → Remember
```

Another:

```
Generate → Inspect → Admit → Remember
```

This rule is not a technical constraint alone — it is a philosophical commitment. The Heart
assists the user. It does not govern the node. Sovereignty over what is remembered remains
with the user at all times.

---

## Symbolic and Runic Interface Language

Ember Node may gradually incorporate symbolic interface language inspired by runic systems.
This does not require building a new operating system. It can manifest as:

- symbolic room markers (runes as room identifiers)
- meaningful action verbs (Admit, Remember, Discard, Package, Export)
- visible trust boundaries between rooms
- clear memory layers with explicit transitions
- symbolic visual design language

This approach supports a distinctive interface that is harder to casually distort or
misread. The symbolic layer should grow with the system — it is not decoration but a
structural element of the node's identity.

---

## Architecture Principles

- local-first sovereignty
- no silent actions
- memory must be earned
- imports land in Threshold first
- nothing writes to Hearth automatically
- network is an expedition, not a dependency
- chat is a pane, not the whole room
- cartridges live in Workshop, not a separate room
- system identity lives in Hearth, not a separate room
- all AI-generated changes require user review before being remembered
- remembered works fuel future creation
- the node is a forge, not a filing cabinet

---

## Phase Roadmap

| Phase | Focus |
|-------|-------|
| Phase 1 ✓ | Local Node/Express + Ollama chat + basic cartridge endpoints |
| Phase 2 ✓ | Green Fire UI shell + Workshop Cartridge Shelf + three-room navigation |
| Phase 3   | Document ingestion, chunking, embeddings, retrieval, signal trace |
| Phase 4   | Remember / Archive mechanics, curated Hearth writes |
| Phase 5   | Offline cartridge engine, portable export/import, desktop shell |
| Phase 6   | Symbolic interface language, runic room markers, trust boundary visualization |
