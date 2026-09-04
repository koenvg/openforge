## 1. Characterize the dropdown behavior

- [x] 1.1 Add failing Focus Board integration tests for Backlog-only dropdown visibility, absence when no labels are available, unchanged top-level board controls, label names and counts, and removal of the former inline chip group; verify `pnpm test src/components/focus-board/FocusBoard.filtering.test.ts` fails for the missing dropdown behavior.
- [x] 1.2 Add failing component interaction tests for checked option state, immediate OR filtering callbacks, selected-count feedback, keeping the menu open across toggles, and clearing all selections; verify the focused dropdown test fails for the missing component.
- [x] 1.3 Add failing keyboard tests for initial option focus, checked-menu-item operation, Escape dismissal, and trigger-focus restoration; verify the focused dropdown test fails for the missing keyboard behavior.

## 2. Implement the Backlog label dropdown

- [x] 2.1 Extend the shared anchored menu's initial-focus handling to recognize ordinary, checkbox, and radio menu item roles without changing existing dismissal behavior; verify the focused dropdown and existing context-menu tests pass.
- [x] 2.2 Add the dedicated Backlog label-filter dropdown with an informative trigger, selected count, checked label options, per-label Backlog counts, persistent open state during selection, and a bounded scrolling menu; verify its component tests pass.
- [x] 2.3 Replace only the inline Backlog label chip group in `FocusBoard.svelte` with the dropdown, wiring it to the existing controller toggle and task-navigation reset while leaving the top-level board filters and controller/store semantics unchanged; verify `pnpm test src/components/focus-board/FocusBoard.filtering.test.ts` passes.
- [x] 2.4 Update the existing remount, project-switch, delayed-label, OR-semantics, and zero-count-pruning tests to interact through the dropdown and verify their behavior remains unchanged with the focused Focus Board suite.

## 3. Validate the renderer change

- [x] 3.1 Run the affected Focus Board, dropdown, and shared menu test files together and verify they all pass.
- [x] 3.2 Run `pnpm exec tsc --noEmit` and verify the renderer type-check completes without errors.
