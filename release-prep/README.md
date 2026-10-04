# Ember Node Release Prep

Before building the public Windows installer:
1. Download the current Node.js LTS Windows Binary .zip from nodejs.org.
2. Extract it locally.
3. Copy runtime files into runtime/node/.
4. Confirm runtime/node/node.exe exists.
5. Confirm repository-root `green-fire-core-cache.zip` exists (package version 1.0.0).
6. Confirm repository-root `green-fire-library.zip` exists (package version 2.0.0).
7. Confirm app/bundled-prompts/ember-node-forge.md exists if available.
8. Confirm installer/assets/ember-node-icon.ico exists.
9. Build the installer.
10. Test on a clean Windows machine.
11. Upload the finished installer artifact to the Green Fire Archive downloads page or release host.

## First supported Windows environment (proposed)

**Requirements still needing clean-machine verification:** Windows 10 or 11
(64-bit), a bundled Node.js runtime matching `package.json` (Node 20.16+ or
22.3+), and enough writable user storage for `Documents/Ember-Node-Data`.
For local AI, install Ollama separately and pull the configured model (the
default is `gemma3:4b`) before disconnecting from the network. The application
remains usable for threads, notes, quotations, Hearth, and exports when Ollama
is unavailable.

**Tested facts in this repository:** the installer build expects
`runtime/node/node.exe` when bundling Node; otherwise the launcher falls back
to system Node. The installer assets include the two repository-root Green Fire
cache ZIPs when they are present. A source ZIP is development material, not an
offline installation kit.

The next packaging increment should produce one install process with distinct
contents: **Full SSD** includes the application, portable Node, and approved
offline library packages; **Light USB** contains only the installer and
explicitly selected portable reference material. Keep personal data-root
backups separate from either distributable.

Important:
- Do not delete Ember-Node-Data during updates.
- The app folder may be replaced.
- The hearth remains.
