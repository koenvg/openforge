# Keep xterm authoritative in production terminal sessions

Status: accepted as the default mode; amended by [ADR 0006](0006-ghostty-authoritative-terminal-mode.md)

Date: 2026-08-25

## Context

ADRs 0001 through 0003 describe a planned move toward sidecar-owned parsed terminal state, portable snapshots, sequenced model frames, and sidecar-generated protocol replies. The compatibility work is not complete. Shipping parts of that design behind the legacy Ghostty terminal-state setting created an unsafe mixed mode: renderer behavior, setting state, or snapshot API availability could decide which parser supplied state and which parser answered terminal queries.

OpenForge currently has two desktop terminal paths. Agent terminals use the core renderer Terminal Runtime. Regular shells use the built-in Terminal plugin and the same runtime package. Both render through xterm. A Rust Ghostty model may inspect the same PTY bytes for diagnostics, but it has not passed the transition gates required to own production state or replies.

Two parsers may inspect a query. Only one may reply. A reply also has to remain bound to the PTY generation that produced the query.

## Decision

OpenForge will run in an explicit `xterm-authoritative` mode.

For every live Shell Session Key and PTY instance:

- xterm is the only parsed-state owner.
- xterm is the only component allowed to generate terminal query responses.
- the Rust PTY byte buffer is the replay owner.
- there is no terminal snapshot owner or desktop snapshot route.
- the Ghostty model is diagnostic only. It may observe bytes, record bounded diagnostics, and create internal test snapshots. It may not emit replies, publish replay frames, or supply view state.

TypeScript and Rust each encode this decision in a `TerminalAuthorityContract`. Terminal Runtime binds the contract to a Shell Session Key and PTY instance. It does not select authority from a renderer factory, feature setting, or optional host method.

Terminal Runtime sends keyboard input and generated query responses through different boundaries. Generated responses include the source PTY instance. Rust verifies the Shell Session Key and instance before its ordered writer accepts the response.

Terminal Runtime reaches replay, output, PTY exit, input, generated responses, resize, and connection-restored signals through `TerminalTransport`. Desktop IPC and Trusted Plugin capability adapters translate their lower-level event names and payloads into that interface. The seam cannot select parsed-state, replay, snapshot, or query-response authority.

Replay responses also include the live instance. Terminal Runtime captures the expected instance before a replay request and discards the result if PTY replacement occurs before completion. Raw output and exit events already carry the instance and remain subject to the same generation check.

The full paths are recorded in `docs/terminal-state-and-response-paths.md`.

## Consequences

xterm remains the only production renderer and parser. Existing keyboard, IME, mouse, image, link, selection, and query-response behavior stays on the established path.

The sidecar still owns PTY processes and raw replay buffers, but it does not own parsed terminal state. A renderer restart cannot reconstruct exact xterm state from a model snapshot in this mode. It reconstructs from the bounded PTY byte replay.

The Ghostty terminal-diagnostics setting may enable diagnostic modeling. It cannot change authority. Diagnostic model failure cannot reset xterm, change replay, or disable terminal query responses.

OpenForge no longer exposes a desktop command for terminal-view snapshots. Internal Ghostty snapshots are not a compatibility contract.

## Transition requirements for sidecar authority

A sidecar model cannot become authoritative through an implicit flag flip or optional snapshot method. Any opt-in contract must land as one reviewed change that does all of the following:

1. Add a new authority-contract variant naming the sidecar parsed-state owner, replay owner, snapshot owner, and query-response owner.
2. Give each newly created Terminal Session that contract at spawn time. Existing sessions keep their original contract until they end.
3. Remove xterm-generated responses from the PTY write path for those sessions before enabling sidecar replies.
4. Route sidecar replies through the same Shell Session Key and PTY-instance checks and one ordered writer.
5. Define the snapshot and live-frame protocol, including an atomic watermark and generation checks.
6. Prove query parity, partial-sequence behavior, reconnect, replay, concurrent attachment, model-failure isolation, PTY replacement, images, IME, accessibility, and full-screen TUI behavior against xterm.
7. Update this ADR and the terminal path document in the same change.

ADR 0006 introduces the reviewed contract for experimental opt-in sessions. `xterm-authoritative` remains the default until the compatibility gates are complete.
