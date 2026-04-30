# Installer Assets

This folder contains assets used by the Windows installer and launcher shortcuts.

- `ember-node-icon.png` — canonical Ember Node glyph source image
- `ember-node-icon.ico` — Windows shortcut/installer icon (generated from PNG)

To regenerate the `.ico` file:

```bash
npm run installer:icon
```

The installer is designed to include `runtime/node/` when present.
If `runtime/node/node.exe` is missing, the launcher falls back to system Node.js.
For public releases, bundle the portable runtime before building the installer.
