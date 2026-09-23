## Context

See `proposal.md` for motivation and `specs/terminal-session-coordination/spec.md` for the behavior contract. Admission currently uses `HostLimits { live_sessions: 32, retained_sessions: 128, exit_history: 128 }` in `session-daemon/src/host.rs`; the shared `HostState` serializes those limits in its checkpoint. The backend retains records keyed by PTY instance and checks 32 live resources, 128 records, and 32 MiB of retained checkpoint data. Replacement separately validates at most 36 inherited descriptors (including root descriptors and the checkpoint file), uses a 64 MiB JSON body and 8 KiB header, and pauses/checkpoints sessions under a two-second backend deadline. The shared host checkpoint is capped at 16 MiB; individual terminal-model checkpoints can reach 16 MiB. Only the macOS arm64 fixture path currently advertises live replacement. A one-line admission-limit increase would therefore make a 33rd PTY unreplaceable.

## Goals / Non-Goals

**Goals:**
- Ensure admission, serving, recovery, and supported replacement agree on the resources actually held; do not discard an existing PTY to accept another.
- Validate 256 concurrent terminals in a provisioned isolated environment, plus repeated lifecycle turnover, without making 256 the product's fixed count ceiling.
- Make legacy-limit adoption explicit, compatible, and safe under rollback.

**Non-Goals:**
- Unlimited memory, file descriptors, process slots, or terminal scrollback; bypassing per-session snapshot validation.
- Enabling live replacement on a platform/build for which it is not already supported, or silently restarting an older non-replaceable daemon.
- Changing agent/task ownership, renderer attachments, or the operation-receipt retirement protocol.

## Decisions

### One resource envelope for admission and replacement

Introduce an owner-side capacity policy used by both spawn admission and checkpoint preflight. Account separately for live/draining PTYs, retained exited records, occupied and required handoff file descriptors, recorded terminal-model/ledger bytes, and reserved headroom for cleanup and restoration. Check OS descriptor availability against the current process limit and enforce a finite, documented memory/checkpoint envelope. Keep protocol/validation upper bounds as safety checks, but eliminate 32 as the ordinary live-session policy; a count alone cannot be the reason a provisioned host refuses the 256th PTY. Report the binding budget and actual usage via the existing capacity/error boundary, extending the typed protocol only as needed. Never expose command environments or terminal content in diagnostics.

Alternative: simply raise `live_sessions` to 256 or 1024. Rejected: 32-resource and 36-descriptor replacement gates, persistent legacy limits, and byte budgets would still fail independently; 256 would become the next arbitrary cutoff. The policy must refuse a new spawn before it jeopardizes existing sessions, while output growth after admission may still make a later checkpoint unavailable. In that case abort replacement before exec and resume the old daemon; do not kill sessions or claim a successful upgrade.

### Retire settled exited records coherently

Bound historical recovery with a lifecycle/acknowledgement policy rather than keeping every backend record for the daemon's lifetime. Reclaim only settled exited records after their required delivery/retry window; coordinate backend records, host inventory/identity and input-sequence metadata so their checkpoint sets still match. Preserve live and draining entries, operation-window tombstones and at-most-once retry fences; an expired instance remains stale rather than being reused. Publish/report expiry or an existing detectable journal gap instead of substituting another PTY's history.

Alternative: increase `retained_sessions` and `MAX_RECORDS` indefinitely. Rejected: even a large number eventually blocks new work and grows checkpoints. Retention must remain finite, explicit, and independent of total lifetime spawns.

### Budget the whole handoff, not just PTY masters

Replace the 32-resource and 36-inherited-descriptor assumptions together with checked lengths derived from the same safe envelope; keep unique-FD validation, audited root descriptors, and no ambient inheritance. Budget serialized host ledger, backend model state, journal, header, temporary checkpoint file and restoration FD clones before committing. Make header size and frame size independent of total inventory where safe, with bounded encoders/readers on both sides; do not simply allocate maximum possible per-session snapshot memory for every live PTY. Scale the pause/serialization strategy so a valid 256-session handoff does not fail a 2-second all-session deadline, while keeping a measured maximum handoff pause and rollback on timeout. Keep per-session authority validation intact.

Alternative: raise only the JSON body limit and timeout. Rejected: descriptor validation, per-session model growth, ledger size, memory copies and OS headroom can still defeat replacement. Capture/restore must prove all-or-nothing; preflight and tests should exercise dense snapshots and near-limit FDs, not just empty shells.

### Migrate old limits only at a safe image boundary

Validate legacy host checkpoints under their saved limits, then apply the new admission policy in the compatible target image without changing PTY identity, controller fencing or receipts. During preparation/failed exec, the old image must still be able to resume its original checkpoint. After a successful target activation, do not advertise rollback to an older image unable to restore the enlarged live set; incompatible downgrade/replacement must fail before exec. An already-running legacy daemon cannot gain new code by app-side configuration alone: when replacement is unsupported, leave it serving its sessions and report the upgrade constraint rather than launching a second owner.

Alternative: rewrite the old checkpoint's `live_sessions` before exec. Rejected: a failed handoff could make the fallback image reject its own saved state or claim capacity it cannot safely restore.

## Risks / Trade-offs

- [Terminal model state grows after spawn] -> Check actual bounded snapshot size at replacement, retain the serving image and report a refused upgrade when over budget; measure worst-case memory and do not evict live state to fit.
- [256 PTYs exhaust platform FDs, threads, or child processes] -> Isolated stress fixtures with explicit OS limits, per-PTY resource measurements, and restoration headroom; never weaken process ownership checks.
- [Retiring history loses a late consumer] -> Retain lifecycle events until their required settlement, expose explicit expiry/gaps, and test reconnect and stale retry paths.
- [Legacy image cannot recover after capacity expansion] -> Preserve fallback before commit and reject incompatible downgrade after commit; document the supported transition matrix.

## Migration Plan

1. Add failure-first 33rd/256th spawn and replacement fixtures, legacy-limit and turnover tests, and capacity-diagnostic contract tests in isolated roots.
2. Implement coordinated admission, retention, checkpoint and descriptor budgeting with existing state-format compatibility; test preflight failure keeps the original owner and PTYs alive.
3. Validate supported macOS arm64 replacement and resource measurements at 256 live PTYs. Update capacity documentation and release/compatibility guidance. On a daemon that cannot perform supported in-place replacement, leave running sessions intact and surface the limitation rather than forcing migration.
