## Why

First opening a task can visibly scroll through old output. OpenForge's existing concealment fix hides snapshot replay but still rebuilds xterm from historical bytes; this experiment tests whether extending xterm can make the current screen usable before older history loads, without replacing the renderer or losing terminal behavior.

## What Changes

- Build an isolated, reproducible extension of pinned xterm 6.0.0 with a public operation for importing older, already-parsed history ahead of the live screen. OpenForge callers must not manipulate xterm private fields.
- Add an experimental screen-first restoration adapter that restores the current screen and required terminal state, then imports history pages independently of later live output.
- Preserve the live screen, scroll anchor, selection, wrapped rows, styles, links, parser continuation and PTY identity. Exercise images, alternate screens, retention limits, resize, cancellation and stale pages as explicit compatibility gates.
- Compare the extension with the current concealed-replay path using the same fixture bytes, geometry and retention policy. Measure first correct usable screen, complete history, input responsiveness and memory; record failures and unsupported cases rather than reporting a screen-only demo as success.
- Deliver a maintained-patch/upstream-contribution recommendation and a go/no-go report. A successful experiment does not enable the extension in production.

## Capabilities

### New Capabilities

- `xterm-screen-first-restoration`: An experimental xterm restoration interface that presents the current screen before importing older history, with ordering, viewport stability and evidence requirements.

### Modified Capabilities

None. Production `terminal-session-coordination` requirements and the existing replay path remain unchanged.

## Impact

- Planned implementation home: `scripts/experiments/xterm-screen-first/`, containing the pinned source/build recipe, experiment-local patch, adapter, fixture exporter, tests and browser harness. Generated builds and raw evidence belong under ignored `artifacts/xterm-screen-first/`; a concise findings report belongs in the experiment directory.
- Reuse the fixtures and measurement definitions from `scripts/experiments/terminal-restoration/` and the existing Terminal Runtime conformance behavior. Read-only references include `xtermTerminalView.ts`, `terminalAuthorityCoordinator.ts`, `xtermPresentation.ts` and the pinned Ghostty snapshot bindings.
- No root dependency or lockfile changes, production renderer selection, IPC or persistence migration, changes to live PTY ownership, or edits in KVG-5198's worktree. Any need to cross those limits requires a separate proposal or explicit scope approval.
- KVG-5198 is parallel screen-first/native-renderer feasibility work. This change tests the distinct xterm-extension route and does not claim its unpublished results as verified evidence.
