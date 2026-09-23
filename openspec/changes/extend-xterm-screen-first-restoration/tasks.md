## 1. Isolate the experiment and establish its inputs

- [ ] 1.1 Confirm the two public test seams in design.md with the user and record the approved interface and scope in the experiment README; verify that it excludes production integration and changes to KVG-5198's worktree.
- [ ] 1.2 Create the isolated xterm 6.0.0 source manifest, license, patch/build recipe and experiment runner under `scripts/experiments/xterm-screen-first/`; verify a reproducible stock build first and confirm root manifests, lockfile and shared `node_modules` are unchanged.
- [ ] 1.3 Add an experiment-local pinned Ghostty exporter for a small frozen snapshot, current screen/continuation and attributed history pages; verify against hand-authored expected rows and document whether required pinned APIs expose styles, wrapping, links and image state. Stop and record a no-go if the minimum screen/history data cannot be exported within scope.
- [ ] 1.4 Define bounded versioned payloads and restoration/page identities with validation tests; verify malformed rows, invalid references, oversized data and unsupported versions are rejected without mutating a terminal.

## 2. Prove screen-first restoration through the public interfaces

- [ ] 2.1 Write a failing adapter test that withholds every history page, then implement bounded screen-only restoration; verify that the expected current screen is presented and input is accepted while history completion remains pending.
- [ ] 2.2 Write a failing public-interface test for one older parsed page, then implement the xterm history-import patch and adapter call; verify history becomes scrollable without changing current screen cells, cursor, modes or parser state and without application access to private xterm fields.
- [ ] 2.3 Add one interleaving slice for queued and newer live writes, including split CSI and UTF-8; verify imports preserve continuation, contiguous output appears before full history completion, and no history import emits PTY input or replies.
- [ ] 2.4 Add duplicate, out-of-order, missing and stale page/output cases; verify rows are not duplicated, invalid identities do not mutate state, sequence gaps trigger fresh-authority recovery, and completion accounts for the accepted retained range.

## 3. Preserve scrolling and buffer semantics

- [ ] 3.1 Add bottom-follow and scrolled-up reading cases, then implement anchor preservation; verify that page arrivals retain the same logical content while ordinary live output follows the documented scroll policy.
- [ ] 3.2 Add full-buffer and live-trimming cases, then implement capacity-aware atomic import; verify older pages cannot overwrite newer retained rows, cursor state or the live screen and that retention omissions are reported explicitly.
- [ ] 3.3 Add selection, copy, marker and hyperlink cases across imported/existing rows; verify retained selections copy the same expected text and links/markers remain attached to the intended content after insertion and trimming.
- [ ] 3.4 Add styled Unicode, wide/combining cells and soft-wrapped lines crossing page and screen boundaries; verify display and copied logical text against independent expected rows, including normal reflow after import.
- [ ] 3.5 Add resize-during-loading cases and implement geometry-generation cancellation/restart; verify old-width pages cannot apply and a fresh restoration reaches the complete resized reference rather than marking skipped pages complete.

## 4. Exercise lifecycle and compatibility gates

- [ ] 4.1 Add cancellation, hide/detach/reopen, disposal and PTY replacement cases; verify late page/reveal work cannot mutate or focus a successor, valid reopening works, and no presentation operation changes PTY liveness.
- [ ] 4.2 Add alternate-screen restoration and primary-buffer history import cases; verify the active alternate screen stays intact and returning to the primary screen restores expected history and saved state.
- [ ] 4.3 Test an explicit image asset/placement import contract with the pinned image addon, adding an experiment-local addon patch only if needed; verify image pixels, placement, trimming and disposal without historical VT replay, or deliver a tested unsupported outcome and mark production adoption no-go.
- [ ] 4.4 Run early browser checks in the user's existing Arc session for the small working prototype, including input, scrolling, selection, intermediate-frame capture and WebGL unavailable/context-lost cases; verify real presentation rather than mock callbacks, and record any unavailable browser coverage as a blocker.

## 5. Benchmark, validate and report

- [ ] 5.1 Extend the isolated harness with the existing long-history fixture bytes and smaller matched text/Unicode/image cases, controlled page delivery and stage tracing; verify fixture hashes, equal geometry/retention, independent expected screen/history, sampling before decode, and separate export versus browser timings.
- [ ] 5.2 Run at least five comparable baseline/candidate trials for each supported renderer path and multiple history sizes; deliver all timings, medians, bytes before readiness, full-history results, input latency, frame stalls and memory observations, explicitly separating unsupported/fallback runs and unmeasured metrics.
- [ ] 5.3 Run all experiment test/static-check scripts and the full affected patched-xterm test/static-check suite, plus tests, format checks and Clippy for any standalone native exporter; verify the stock Terminal Runtime with `pnpm --filter @openforge-app/terminal-runtime test` and `pnpm --filter @openforge-app/terminal-runtime build`, and report scope, skipped checks and external blockers.
- [ ] 5.4 Deliver the findings report, reproducible commands, compact evidence and patch-maintenance/upstreamability assessment; verify every spec scenario is mapped to passed evidence, an explicit unsupported outcome or an unresolved failure, and recommend go only when all compatibility and performance gates pass.
- [ ] 5.5 Complete the required single fresh-context implementation review and resolve blocking findings with affected checks rerun; verify the complete diff stays experiment-local, update task-scoped Handoff Notes, and leave production integration and any upstream publication for a separately approved change.
