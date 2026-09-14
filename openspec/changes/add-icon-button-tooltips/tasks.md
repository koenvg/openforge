## 1. Confirm integration points

- [x] 1.1 Inspect current Tooltip, IconButton, ButtonControl, their tests, SDK declaration/export contracts, and overlapping remove-daisyui/add-ui-storybooks work; record the composition seam and any overlap in design.md, verified against current source paths.
- [x] 1.2 Inventory host and built-in plugin icon-only action buttons, native titles, custom tooltips, and placement-sensitive locations; deliver a migration checklist with paths, chosen placement, and reasons for any opt-outs, and identify every affected subsystem.

## 2. Shared composition and automatic labels

- [x] 2.1 Add failing SDK tests for default label tooltips, reactive label updates, opt-out, title suppression, retained accessible names/descriptions, and exactly one button; verify each failure reflects missing behavior rather than test setup.
- [x] 2.2 Extract private shared tooltip composition and integrate IconButton with the additive tooltip configuration; verify task 2.1 tests pass and existing standalone Tooltip props, controlled state, callbacks, and trigger tests remain green.
- [x] 2.3 Add failing tests for hover delay, keyboard focus, hoverable content, dismissal, Escape inside menus/dialogs, click/keyboard/touch action dispatch, and event cancellation; implement the needed composition behavior and verify actions run once and Escape leaves the parent overlay open.
- [x] 2.4 Add failing tests for disabled/loading transitions and removal during pending/open states; implement closure and cleanup and verify no new focus stop, accidental activation, immediate dismissal-reopen, or orphaned tooltip remains.

## 3. Placement and motion

- [x] 3.1 Add browser behavior tests for each side, alignment, custom gap, collision fallback, clipped containers, and long-label wrapping; wire the IconButton positioning props through shared composition and verify tooltips fit while button geometry stays unchanged.
- [x] 3.2 Implement side-aware overshoot entry and short exit on inner content, retaining content through exit without affecting positioning transforms; verify opening, closing, collision-flipped motion, and rapid reopen in a browser, including no duplicate content.
- [x] 3.3 Implement reduced-motion handling and themed presentation; verify emulated reduced motion has no scale/slide/bounce and tooltip content is readable in supported themes.
- [x] 3.4 Update SDK component stories for defaults, opt-out, all sides, edge collisions, disabled/loading, and overlay use; compare normal-motion behavior with the TypeUI Overshoot reference and record visual approval or any remaining reference-access gap.

## 4. SDK contract and adoption

- [x] 4.1 Update public declarations and published-package coverage for the additive IconButton props and private composition assets; verify SDK build, entrypoint checks, published contract checks, and a plugin-side import fixture without host-internal imports.
- [x] 4.2 Migrate host icon-only action buttons according to the inventory, remove duplicate native/custom tooltip presentation, preserve useful label information and actions, and set placement where needed; verify focused consumer regression tests and complete every host inventory entry or document its opt-out.
- [x] 4.3 Migrate built-in plugin icon-only action buttons according to the inventory without unrelated UI changes; verify affected plugin tests/static checks and complete every plugin inventory entry or document its opt-out.

## 5. Integration validation

- [x] 5.1 Run full SDK validation with `pnpm --filter @openforge-app/plugin-sdk test`, `pnpm --filter @openforge-app/plugin-sdk build`, `pnpm --filter @openforge-app/plugin-sdk check:entrypoints`, and `pnpm --filter @openforge-app/plugin-sdk check:contract`; record results and prerequisite failures rather than claiming unrun checks passed.
- [x] 5.2 Run full affected renderer and migrated plugin validation using CONTRIBUTING.md and each affected package's scripts, including renderer `pnpm exec tsc --noEmit`, `pnpm lint`, and complete affected test suites; use directory-scoped Vitest runs where supported to avoid unrelated subsystems, and record exact commands, scope, skips, and gaps.
- [x] 5.3 Run browser integration checks with the required Storybook server active for a dense toolbar, a scrolling container, a dialog, and a menu; verify pointer/keyboard/touch activation, nested Escape, placement at window edges, rapid unmount, and normal/reduced motion. Record observable results rather than treating skipped browser suites as passing.
- [x] 5.4 Build and check affected stories using the repository's Storybook coverage and visual review guides; verify there are no unexpected control-layout changes and record any approved visual differences.
- [x] 5.5 Reconcile the migration inventory and spec scenarios with delivered tests, run `openspec validate add-icon-button-tooltips --strict`, and update task-scoped Handoff Notes with final user-facing changes, remaining gaps, and any genuine follow-up tasks.
