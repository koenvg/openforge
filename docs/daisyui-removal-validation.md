# daisyUI removal, KVG-4874

## Scope and release status

The host no longer depends on daisyUI. Its two theme-plugin blocks, compatibility mappings, compact legacy sizing, dependency/lockfile resolution, and private Vite resolver are removed. `src/styles/global-presentation.css` preserves base paint, scrollbars, font aliases, focus, and reduced motion. The theme document adapter still owns native `color-scheme`.

Stable theme IDs, canonical `--of-*` tokens, SDK exports, plugin-owned CSS, settings behavior, terminal ownership, and unavailable-theme fallback are unchanged. Host views use semantic `of-*` utilities; standalone plugins use direct tokens or documented SDK controls and publish their emitted CSS through `frontendStyles`. Undocumented host classes such as `btn`, `loading`, `alert`, and `bg-base-100` are no longer a styling API. See [plugin theming](plugins/theming.md) and [SDK feedback imports](plugins/sdk-reference.md#theme-aware-feedback).

Implementation is present. The complete affected-system run passed 35 of 36 commands; Task Browser typechecking still has six pre-existing `TasksAPI.get` errors, reproduced at the starting commit and tracked by KVG-5339. This remains a failed check, not a passing completion gate. The single independent review returned one P2 guard finding; it was resolved with CLI regressions and post-review validation.

## Readiness and test boundaries

The starting commit was `3a78e23096cbf05344d45fcf6b5f390cfb285b57`. Planning PR [#2373](https://github.com/koenvg/openforge/pull/2373) was merged and all ten native prerequisites were done. The shared OpenSpec checklist was not treated as executable readiness evidence. Parent KVG-4687 and KVG-4522 settings logic were not changed.

The agreed public test boundaries are the inventory CLI, mounted settings/theme selection, packed SDK publication, and production rendering. `pnpm check:ui-migration` combines the established presentation guard with removal readiness across 2,252 executable sources. The [inventory guide](ui-migration-inventory.md#removal-readiness-kvg-4874) describes exact negative-test exclusions and counted non-consumer dispositions. Imperative `className`, `setAttribute('class', ...)`, and `classList` mutations are distinguished from native role/state vocabulary. Compatibility stylesheet reads cannot hide behind an absence-test disposition.

Negative guard strings and the machine-readable inventory ledger are excluded from Tailwind stylesheet discovery, not from source analysis. A production CSS test verifies that neither can generate compatibility-variable readers. The refreshed [consumer ledger](ui-migration-consumers.json) includes classifications of deliberate negative inputs; its raw count is not a removal threshold.

## Browser evidence

Artifacts are local, ignored files under `artifacts/storybook-visual/daisyui-removal/`. They are diagnostic evidence, not canonical screenshot approvals.

| Evidence | Final result |
| --- | --- |
| Host migration matrix | 168 cases, six themes, widths 1280/1000. Before/after paint, geometry, interaction state, overflow, wrapping, and diagnostics matched exactly; maximum geometry delta was 0 CSS px against a 1px tolerance. |
| SDK without host styles | 12 cases, six themes, widths 640/320. Paint, geometry, invalid/disabled/selected state, focus, and reduced motion matched exactly; maximum geometry delta was 0 CSS px. |
| Host presentation bounds | 60 cases passed the existing 1 CSS-pixel geometry comparison. |
| Mounted settings in development | 12 theme/viewport cases passed, widths 1440/1000. |
| Mounted settings from production assets | 12 cases passed from emitted Vite JS, CSS, and fonts served without a development transformer. |

The six palettes are `openforge-light`, `openforge-dark`, `workshop-light`, `workshop-dark`, `com.example.ink:ink`, and `com.example.copper:copper`. The real keyboard-selection sequence retains Light → Dark → namespaced Ink, then exercises the other built-ins and Copper's distinct geometry. The same edited input stays mounted, selection retains focus, native color scheme follows appearance, and fonts, reduced motion, opacity, hover, and pressed paint consume active tokens. Replacing Copper through the registry changes paint while preserving its ID, edited input, and focus. Existing host tests retain persistence, reload, and unavailable-theme fallback regressions.

Relevant artifacts:

- `before.json`, `after.json`, `after-comparison.json`: host paint/geometry and hover/pressed/focus-visible measurements.
- `sdk-before.json`, `sdk-after.json`, `sdk-after-comparison.json`: token-only SDK measurements.
- `host/`: before/after measurements and screenshots.
- `settings-dev/`, `settings-production/`: six-theme screenshots and selection/mutation reports.
- `validation/`, `validation-final/`, `validation-post-review/`: command logs and machine-readable status.

Reproduce with two Storybook services, then:

```sh
STORYBOOK_URL=http://localhost:6486 UI_MIGRATION_BASELINE=artifacts/storybook-visual/daisyui-removal/after.json node scripts/capture-ui-migration-baseline.mjs
UI_MIGRATION_BASELINE=artifacts/storybook-visual/daisyui-removal/sdk-after.json node scripts/capture-sdk-migration-baseline.mjs
STORYBOOK_URL=http://localhost:6486 HOST_PRESENTATION_ARTIFACTS=artifacts/storybook-visual/daisyui-removal/host node scripts/check-host-presentation.mjs
SETTINGS_THEME_ARTIFACT_DIR=artifacts/storybook-visual/daisyui-removal/settings-dev node scripts/check-settings-themes.mjs
SETTINGS_THEME_ARTIFACT_DIR=artifacts/storybook-visual/daisyui-removal/settings-production node scripts/check-settings-themes.mjs --production
```

Set `TMPDIR=/tmp TEMP=/tmp TMP=/tmp` for detached Playwright jobs. Default Storybook services at 6006/6007 were unavailable; isolated services at 6486/6487 were used instead.

## Affected-system validation

Scope includes the renderer/shared presentation, SDK publication, PR-review UI, terminal runtime, all five bundled plugins, Storybook, source discovery, and production assets. Root dependency/build configuration and test infrastructure warrant full affected-system checks. No Rust, Electron-main, website, or mobile source changed; their independent suites and packaged application builds were not run.

The first post-removal host run found two missed test migrations: a browser test still read the deleted adapter and a motion fixture still used `.loading`. They were corrected and the guard received five red/green regression cases. A subsequent compiled-CSS regression demonstrated and removed an unused compatibility reader generated from negative-test metadata. The 36-command affected-system run passed 35 checks; the unchanged Task Browser typecheck failed. After the review fix, full host validation passed **897 files and 7,747 tests**, with 18 skipped files, 100 skipped tests, and three expected failures. Root TypeScript, plugin-host/Storybook typechecks, lint and inventory also passed again. Logs are in `validation-final/` and `validation-post-review/`.

| Command group | Final result |
| --- | --- |
| `pnpm test --maxWorkers=3` | Passed after review fix: 897 files, 7,747 tests; skips and expected failures above. |
| `pnpm exec tsc --noEmit`, `pnpm plugin-host:typecheck`, `pnpm lint` | Passed. |
| `pnpm build` | Passed. All four emitted CSS assets parse without compatibility definitions/readers or dependency inputs. PDF.js private controls and native Tailwind `.collapse`/`select-*` utilities remain valid, not daisyUI evidence. `daisyui` does not resolve from the installed workspace. |
| SDK `test --maxWorkers=2`, `build`, `check:entrypoints`, `check:contract` | Passed, including fresh packed-package installation and production consumer rendering. |
| `pnpm exec vitest run packages/pr-review-ui --maxWorkers=2`, PR-review `check` | Passed. |
| Terminal runtime `test --maxWorkers=2`, `build`, `conformance` | Passed. |
| Five plugin packages: `test --maxWorkers=2`, `build`; GitHub Sync `typecheck` | Passed. |
| Task Browser `typecheck` | **Failed**, six TS2339 errors. Same failures reproduced against the starting commit with unchanged SDK source types and installed dependencies. |
| `pnpm build:plugins` | Passed. |
| Storybook `typecheck`, `build`, `coverage` | Passed: 225 covered, 46 explicitly excluded, zero uncovered/errors. |
| Inventory and development/production settings checks | Passed. |

### Baseline and limits

- The original root baseline had 12 failed, 885 passed, and 18 skipped files, including timeouts. `/tmp/KVG-4874-baseline.log` retains it. It was not counted as passing. Serializing heavy validation and limiting workers removed those failures on the intermediate full run; no unrelated product fixes were made.
- `pnpm i` ran first. A forced frozen installation timed out after 120 seconds; the subsequent `pnpm i --frozen-lockfile` completed. The separate packed-SDK consumer installation passed. Initial dependency build scripts for `@vgpu/adapter-node`, `esbuild`, and `webgpu` were ignored.
- Chromium/Storybook and compiled fixtures prove browser paint, not every Electron OS surface or signed-in remote integration. No packaged Electron smoke run, canonical screenshot approval, or repository-wide Rust/mobile/website run is claimed. Test-run skips and expected failures remain visible in the logs.
- KVG-5335 tracks the unused legacy badge helper reintroduced after KVG-4627. It has no callers and was not removed inline. KVG-5339 tracks the unrelated Task Browser typecheck failures. No follow-up task was started.

## Completion review

The single fresh-context reviewer requested changes for P2: bare `daisyui` imports and direct adapter stylesheet imports bypassed readiness. Module-loading AST nodes now cover static imports/exports, dynamic imports, CommonJS `require`/`require.resolve`, TypeScript module references, Svelte scripts, and stylesheet query suffixes. Ordinary package metadata and absence checks remain distinct.

Fifteen public CLI cases were added: thirteen failed before the fix, one subpath was already rejected, and the absence control already passed. After the fix, all 26 readiness tests passed; the combined inventory/readiness/semantic utility run passed 59 tests. Full host tests and affected static checks then passed again. No second review pass was launched. The original review report is retained in the subagent's managed output; this records the parent resolution, not a new reviewer approval.

## Independently revertible rollback

Preparation is separate: `ef8554ea6` migrates inventory/probes and `6ae540251` completes the semantic motion fixture. Revert only the later **Remove daisyUI compatibility layer** commit to restore the dependency, lockfile resolution, adapter/plugin blocks, resolver aliases, and prior global-presentation contract without undoing the completed component migrations or settings logic.

```sh
git revert <removal-commit>
pnpm i --frozen-lockfile
pnpm build:plugins
pnpm build
```

Then run host tests, SDK publication checks, inventory, settings/browser paint checks, and production bounds again. Do not repoint stable theme IDs, reset saved settings, or disable contributed CSS to conceal a rollback regression. Reverting the preparation commits is unnecessary and would undo unrelated migrated callers.
