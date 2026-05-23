# OpenForge HTTP bridge port contract

`config/openforge-http-bridge-ports.json` is the source of truth for local OpenForge HTTP bridge default ports.

- `productionDefaultPort`: used by packaged Electron sidecar defaults, Rust HTTP server/hooks, installed CLI fallback, provider extension fallback, and provider skill documentation.
- `developmentDefaultPort`: used by `pnpm electron:dev` when no explicit backend or legacy hook port is inherited.

Generated consumers are synchronized by:

```bash
node scripts/sync-http-bridge-port-contract.mjs
node scripts/sync-http-bridge-port-contract.mjs --check
```

Do not edit generated port constants directly. Change the JSON contract, run the sync script, and run the focused contract tests so Electron, Rust, CLI, provider docs, and dev scripts cannot drift.
