## 1. Dependency readiness logic

- [x] 1.1 Add failing unit tests for ready-to-start classification with no dependencies, completed dependencies, unfinished dependencies, and unresolved dependency references; verify the focused `taskDependencies` test fails for the missing behavior.
- [x] 1.2 Add the reusable ready-to-start predicate beside the existing dependency helpers and verify the focused `taskDependencies` test passes.

## 2. Ready-to-start control

- [x] 2.1 Add failing component tests for the compact toggle's visible label, ready count, click callback, keyboard operation, `aria-pressed` state, and non-color active indicator; verify the focused component test fails for the missing control.
- [x] 2.2 Implement the focused Backlog ready-to-start toggle using the existing filter-control styling and semantic theme tokens; verify its focused component test passes.

## 3. Focus Board filter integration

- [x] 3.1 Add failing Focus Board filtering tests for Backlog-only control visibility, ready counts, tasks with completed dependency references, unfinished and unresolved dependencies, composition with label and text filters, task-selection reset, and no-match recovery; verify the focused Focus Board tests fail for the missing behavior.
- [x] 3.2 Add failing lifecycle tests that cover same-project remount restoration and project-switch clearing of the readiness selection; verify the focused Focus Board tests fail for the missing state handling.
- [x] 3.3 Add project-scoped readiness state and readiness-derived values to the filter controller, compose the constraint with existing Backlog filters, and verify the focused controller and Focus Board filtering tests pass.
- [x] 3.4 Render the readiness toggle in the Backlog filter bar, keep the bar available for filtered no-match recovery, preserve the text-filter message, and distinguish filtered results from a genuinely empty Backlog; verify all focused Focus Board and toggle tests pass.

## 4. Renderer validation

- [x] 4.1 Run the full affected renderer test and static-check suite with `pnpm test`, `pnpm exec tsc --noEmit`, and `pnpm lint`; verify every command exits successfully and record any remaining validation gap.
