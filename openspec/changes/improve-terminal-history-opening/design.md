## Context

See proposal.md for motivation. The user reports first opening an existing task with output history, not starting an empty shell. Source inspection identifies a plausible path; the symptom has not yet been reproduced or timed locally.

`terminalViewAttachmentCoordinator.ts` mounts the view and observes visibility. `terminalSessionCoordinator.ts` fits the visible attachment before restoring authority. `xtermTerminalView.ts` resets xterm, parses compatibility replay, cancels unfinished replay input, applies portable screen state, and restores parser continuation. These writes are asynchronous and the mounted contents are not concealed. Image restoration tests demonstrate why compatibility replay cannot simply be removed.

`xtermPresentation.ts` already distinguishes parser completion from a subsequent render frame and rejects pending presentation drains on detach/disposal. Logical attachment visibility also controls live-output subscription and recovery, so visual concealment must not reuse that switch.

## Goals / Non-Goals

Goals:
- Make snapshot replacement a visually atomic operation while retaining existing transport and state authority.
- Keep restoration measurable and renderable while concealing incomplete contents.
- Reject stale reveal work without changing PTY liveness or releasing session resources.

Non-goals:
- Faster history fetching/parsing, incremental history transport, history truncation, renderer replacement, or dependency upgrades.
- A new loading overlay or arbitrary delay. During first restoration, retain the terminal-sized background without animated history playback.
- Changes to ordinary live-output presentation or shell startup semantics.

## Decisions

### Own concealment in the shared terminal view

Use a view-local presentation gate around snapshot replacement. Conceal before reset or queued historical writes can paint, preserve the host dimensions, and cover every terminal visual layer, including images. Keep the host mounted and logically visible so fitting, rendering, and recovery can proceed. Do not use `display: none`, unmounting, or the runtime visibility switch as a loading mechanism. A dimension-preserving opacity-based gate is the proposed implementation; verify actual xterm and image rendering in a browser.

Applying this in `xtermTerminalView.ts` avoids per-task or plugin-specific state and naturally covers historical-only and live-session snapshots. It also prevents playback during later authoritative replacements through the same path. Ordinary live writes do not enter the gate.

Alternative: hide the entire task pane until acquisition finishes. Rejected because it entangles resource lifecycle with presentation, can invalidate fitting, and duplicates behavior across consumers.

### Reveal only a completed render for the current replacement

Retain the existing compatibility replay, portable state, continuation, and watermark ordering. After the final write callback, request and await completed presentation using the existing presentation controller rather than a timer. Only then reveal. Concealment must not make `canPresent` false or otherwise prevent the render needed to complete the drain.

Use a replacement revision owned by the view to prevent an older asynchronous completion from revealing a newer reset or replacement. Invalidate it on unmount and disposal, and preserve existing attachment/visibility-generation checks in the coordinator. Do not unconditionally reveal in `finally`. Hidden/detached views must not wait forever for a paint: cancel their pending presentation wait and let existing recovery restore the current attachment on return. A failed replacement stays concealed and propagates failure through the existing recovery path; a successful retry can reveal it. Do not leave controls or focus permanently disabled after success.

Alternative: reveal after parser callbacks alone. Rejected because parsing does not prove a final rendered frame. Arbitrary animation delays similarly cannot establish readiness.

### Preserve state rather than shorten replay

No filtering or truncation of historical bytes, and no private xterm buffer manipulation. Keep inline-image restoration and parser continuation intact. Live output remains ordered behind restoration by the authority coordinator; presentation readiness must not allow stale PTY output to bypass that ordering.

Screen-first restoration with incremental scrollback is tracked in KVG-5198. Its experiment must resolve Ghostty binding support and the xterm history-prepending problem before proposing production changes.

## Risks / Trade-offs

- Replay still takes time. Mitigation: explicitly describe this as removal of visible playback, record before/after timings, and leave actual speed improvements to KVG-5198.
- Concealment can suppress painting or visibility observation. Mitigation: retain geometry and logical visibility; prove final-render completion with a real renderer, including WebGL fallback.
- Stale completion or detach can cause flashes or a permanently blank view. Mitigation: revision checks, cancellation tests, and successful recovery/retry tests.
- Images can render on a different layer. Mitigation: conceal the whole terminal rendering subtree and include image restoration in browser verification.
- A single final screenshot can miss earlier playback. Mitigation: observe frames during a multi-frame replay fixture and assert that no intermediate historical screen is exposed.

## Migration Plan

No persisted data or backend migration. Deploy as a terminal-runtime change after full package validation and a first-open browser reproduction. Rollback reverts the presentation gate without altering saved history or session state.
