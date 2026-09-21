## Context

See proposal.md for motivation and the delta spec for acceptance behavior. The live daemon's capacity counters have not been captured. The user reports that output appears to continue when typing fails.

Observed implementation:
- `session-host/src/types.rs` defaults to 1,024 ordinary operation receipts and a separate cleanup reserve.
- `session-host/src/state.rs::begin` retains requests and results in one map, rejecting both count and byte exhaustion. `finish` records outcomes without removing requests. Exit-history trimming deliberately preserves receipts.
- `session-host/src/io.rs::ordered_io` sends writes and resizes through that same admission path, before advancing per-PTY input sequence numbers.
- `session-client/src/operations.rs` uses stable operation identities for retries and explicitly avoids automatic replay of unknown input outcomes.
- `session-daemon/src/host.rs` exposes count and byte limits in inventory. Generic protocol capacity errors obscure which limit refused a request.
- Checkpoints preserve operation history. A restart or replacement is not an acceptable routine way to reclaim it.

The existing `preserve-sessions-across-updates` work overlaps daemon replacement and retry contracts. This change must preserve its ownership, checkpoint, and unknown-outcome guarantees rather than introducing a second terminal control path.

## Goals / Non-Goals

Goals:
- Bound retry storage by unresolved/recent operations, not cumulative app usage.
- Keep retry admission and retirement in the Rust control path, independent of renderer attachment lifetimes.
- Preserve exact retry results while retained and prevent re-execution after retirement.
- Make forward progress possible when the ordinary mutation window is full.

Non-goals:
- Guarantee successful admission under genuinely unbounded unresolved requests or exhausted PTY resources.
- Replay uncertain keystrokes, terminate sessions to make room, increase limits as the fix, or redesign rendering.
- Mutate or restart the user's running app during diagnosis or validation.

## Decisions

### Use an acknowledged ordered operation window

Introduce a negotiated operation-stream identity and monotonically increasing operation ordinal alongside existing stable operation identity and PTY I/O sequence. The authenticated Rust client owns allocation across all mutation kinds. The host stores a retired-through ordinal plus bounded outstanding receipts. Operation identity includes or is bound to stream and ordinal, preventing reuse at another ordinal.

Clients acknowledge a contiguous prefix only after consuming definitive results and releasing their ability to retry those requests. The host validates the acknowledgement against admitted, settled work before removing records and subtracting retained bytes. Repeated acknowledgements are idempotent; acknowledgements beyond admitted or unresolved work are rejected. Lost acknowledgements are retried. Batched acknowledgements avoid a round trip per keystroke; flush before capacity pressure and while idle.

Requests at or below the retired boundary are rejected before execution. Requests still retained preserve payload-conflict detection and exact recorded outcomes. Unknown outcomes remain pinned until explicitly reconciled or the stream is fenced. A missing ordinal cannot be silently skipped. Per-PTY sequencing remains separate and authoritative for input ordering.

This requires a protocol change. A TTL or LRU alone is unsafe for spawn and other non-idempotent requests because a forgotten operation could execute again. Merely excluding I/O would leave lifecycle history exhausted eventually. Keeping every operation identity as a tombstone would still grow without bound.

### Keep retirement outside ordinary mutation admission

Acknowledgement and stream reconciliation are authenticated control operations, not entries in the full mutation ledger. Bound their message sizes and validate controller ownership. Preserve a bounded termination reserve for genuine resource pressure. Make counter updates atomic under the host state lock.

A blocked unresolved prefix causes explicit backpressure rather than unsafe eviction. Normal acknowledged use continually retires history, including spawn and termination receipts. This bounds retained payloads as well as receipt counts.

### Fence old streams on controller transfer

A reconnect that retains client state reconciles its stream and retries existing identities. An authoritative controller transfer fences the previous stream before admitting a new one. Inventory provides live PTY identity and next input sequence so clients do not infer them from receipt eviction.

Do not reissue unresolved old mutations with fresh identities. Expose unknown outcomes and reconcile actual live ownership first. Old stream requests remain invalid through a bounded current-generation fence, not an ever-growing set of tombstones. Retain only the bounded transition state needed to resolve the handoff; refuse an unsafe transition explicitly.

