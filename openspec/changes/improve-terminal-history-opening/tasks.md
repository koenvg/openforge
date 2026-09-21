## 1. Reproduction and test-first contract

- [ ] 1.1 Reproduce first opening of an existing task with a long-history fixture using the desktop terminal testing guide; record intermediate frames and baseline time to completed presentation, confirming whether mounted replay produces the reported scrolling before implementation.
- [ ] 1.2 Add failing terminal-view tests for concealment before replay, remaining concealed after parser completion but before final rendering, and revealing only after completed presentation; verify the new tests fail against current behavior.
- [ ] 1.3 Add failing integration coverage for historical-only snapshots, empty snapshots, images, and live output arriving during restoration; verify expected history retention and existing authoritative ordering alongside the presentation assertions.

## 2. Atomic restoration presentation

- [ ] 2.1 Add dimension-preserving concealment in the shared xterm view around snapshot replacement, retaining compatibility replay and continuation handling; verify the tests from section 1 pass and fitting still obtains nonzero dimensions while concealed.
- [ ] 2.2 Integrate completed-render readiness and replacement revision checks without conflating concealment with logical visibility; verify parser-only completion cannot reveal content and an obsolete replacement cannot reveal a newer one.
- [ ] 2.3 Cover hide, detach, disposal, reattachment, overlapping replacement, restoration failure, and successful retry with lifecycle tests, then implement cancellation/recovery handling; verify no pending wait strands recovery, stale completion reveals nothing, and the current attachment eventually becomes visible after successful recovery.

## 3. Affected-system validation

- [ ] 3.1 Run all terminal-runtime tests and static checks using `pnpm --filter @openforge-app/terminal-runtime test` and `pnpm --filter @openforge-app/terminal-runtime build`; run `pnpm --filter @openforge-app/terminal-runtime conformance` and applicable host contract checks from the testing guides, recording results and any unavailable prerequisites. Widen validation if implementation changes other subsystems.
- [ ] 3.2 Repeat the long-history browser reproduction with real xterm rendering and WebGL fallback; verify across intermediate frames that text and images stay concealed until the completed screen appears, history remains scrollable, live output continues, and empty terminals have no deliberate delay. Record before/after timings without claiming replay acceleration.
- [ ] 3.3 Validate the completed change with `openspec validate improve-terminal-history-opening --strict`, and update KVG-5196 Handoff Notes with user-facing results, verification gaps, and the separate KVG-5198 experiment; verify validation and the notes update succeed.
