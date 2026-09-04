# KVG-4520 handoff notes

## Scope completed

- Migrated the application canvas, sidebar, icon rail, project list, plugin sidebar links, task toolbar, task pane navigation, and agent status presentation to public SDK controls and semantic `--of-*` tokens.
- Replaced the toolbar's renderer-private menu with the public SDK `AnchoredMenu`. The public menu now restores trigger focus when it closes.
- Added a Svelte-aware inventory check for eight migrated files. It detects quoted classes, class directives, arrays, conditionals, templates, and object-form class expressions. Geometry exceptions are restricted by file, element, and marker class.
- Marked OpenSpec tasks 7.1 and 7.2 complete. No work from the remaining migration clusters was folded into this Task.

## Behavior and visual checks

- Focused renderer validation: 13 files and 154 tests passed for application startup, project navigation, shortcuts, sidebar controls, resizing, task toolbar, task navigation, and agent status.
- `ProjectSwitcherModal.test.ts`: 23 tests passed with a 20-second test timeout. Its default cold-compilation timeout remains tracked by cleanup Task KVG-4607.
- Full plugin SDK validation: 55 files and 366 tests passed.
- The inventory checker passed for all eight files; its four tests prove seeded daisyUI/fixed geometry detection, Svelte expression coverage, and occurrence-scoped layout exceptions.
- Development Electron checks covered built-in light and dark themes at 1440x900 and 1000x700. Both themes showed 3px control corners, a visible 2px focus outline, preserved sidebar and rail sizing, responsive horizontal overflow, and zero renderer console or page errors. Screenshots were temporary validation output and were not added to source control.

## Static and package checks

- `pnpm i`: passed before implementation; the lockfile did not change.
- `pnpm exec tsc --noEmit`: passed.
- `pnpm lint`: passed.
- `pnpm --filter @openforge-app/plugin-sdk build`: passed.
- `pnpm --filter @openforge-app/plugin-sdk run check:contract`: passed with clean npm and Bun consumers.
- `pnpm build`: passed.
- `node scripts/check-ui-migration-inventory.mjs`: passed.
- `git diff --check`: passed.
- `openspec validate add-angular-extensible-theming --strict`: passed.

## Review, gaps, and follow-up

A fresh-context review initially requested two changes: use the public `AnchoredMenu` instead of exposing a bindable SDK button element, and make the inventory check resistant to Svelte class-expression and allowlist bypasses. Both findings were resolved. The temporary `element` API was removed before handoff.

A full `pnpm test` attempt exceeded six minutes while several worktrees were running build-heavy suites concurrently. Before termination it reported one unrelated five-second CLI test timeout. The affected renderer and full plugin SDK suites above passed independently. No Rust, desktop IPC, database, or plugin-host contract changed, so Rust and Electron contract suites were not selected for this frontend-only slice.

Cleanup Task KVG-4607 tracks the cold-compilation timeout behavior in `ProjectSwitcherModal.test.ts`.
