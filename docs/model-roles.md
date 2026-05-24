# Model Roles

Ember Node supports an optional **Model Roles** layer to route requests to different local models.

- **Hearth** = fast generalist chat + continuity.
- **Forge** = deep synthesis, writing, reflection, long-form reasoning.
- **Scribe** = structure/code work, plus cache/loadout/bootstrap/schema tasks.

## Routing Summary

- **Spark / Ember** → Hearth
- **Hearth / Archive** → Forge
- **code/cache/bootstrap/schema/json/yaml/markdown** tasks → Scribe
- **fallback** → `selected_model`

## Fallback Behavior

If a role model is unset (blank) or unavailable, Ember Node falls back safely to `selected_model` (and then to the default Ollama model when the selected model is missing).

