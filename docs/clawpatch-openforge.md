# clawpatch + OpenForge workflow

This repo is configured for [`openclaw/clawpatch`](https://github.com/openclaw/clawpatch) as a local development review tool, plus a small exporter that turns clawpatch findings into OpenForge tasks.

## Provider decision

This repo uses clawpatch's official Pi provider:

```json
{
  "provider": {
    "name": "pi",
    "model": null
  }
}
```

Clawpatch `0.3.0` includes a first-class `pi` provider. It calls the local Pi CLI directly in non-interactive JSON mode for map/review/revalidate and keeps fix operations explicit through `clawpatch fix`.

## Config and state

Committed config:

- `.clawpatch/config.json`
- package scripts in `package.json`
- `scripts/export-clawpatch-findings-to-openforge.mjs`

Generated clawpatch runtime state is intentionally ignored:

- `.clawpatch/features/`
- `.clawpatch/findings/`
- `.clawpatch/patches/`
- `.clawpatch/reports/`
- `.clawpatch/runs/`
- `.clawpatch/locks/`

The config records the OpenForge verification commands currently consumed by clawpatch `0.3.0`:

- typecheck: `pnpm exec tsc --noEmit`
- lint: `pnpm lint`
- test: `pnpm test`

Build remains available through the normal repo script: `pnpm build`.

## Review workflow

Install dependencies first:

```bash
pnpm i
```

Then run clawpatch through the local workspace dependency/bin:

```bash
pnpm run clawpatch:doctor
pnpm run clawpatch:init
pnpm run clawpatch:map
pnpm run clawpatch:status
pnpm run clawpatch:review --limit 3 --jobs 3
pnpm run clawpatch:report
pnpm run clawpatch:next
```

Inspect or act on a specific finding:

```bash
pnpm run clawpatch:show --finding <finding-id>
pnpm run clawpatch:fix --finding <finding-id> --dry-run
pnpm run clawpatch:revalidate --finding <finding-id>
```

`clawpatch fix` can edit the worktree, so use `--dry-run` first and review local changes before continuing.

## Export clawpatch findings into OpenForge tasks

The exporter reads clawpatch finding JSON from one or more files or directories. It accepts individual finding records, report-style `{ "findings": [...] }` objects, and arrays. Directory inputs are scanned for `.json` files recursively.

Dry-run is the default and never creates tasks:

```bash
pnpm --silent run clawpatch:export-openforge --json
```

Use explicit inputs when exporting a report or fixture:

```bash
pnpm --silent run clawpatch:export-openforge --input .clawpatch/findings \
  --agent pi \
  --json
```

Create real OpenForge tasks only with `--apply`:

```bash
pnpm run clawpatch:export-openforge --input .clawpatch/findings \
  --worktree "$PWD" \
  --agent pi \
  --apply
```

Each task is created with:

```bash
openforge create-task --initial-prompt <generated prompt> --worktree <repo> --label clawpatch
```

The generated prompt includes:

- finding id, title, severity, confidence, category, and status
- evidence references
- clawpatch reasoning, reproduction, and recommendation
- source JSON path
- `clawpatch` label metadata
- `agent=pi` metadata

## Caveats

- The exporter does not deduplicate against existing OpenForge tasks. Always dry-run first.
- If you want only open findings, generate or select filtered clawpatch input before exporting.
- clawpatch is an early CLI; provider/config/report shapes may evolve. Re-run the exporter tests after upgrading clawpatch.
- The Pi provider requires the local `pi` CLI to be installed and authenticated.
