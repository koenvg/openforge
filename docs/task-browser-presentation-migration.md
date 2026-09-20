# Task Browser presentation migration, KVG-4870

## Scope

Migrated `TaskBrowserTab.svelte`, `VisualFeedbackEditor.svelte`, and `VisualFeedbackReview.svelte`. Legacy color utilities now use the paint-equivalent semantic mappings. Both spinners use the public SDK `LoadingIndicator`, with decorative semantics because the surrounding status or button already supplies the accessible message.

No browser/session lifecycle, feedback state, settings logic, theme IDs, tokens, SDK exports, or plugin-owned CSS changed. Custom warning/error layouts retain their original roles and alpha values rather than adopting a different alert layout. The geometry allowlist changes only four exact class contexts, not allowed dimensions or counts.

## Browser evidence

`scripts/check-task-browser-presentation.mjs` mounts the real plugin components, editor, theme registry, and theme document adapter. Only the external browser-surface and storage boundaries are simulated. Production mode activates the built plugin entry and loads built host/plugin CSS.

- Chromium 151.0.7922.34, scale factor 1, locale `en-US`, timezone `UTC`, viewport height 850px, widths 1100px and 600px.
- Repository Inter and JetBrains Mono fonts; measurements wait for fonts. Transitions are disabled for deterministic measurement. Reduced-motion and animated spinner modes are checked separately.
- The semantic-only fixture retains the host's token-based global focus rule, which is unrelated to daisyUI and must survive its later removal. No legacy color or geometry aliases are loaded.
- Four built-ins plus `com.example.ink:ink` and `com.example.copper:copper`, in the shared matrix's light -> dark -> contributed sequence. Mounted focus, edited comments, open review state, and stable IDs survive switching.
- A further contributed palette is replaced through registry registration/disposal. Token reference swatches verify foreground, borders, alpha backgrounds, and updated control geometry without theme-ID selectors.
- Loading messages, decorative spinners, review metadata, warning/error feedback, selected/disabled controls, invalid geometry inputs, hover, pressed, and keyboard focus-visible states are checked.
- Editing, failed save, retry, sending/busy state, and failed delivery retain feedback. Surface creation/attachment remain one each, with no detach or destroy during theme changes.
- Computed paint, bounds, wrapping proxies, fonts, and alpha are compared with the original source baseline. Bounds tolerate at most one CSS pixel. SDK spinners intentionally use a currentColor border rather than the old masked background; comparisons preserve their outer bounds, inherited color, and opacity but exclude the different border/background implementation and inner scroll dimensions.

The original baseline was captured before the migration. Expanded measurements were recaptured from the same original source at `2197b9129b7dad4d35ab879d99c91ab4b127c0ea`, without reverting the working tree. The baseline fixture is `scripts/fixtures/task-browser-presentation-baseline.json`.

```sh
TASK_BROWSER_BASELINE_REF=2197b9129b7dad4d35ab879d99c91ab4b127c0ea \
  node scripts/check-task-browser-presentation.mjs --baseline --chromium
node scripts/check-task-browser-presentation.mjs --chromium
pnpm --filter @openforge-app/plugin-task-browser build
pnpm build
node scripts/check-task-browser-presentation.mjs --chromium --production
```

Arc was attempted first. Its CDP websocket connected but Playwright initialization timed out, including a 60-second retry. The user explicitly approved isolated Chromium. The script also supports `ARC_CDP_URL` without `--chromium`.

Generated reports, screenshots, and logs are local artifacts under `artifacts/task-browser-presentation/`. Screenshots are diagnostic evidence, not approved canonical Storybook snapshots. The dedicated Task Browser catalog remains owned by KVG-4702.

## Validation scope and results

The required scope is the complete Task Browser plugin, the migration guard tooling, and host production CSS integration. No runtime contracts, Rust, mobile, website, or sibling plugin implementation changed.

| Command | Result |
| --- | --- |
| `pnpm i` | Passed. Package manager reported ignored dependency build scripts; none were enabled. |
| `pnpm --filter @openforge-app/plugin-task-browser test` | Passed, 63 tests across 5 files. |
| `pnpm --filter @openforge-app/plugin-task-browser typecheck` | Passed after SDK build. Initial pre-build attempt could not resolve generated SDK declarations. |
| `pnpm --filter @openforge-app/plugin-task-browser build` | Passed, including SDK build and canonical entrypoint checks. |
| Browser baseline command above | Passed, 12 theme/viewport cases. |
| Source browser check above | Passed without daisyUI or compatibility aliases. The initial red run demonstrated lost loading-text opacity before migration. |
| Production browser check above | Passed against built plugin entry and host/plugin CSS. One earlier attempt timed out waiting for busy state; a rerun passed. |
| `pnpm lint` | Passed, including unused-import, plugin-boundary, and UI migration checks. The guard checks 853 files, 454 for presentation. |
| `pnpm build` | Passed. Existing chunk-size and ineffective-dynamic-import warnings remain. |
| Focused tooling command below | Passed, 36 tests across 5 files. |
| `git diff --check` | Passed. |
| Extra `pnpm test --maxWorkers=2` | Incomplete. First attempt exceeded the 310-second tool window. A logged retry was stopped after more than four minutes without a suite summary. No repository-wide pass is claimed. |

```sh
pnpm exec vitest run \
  scripts/task-browser-ui-migration.test.mjs \
  scripts/check-ui-migration-inventory.test.mjs \
  scripts/semantic-utilities.test.mjs \
  scripts/ui-migration-baseline-measurements.test.mjs \
  scripts/storybook-migration-browser-harness.test.mjs --maxWorkers=2
```

The first guard run caught stale geometry-policy contexts after color renaming. Updating only those contexts restored the checks. An earlier unbounded tooling invocation timed out; the final bounded-worker command above passed.

## Inventory

The existing parser scans the whole plugin, including executable tests. There are zero remaining legacy color/component consumers and zero unexplained dynamic expressions. Seventeen non-class candidates remain, explicitly reviewed by `scripts/task-browser-ui-migration.test.mjs`:

- `loading` in browser-state assertions and `input` in command request assertions.
- `tab` as a surface identifier or registration ID.
- `toggle` as a DevTools keyboard action.
- `alert` as a testing-library accessible-role query.

The earlier repository-wide JSON ledger is historical and was not rewritten for this slice. Compatibility CSS and daisyUI remain for other tickets.

## Gaps and follow-ups

- KVG-5100: pre-existing toolbar clipping at 600px. With feedback present, the address field collapses and the discard action clips. This migration preserves that baseline rather than changing layout.
- KVG-5101: the standalone Task Browser package emits CSS but omits `frontendStyles` metadata. The built-in host imports its source and includes scoped CSS. The production fixture explicitly loads emitted CSS; it does not prove standalone installation loads that CSS. Packaging is unchanged here.
- Native Electron sessions, real site authentication, and BrowserSurface rendering were not exercised. SDK-boundary assertions cover unchanged lifecycle calls, not the host implementation.
- Full repository tests did not complete. Canonical Storybook visual checks, packed SDK publication tests, all-plugin builds, and sibling subsystem suites were not run. SDK APIs are consumed unchanged; final cross-system removal remains KVG-4874.
