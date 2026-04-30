# Ember Node Release Prep

Before building the public Windows installer:
1. Download the Node.js Windows Binary .zip from nodejs.org.
2. Extract it locally.
3. Copy runtime files into runtime/node/.
4. Confirm runtime/node/node.exe exists.
5. Confirm app/bundled-caches/green-fire-core-cache.zip exists.
6. Confirm app/bundled-prompts/ember-node-forge.md exists if available.
7. Confirm installer/assets/ember-node-icon.ico exists.
8. Build the installer.
9. Test on a clean Windows machine.
10. Upload the finished installer artifact to the Green Fire Archive downloads page or release host.

Important:
- Do not delete Ember-Node-Data during updates.
- The app folder may be replaced.
- The hearth remains.
