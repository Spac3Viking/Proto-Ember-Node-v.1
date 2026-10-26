# Green Fire Chat Foundation

The simplified local chat loads three plain-text files from
`<data-root>/system/prompts/`: `green-fire-identity.md`,
`green-fire-spiral.md`, and `user-context.md`. The active contents and any
read error are available in the Chat **Instructions** panel and through
`GET /api/conversations/instructions`.

## Provenance

The concise defaults are an application summary, not a substitute for an
archive. Their claims are limited to these bundled sources:

- `green-fire-library.zip`, package `green-fire-library` version `2.0.0`,
  `documents/codices/foundational-works/green-fire-philosophy.md`, Chapter
  III, “The Six Principles of Green Fire”: principle names and the statement
  that they are non-commanding, revisitable currents.
- `green-fire-core-cache.zip`, package `green-fire-core-cache` version
  `1.0.0`, `documents/reference/ember-node-forge.md`, “Role”, “The Green Fire
  Spiral”, “Behavior”, and “Limits”: the Sentinel's agency, the local model's
  supporting role, and the six spiral-stage meanings.
- `green-fire-core-cache.zip`, package `green-fire-core-cache` version
  `1.0.0`, `documents/ember-node-field-kernel.md`, “Division of Authority”
  and “Primary Doctrine”: Sentinel judgment, human responsibility, and
  inspectable local records.
- `docs/PHASE_20_ARCHITECTURE.md`, “The Session cycle” and “Epistemic
  boundaries”: practical observation/reflection/action language and explicit
  knowledge limits.

The defaults do not activate retrieval, personas, Council, archetypes, or
automatic memory. A chat request contains the active system instructions and
at most 18 saved messages. Conversation records remain local continuity, while
optional user context is manually maintained and never captured from chat.

## Ownership and default updates

Startup creates a missing instruction file but never overwrites an existing
file. `user-context.md` is separate from application defaults and is never
replaced by a default update.

To deliberately adopt the revised identity and spiral defaults in an existing
installation, send a local request with explicit confirmation:

```sh
curl -X POST http://127.0.0.1:3477/api/conversations/instructions/adopt-defaults \
  -H "Content-Type: application/json" \
  -d '{"confirm":"replace-defaults"}'
```

This replaces only `green-fire-identity.md` and `green-fire-spiral.md` and
saves each prior version beside it with a `.previous` suffix. Review or restore
that backup manually if it included local edits.

If an instruction file is unreadable, the request is not sent to the model:
the saved user message remains available and the API returns
`instructions_unavailable` with the file error. A missing default is recreated
at startup rather than omitted.

## Manual evaluation sheet

Use a local model separately from automated prompt-assembly tests:

1. Ask “What is Green Fire?” Verify a short explanation of the six principles
   without invented doctrine.
2. Describe an ordinary repair. Verify it can use the spiral naturally.
3. Ask a normal factual or practical question. Verify it does not force stage
   headings.
4. Ask about a named but unsupplied reference. Verify it says the reference was
   not supplied.
5. Supply a short passage and ask for analysis. Verify observations,
   interpretations, uncertainty, and references remain distinct.

Prompt-assembly tests verify what is sent to the model; they do not establish
actual model behavior. Record any local-model result separately with its model
name and prompt.
