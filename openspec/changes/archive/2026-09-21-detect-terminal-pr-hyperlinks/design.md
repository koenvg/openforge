## Context

See proposal.md for motivation and specs/terminal-pr-hyperlinks/spec.md for the behavior contract. The user confirmed that the reported PR label was clickable; no raw recording of that session was supplied. Standard seven-bit OSC 8 encoding is the supported target for this change.

`task_pr_discovery/detector.rs` currently uses numeric escape states and skips OSC and DCS payloads before visible URL parsing. Its candidate parser accepts HTTP/HTTPS github.com PR URLs, and its recent-candidate cache deduplicates 128 canonical identities for 30 seconds. `local.rs::OutputObserver` submits candidates through the existing asynchronous discovery coordinator and resets the detector on gaps or invalid origins. The local shell integration test already proves first-link discovery without an attached terminal view.

The active `link-task-pull-requests-from-events` design deliberately rejects unsupported escapes. OSC 8 becomes a narrow supported exception. The user approved completing its missing daemon integration during implementation. When rebasing onto main, PR #2549 supplied that prerequisite upstream. Keep the upstream inventory-based `DaemonOutput` adapter and port hyperlink regressions to it rather than retaining a second implementation. Unrelated identity and reconciliation work remains outside this change.

## Goals / Non-Goals

**Goals:**
- Extend the shared streaming detector rather than add provider-specific or renderer parsing.
- Keep hyperlink framing distinct from visible text and reuse existing canonical candidate emission.
- Preserve bounded memory, linear scanning, reset behavior, and asynchronous verification.

**Non-Goals:**
- Inferring repositories from `#2549`, parsing rendered screens, or changing provider prompts.
- Scanning arbitrary terminal metadata or implementing a general terminal emulator.
- Supporting C1 eight-bit OSC/ST controls, new Git hosts, new URL schemes, or new URL path forms.
- Changing lifecycle fallback, polling, persistence, transport ownership, or UI contracts.

## Decisions

### Recognize OSC 8 framing in the existing detector

Use explicit parser states to distinguish visible text, existing CSI handling, OSC command/parameters/target, discarded control strings, and a pending ESC terminator. Accept `ESC ] 8 ; params ; URI BEL` and `ESC ] 8 ; params ; URI ESC \\`. Match command 8 exactly. Parameters are opaque and optional; they are never candidate text. An empty URI closes a link and emits nothing.

Emit a candidate when the opening sequence terminates, not when the label or closing sequence arrives. Preserve state across all byte splits, including the two-byte ESC-backslash terminator. Do not interpret a hyperlink terminator as a boundary that completes a partial visible URL. Clear or invalidate visible carry when entering control strings so hidden and visible fragments cannot join.

A regex over each chunk would miss split framing and risk matching URLs in unrelated OSC commands. A terminal emulator dependency would add scope without helping verification.

### Share URL validation and duplicate suppression

Pass only the completed target through the existing structured owner/repository/number parsing and candidate emission path. Keep the accepted GitHub host, schemes, query/fragment handling, canonicalization, and downstream verification unchanged. Share the recent cache across visible URLs and hyperlink targets, rather than introducing a second deduplication path.

No GitHub requests run inside parsing. The opening target is an untrusted hint even if its label claims the PR belongs to the task. The existing discovery coordinator, verifier, guarded persistence, and event publication remain authoritative.

### Bound and isolate control payloads

Limit retained hyperlink payload to 2 KiB including command, parameters, and URI, excluding introducer and terminator. Once oversized or malformed, discard through the control-string terminator without retaining further payload bytes. Unsupported OSC commands and DCS remain skipped. Unexpected controls within an OSC 8 payload invalidate that candidate; an embedded escape cannot start a nested candidate within a discarded string.

At a valid terminator, reset control-string state so later valid links can be recognized. An unterminated string remains ignored with constant bounded memory until a terminator or existing observer reset. Reset clears all in-progress hyperlink framing along with current detector state. Never repair a malformed target by stripping arbitrary controls.

This favors missed malformed links over fabricated PR candidates. Completion and reconciliation remain fallback discovery paths.

### Connect live daemon output without scanning replay

Use the upstream `task_pr_discovery/daemon.rs::DaemonOutput` adapter owned by the transport. Attribute output from current inventory ownership, working directory, and complete daemon PTY identity, never from printed text or parsed session keys. Task agents and task shells use the existing local registry and verifier; project-only and review-only identities fail closed through the task/workspace checks.

Keep a shared observer and sequence high-water mark per attributed PTY. Consume only current inventory-matched live output. Ignore duplicate/older sequences and event cursors, reset parser carry on noncontiguous sequences, journal gaps, and recovery signals. Disconnect invalidates origins; reconnect resumes at the current inventory cursor without scanning accumulated history. Replacement, removal, and teardown also invalidate origins; normal exit stops parsing while preserving queued verification under upstream completion rules.

Use raw output bytes so chunked UTF-8 decoding cannot invent ASCII boundaries. Parsing submits into the existing bounded nonblocking discovery queue. No database or GitHub access runs in the polling lock. Test the adapter with real discovery fixtures and a live daemon contract case that keeps the shell running until the PR is linked.

### Test observable candidate and association outcomes

Add detector tests for both terminators, empty and nonempty parameters, a short label, every split position, opening-only emission, empty close, visible/hidden duplicates in both orders, malformed and oversized payloads, unsupported hosts, unrelated OSC/DCS, and recovery. Keep current visible/colorized URL regressions.

Extend existing discovery/PTY fixtures rather than starting a second mock stack. Prove a hidden target can link a first PR and publish the existing update event without completion or polling. Exercise shared observer reset and stale-origin rejection, plus local and daemon delivery coverage where their current fixtures accept raw output. A mismatched branch/repository must still fail verification. Assert candidates, persisted rows, events, and request counts rather than private parser states.

## Risks / Trade-offs

- Hidden metadata could become a false-positive source. Match OSC 8 framing exactly, isolate payloads, and retain GitHub verification.
- Chunk boundaries could truncate PR numbers or terminators. Test every split position and byte-at-a-time delivery.
- A malformed sequence could poison subsequent output. Test bounded discard and recovery at terminators, plus gap/reset handling.
- The original terminal bytes are unavailable. Standard OSC 8 coverage addresses the confirmed clickable-label case; a different encoding would require a separate observed reproduction.

## Migration Plan

No schema migration, dependency change, or feature flag is needed. Ship the shared detector update and regressions together. Rollback restores the previous parser; persisted associations remain ordinary verified PR records.

Implementation validation uses focused detector/discovery/PTY tests first, followed by full Rust sidecar `cargo test`, `cargo check`, `cargo build`, and `cargo clippy` from the crate root resolved by `scripts/rust-sidecar-layout.mjs`, per CONTRIBUTING.md. Run applicable terminal transport checks if adapter code changes. Renderer and terminal-runtime package suites are not required unless their code or contracts change. Planning validation is `openspec validate detect-terminal-pr-hyperlinks --strict` only.