### Persist the retry boundary with checkpoint state

Checkpoint the active stream, retirement boundary, ordinal allocation/admission state, retained receipts, PTY sequences, and any unresolved transition together. Validate consistency and limits on restore. Extend checkpoint/version capability handling in host, protocol, client, and daemon as one change.

A compatible replacement preserves both safety and reclaimed capacity. Do not deserialize a new checkpoint into old code by dropping unknown safety fields.

### Upgrade legacy daemons on attachment

On attachment, negotiate receipt retirement before sending new terminal mutations. If the installed daemon lacks it, automatically attempt its supported prepare/commit in-place executable replacement using the selected app's daemon image. For packaged builds, stage the verified release first and retain its lease through replacement. Reconnect and reconcile the preserved PTYs before opening the new operation stream. This rollout policy was explicitly approved during implementation.

Use a deterministic maintenance operation identity for the selected image so an interrupted attachment can resolve the same replacement rather than filling the maintenance history with retries. Capability refusal, incompatible state, or uncertain activation must leave existing sessions untouched and return an actionable error. Never kill the daemon, create a second owner, or silently fall back to legacy mutation retention.

### Keep preflight hashing within the existing deadline

The approved preflight follow-up found that unoptimized software SHA-256 could consume the two-second image-check budget before the helper produced a contract. Enable the dependency's ARM acceleration and optimize that dependency in debug builds. Keep the 128 MiB image limit, probe deadlines, byte-identity verification, clean helper environment, descriptor isolation, and failed-upgrade refusal unchanged. A valid 120 MiB image is covered through daemon capability negotiation.

macOS can also stall concurrent copied executables in its loader before Rust starts. Resource-heavy replacement validation runs serially; parallel startup behavior remains a separate test-infrastructure follow-up in KVG-5188. No startup retry or longer production deadline is introduced.

### Expose reasons, not payloads

Keep read-only inventory capacity reporting, adding outstanding-window and retirement progress where needed. Return distinguishable operation-window, request-byte, and live-session capacity errors through the existing sidecar and typed IPC path. Trace the current input error path so refusals remain visible without marking a still-running PTY dead. Diagnostics must never include input bytes, command secrets, or authentication material.

## Risks / Trade-offs

- More protocol state introduces acknowledgement races. Mitigate with small-window deterministic tests covering out-of-order completion, lost acknowledgements, duplicate requests, and cancellation.
- One unresolved operation can block contiguous retirement. Mitigate with bounded backpressure and explicit reconciliation/controller transfer, never automatic uncertain-input replay.
- Existing exhausted daemons retain legacy opaque IDs. Migrate only after fencing the legacy controller and reconciling sessions; do not treat clearing a map as recovery.
- Daemon replacement work is still active elsewhere. Keep version and checkpoint tests shared with that contract and disclose incompatible deployment paths.
- The production symptom could include another failure. Capture available read-only counters during implementation if still reproducible, but validate the demonstrated lifetime-exhaustion defect independently.

## Migration Plan

1. Add protocol capability/version negotiation and checkpoint compatibility tests before changing admission behavior.
2. Implement host retirement and client acknowledgement together, then integrate sidecar ownership and error reporting.
3. Support legacy checkpoint import by preserving live PTYs and input sequences, fencing legacy controller requests, and creating a fresh operation stream only after reconciliation. Uncertain legacy work is not replayed.
4. Exercise this migration on an isolated exhausted legacy daemon, including live output and PTY identity checks. If an installed daemon cannot support a safe replacement, report that incompatibility rather than killing it or claiming automatic recovery.
5. Reject rollback to a binary unable to preserve the new retry boundary. An explicit user-approved session shutdown is required for any otherwise unsupported downgrade; never perform it automatically.

## Open Questions

- Which budget produced the currently running instance's error? Inventory counters should distinguish operation count, retained bytes, and live sessions if that instance remains reproducible. The source-level lifetime accumulation defect does not depend on that observation.
