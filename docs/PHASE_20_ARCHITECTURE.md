# Phase 20 Architecture Contract

_Status: primary architecture reference, effective build v118._

This document establishes the primary architecture the Ember Node is
converging toward. It does not redesign or migrate anything by itself — it
is the contract that build v118 and later Phase 20 builds are measured
against. Older phase documents (`docs/architecture.md`, `docs/DESIGN.md`,
`docs/roadmap.md`, etc.) remain as historical record and are not erased;
where they conflict with this document, this document governs.

## Purpose

The Ember Node is a **local-first human continuity instrument**. Its purpose
is to help a person become more capable through participation in reality —
not more dependent on AI. AI is a companion and instrument inside the Node,
never its authority.

## The permanent primary architecture

1. **SESSION** — *What am I working on?*
   Active work: the current line of attention, effort, and decision-making.

2. **HEARTH** — *What do I already have?*
   Durable continuity: curated knowledge, remembered signal, and the
   Node's accumulated understanding of itself and its user.

3. **THRESHOLD** — *What is entering or leaving the Node?*
   Deliberate exchange: intake, inspection, export, and any material that
   is explicitly imported into or exported out of the Node — the crossing
   of its boundary with the outside world. Threshold governs that
   deliberate, externally-exchanged material; it is not a workflow a
   person must pass through merely to observe, write, or participate
   directly inside Session — direct human observation and authorship in
   Session require no separate Threshold step.

These three spaces are the permanent destinations of the Node. Everything
else exists to serve them.

## The Session cycle

Work inside Session follows a human cycle, not a model-driven one:

**Observe → Reflect → Act → Refine → Remember**

- **Observe** — take in the situation as it actually is.
- **Reflect** — think about what it means.
- **Act** — do the next concrete thing.
- **Refine** — adjust based on what happened.
- **Remember** — carry the durable part forward into Hearth.

This cycle is the substance of Session; it is not replaced or shortcut by
AI assistance.

## Advanced systems are tools, not destinations

Council, archetypes, caches, model roles, runtime tuning, Prompt Bridges,
Forge, and Signal Thread mechanics remain available and useful, but they
are **contextual tools reached from within Session, Hearth, or Threshold**,
not additional primary destinations a user is expected to navigate to on
their own. Nothing in v118 changes their behavior; this section only
states their proper place in the hierarchy for future consolidation work.

## Compression before expansion

When a choice exists between adding a new surface and folding a capability
into an existing one, folding wins. The Node's trustworthiness comes from
its simplicity being legible, not from the number of features it exposes.

## User ownership, inspectability, repairability, offline operation

- All user data lives under a single, user-controlled data root
  (see `README.md` → Data Root).
- The Node's own code, configuration, and stored data are plain files a
  user can inspect and, if necessary, repair by hand.
- The Node must start and remain usable — as a local archive and Session
  instrument — with no internet access and with no AI runtime running.
  AI unavailability is a recoverable runtime state, never a reason for the
  Node itself to be considered unavailable.

## The future continuity relationship

The intended long-term shape of continuity, to be built out in later
Phase 20 stages (not v118):

**Session ↔ Thread → Hearth**

A Thread carries a concern, project, lesson, or open pressure across
multiple Sessions. A Session may begin, continue, or refine a Thread —
a Thread is not merely produced once and set aside. Durable Session
outcomes and Thread continuity are remembered into Hearth. This replaces
today's parallel legacy-thread and Signal-Thread mechanics with a single
continuity path — that consolidation is explicitly deferred (see
Non-Goals below).

## Epistemic boundaries

The Node knows only what a person enters or what functioning instruments
provide. Records may be incomplete, outdated, biased, or contradictory.
AI helps compare information, identify inconsistencies, test explanations,
and prepare questions; it never replaces human judgment.

## What build v118 does and does not do

v118 is a stabilization build. It corrects confirmed defects, establishes
a local trust boundary, centralizes runtime configuration, and aligns
primary documentation with this contract. It does **not**:

- redesign Session, Hearth, or Threshold,
- consolidate chat threads and Signal Threads,
- migrate or delete legacy thread data,
- change the five-stage Session data model,
- implement Universal Host / LAN pairing (deferred to v121).

See the v118 pull request description for the full list of items deferred
to v119, v120, and v121.
