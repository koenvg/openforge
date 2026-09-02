## 1. Characterize label ordering

- [x] 1.1 Add failing `taskLabels` unit tests for descending Backlog count, alphabetical tie-breaking, zero-count exclusion, and recalculation from changed counts; verify `pnpm test src/lib/taskLabels.test.ts` fails on the new ordering assertions.
- [x] 1.2 Add a failing Focus Board behavior test that opens the label dropdown and checks count-first, alphabetical option order without selected labels being promoted; verify `pnpm test src/components/focus-board/FocusBoard.filtering.test.ts` fails on the new order assertion.

## 2. Implement count-first ordering

- [x] 2.1 Update the pure Backlog label derivation helper to return positive-count labels sorted by descending count and then `localeCompare` by name without mutating its input; verify `pnpm test src/lib/taskLabels.test.ts` passes.
- [x] 2.2 Confirm the reactive Focus Board derivation feeds the ordered labels to the dropdown and preserves selection and filtering behavior; verify `pnpm test src/components/focus-board/FocusBoard.filtering.test.ts src/components/focus-board/BacklogLabelFilterDropdown.test.ts` passes.

## 3. Validate the renderer change

- [x] 3.1 Run `pnpm lint` and `pnpm exec tsc --noEmit`; resolve any issues caused by the change and verify both commands pass.
