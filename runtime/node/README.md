# Bundled Portable Node Runtime

This folder is intentionally empty in the source repo.

Before building a public installer, manually place the portable Windows Node.js runtime here.

Expected release-time structure:

```text
runtime/node/
  node.exe
  npm.cmd
  npx.cmd
  node_modules/
```

Do not commit large runtime binaries to the source repo unless intentionally using Git LFS or release artifacts.
