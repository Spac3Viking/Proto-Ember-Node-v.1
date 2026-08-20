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

Important:
- Do not delete Ember-Node-Data during updates.
- The app folder may be replaced.
- The hearth remains.
