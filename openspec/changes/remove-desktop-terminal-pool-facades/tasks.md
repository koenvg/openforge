## 1. Lock in ownership behavior

- [x] 1.1 Add or revise a Terminal Session Service boundary test proving the agent and regular clients share one acquired runtime entry while releasing one owner does not release the other owner's session; run the focused test and confirm it fails for any collapsed ownership implementation.
- [x] 1.2 Add a test proving `desktopTerminalSurfaceAdapter.runtime` is the regular-terminal client, not the agent client; run the focused adapter or task-detail test and confirm it detects the current incorrect owner.

## 2. Migrate production callers

- [x] 2.1 Migrate agent Terminal Surface components, session actions, lifecycle helpers, and desktop event listeners to qualified `agentTerminalSessions` calls; run the affected agent terminal, task session action, and event-listener tests.
- [x] 2.2 Migrate the desktop Terminal Surface adapter and task-detail regular-terminal lifecycle to `regularTerminalSessions`; run the TaskTerminal, TerminalTabs, TerminalTaskPane, and TaskDetail lifecycle tests.
- [x] 2.3 Move terminal contract type imports to `@openforge-app/terminal-runtime` and route development probe observation through the host composition root; run the terminal probe and TypeScript checks for the affected files.

## 3. Replace facade-coupled tests

- [x] 3.1 Update component mocks, shared test helpers, and dynamic imports to provide explicit agent and regular client doubles; run the affected component suites and verify each helper resets both clients.
- [x] 3.2 Replace practical desktop `_getPool()` assertions with `hasTerminal`, acquisition identity, lifecycle getters, release counts, disposal spies, or unlisten spies; run the renamed terminal lifecycle, attachment, input, and reconnect suites.
- [x] 3.3 Review terminal-runtime package `_getPool()` assertions and replace those that public Terminal Runtime behavior can prove, retaining direct inspection only for otherwise unobservable internal transitions; run the terminal-runtime acquisition, reconnect replay, and session service integration tests.
- [x] 3.4 Rewrite facade identity and source-text boundary tests as behavioral runtime-sharing, owner-release, and plugin-injection checks; run the Terminal Session Service boundary and plugin shared-implementation tests.

## 4. Remove compatibility modules

- [x] 4.1 Delete `src/lib/terminalPool.ts`, `src/lib/liveTerminalPool.ts`, and tests that only assert their forwarding identities; verify a repository search finds no production, test, mock, or dynamic-import reference to either deleted desktop module path.
- [x] 4.2 Update `docs/terminal-session-service-migration.md` to record consumer cleanup and desktop facade removal while preserving the built-in plugin facade distinction; verify the document matches the final import boundaries.

## 5. Validate the affected systems

- [x] 5.1 Run the focused renderer and terminal-runtime terminal suites and verify all ownership, lifecycle, attachment, reconnect, probe, component, and plugin-boundary tests pass.
- [x] 5.2 Run `pnpm --filter @openforge-app/terminal-runtime test`, `pnpm test`, `pnpm exec tsc --noEmit`, and `pnpm lint`; report any skipped check or residual coverage gap and verify `git status --short` contains only intended implementation and planning changes.
