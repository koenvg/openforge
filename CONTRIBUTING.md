# Contributing to Open Forge

This document covers the repository's developer workflows. Open Forge is source-available software; review [`LICENSE`](LICENSE) before contributing or redistributing changes. This guide documents how to work on the project but does not promise that external pull requests will be accepted.

## Prerequisites

- [Rust](https://rustup.rs/) 1.77 or newer
- [Node.js](https://nodejs.org/) 22.12 or newer (the root `package.json` `engines.node` constraint is authoritative)
- [pnpm](https://pnpm.io/) 10 or newer
- macOS with Xcode Command Line Tools for Electron packaging and Metal/Whisper support
- At least one supported coding-agent provider, such as [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [OpenCode](https://github.com/opencode-ai/opencode), Pi, or [Grok](https://x.ai/cli)

## Repository setup

```bash
git clone https://github.com/koenvangeert/openforge.git
cd openforge
pnpm install
```

## Managing JavaScript dependency versions

Shared dependency versions belong in the pnpm catalogs in `pnpm-workspace.yaml`. Use `catalog:` in package manifests for the normal shared range. Use a named catalog such as `catalog:pinned` when a package intentionally needs an exact version instead of the default caret range.

Keep peer dependency ranges explicit in each package manifest. They describe consumer compatibility, not the version installed in this workspace. Dependencies used by only one workspace package can also remain local to that manifest.

To upgrade a shared dependency, change its catalog entry and run `pnpm install` to update `pnpm-lock.yaml`.

## Running locally

Run the full Electron app with the Rust sidecar:

```bash
pnpm electron:dev
```

For renderer-only work, run Vite without the desktop shell:

```bash
pnpm dev
```

`pnpm electron:dev` starts Vite, builds the Rust sidecar and Electron main/preload bundle, and launches Electron. Rust sidecar layout facts live in `openforge-backend-layout.json` and are resolved by `scripts/rust-sidecar-layout.mjs`.

Rust build artifacts are shared through the checkout's Git common directory by setting `CARGO_TARGET_DIR` to `.cargo-target` beside the primary `.git` directory. Set `CARGO_TARGET_DIR` explicitly to override this behavior.

## Development data

By default, `pnpm electron:dev` uses temporary Electron `userData` and a worktree-local sidecar app-data directory recorded in `.openforge-dev/electron-dev-runtime.json`.

If the normal Open Forge app-data directory contains `openforge_dev.db`, the launcher snapshots it into `.openforge-dev/sidecar-app-data` on first use and reuses that worktree-local database on later launches. Disable automatic seeding when you need an empty database:

```bash
OPENFORGE_ELECTRON_DEV_DISABLE_AUTO_SEED=1 pnpm electron:dev
```

To seed from another development app-data directory or a specific development database backup:

```bash
OPENFORGE_ELECTRON_DEV_SEED_APP_DATA_DIR="$HOME/Library/Application Support/com.openforge.app" pnpm electron:dev
# or
OPENFORGE_ELECTRON_DEV_SEED_DB_PATH="/path/to/openforge_dev.db" pnpm electron:dev
```

Set `OPENFORGE_APP_DATA_DIR=/path/to/app-data` only when no other Open Forge build is using that database.

Seeding accepts only the development database (`openforge_dev.db`), never the production database (`openforge.db`). Companion SQLite `-wal` and `-shm` files are copied when present. The source database is not shared live, and the worktree-local copy persists after development exits.

To reseed or clear worktree-local state, stop `pnpm electron:dev` and delete `.openforge-dev/`. For the safest snapshot, quit other development builds before seeding.

## Testing

```bash
# Frontend tests
pnpm test

# Focused Vitest run (do not add a `--` separator)
pnpm test src/components/ProjectFileTree.test.ts
# or
pnpm exec vitest run src/components/ProjectFileTree.test.ts

# TypeScript
pnpm exec tsc --noEmit

# Rust tests
cd "$(node scripts/rust-sidecar-layout.mjs backend-crate-root)" && cargo test

# Additional Rust validation, from the backend crate root
cargo check
cargo build
cargo clippy
```

Root `pnpm test` includes JavaScript and TypeScript `*.test.*` and `*.spec.*` suites anywhere inside first-level `apps/*`, `packages/*`, and `plugins/*` workspaces. It ignores dependency and generated directories named `node_modules`, `dist`, `build`, `coverage`, `.svelte-kit`, and `target`.

New workspace suites use the renderer's jsdom project by default, so do not add workspace names to an allowlist. A workspace that needs a different Vitest environment must get a named project in `vitest.config.ts`; exclude it from the renderer project only when that named project covers the same suite glob. `scripts/vitest-workspace-coverage.test.mjs` checks this policy against every existing workspace suite.

For Rust test filtering, pass one filter before test-binary arguments, for example `cargo test database`. Run separate commands for separate filters.

## Building and installing from source

Package the renderer, Electron main/preload files, plugins, and Rust sidecar into a macOS app bundle:

```bash
pnpm electron:package
```

Build and copy the app to `/Applications`:

```bash
pnpm electron:install
```

`pnpm electron:install` resolves the app path from `openforge-backend-layout.json`, closes an existing Open Forge instance, installs the app, and removes its quarantine flag.

Rust-only validation does not require a prebuilt `dist/` renderer bundle. Release packaging is owned by Electron; use `pnpm electron:install` for a complete local build and installation.

## Architecture at a glance

- **Renderer:** Svelte 5, TypeScript, Tailwind CSS v4, and daisyUI v5
- **Desktop shell:** Electron/Chromium main process with a sandboxed preload
- **Backend:** Rust sidecar and SQLite
- **Agent integrations:** Claude Code CLI, OpenCode, Pi, Codex, and Grok
- **Plugin platform:** OpenForge plugin SDK and built-in plugin workspace

## OpenForge CLI

The installer creates `~/.openforge/bin/openforge` and adds that directory to `~/.zshrc` when needed. Open Forge also refreshes the launcher at app startup. Restart the shell or run `source ~/.zshrc` before using it.

```bash
openforge --help
openforge project list
openforge task get --task-id T-123
openforge task update --task-id T-123 --initial-prompt "Corrected backlog prompt"
openforge task create --initial-prompt "Correct task prompt" --worktree "$PWD" --depends-on T-122 --label cleanup
```

The CLI talks to the local Open Forge HTTP bridge and is used by the installed provider skills. `openforge task list` returns compact rows by default; pass `--full` for complete task objects. Completed tasks are excluded unless `--state done` is provided.

### Task prompts

`openforge task update --initial-prompt` updates `initial_prompt` and `prompt` together only while the task has never started. Started or completed tasks reject prompt updates and require a replacement task.

If a task has the wrong initial prompt:

1. Record its labels and complete `depends_on` list.
2. Find dependent tasks whose `depends_on` entries contain the old task ID.
3. Delete the incorrect task.
4. Create a replacement with the correct prompt and preserved metadata.
5. Repoint every dependent task to the replacement while preserving its other dependencies.

```bash
openforge task get --task-id T-123
openforge task labels list --task-id T-123
openforge task list --project-id P-1 --full
openforge task delete --task-id T-123
openforge task create --initial-prompt "Correct task prompt" --project-id P-1 --depends-on T-122 --label cleanup
openforge task dependencies set --task-id T-999 --depends-on T-456,T-122
```

`task dependencies set` replaces the entire dependency list. Pass each dependent task's full desired list, changing only the obsolete task ID.
