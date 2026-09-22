## Context

See [proposal.md](proposal.md) for the failure being addressed. Codex lifecycle events are produced in short-lived Node hook processes, persisted in a per-turn JSON outbox, and delivered FIFO to the Rust session daemon. The producer currently bounds activity snapshots by JavaScript string length, while the daemon validates UTF-8 byte length and the serialized envelope size. The transport reports rejected ingress through one fixed error, so the outbox cannot safely infer from a delivery error whether an item can be retried.

The activity snapshot and transcript path are optional diagnostics. The lifecycle kind, task identity, PTY identity, raw event identity, notification ID, and FIFO order are the durable state-transition contract.

## Goals / Non-Goals

**Goals:**

- Make the Codex producer satisfy the daemon's field and envelope limits before a notification enters the durable outbox.
- Recover existing outboxes that contain an oversized optional diagnostic without changing notification identity or lifecycle order.
- Keep temporary delivery failures durable and strictly ordered.
- Keep truncated diagnostic text valid UTF-8 and useful to downstream metadata generation.

**Non-Goals:**

- Changing the daemon's notification limits or receipt format.
- Reordering lifecycle transitions to prioritize completion.
- Dropping a notification based only on an HTTP status or the transport's generic rejection error.
- Changing lifecycle behavior for providers other than Codex.

## Decisions

### Normalize against bytes and the final envelope before persistence

The Codex hook will replace character-count truncation with UTF-8-aware diagnostic normalization. It will retain the most recent portion of an oversized activity snapshot without splitting a Unicode scalar value. An oversized transcript path will be omitted instead of truncated because a partial path is not usable.

After applying per-field limits, the hook will measure the exact serialized durable envelope with a UUID-length notification ID. If optional diagnostics still push the envelope over the protocol limit because of JSON escaping or combined field size, it will reduce or omit activity content until the envelope fits. Required lifecycle fields will never be truncated.

The protocol limits used by this normalization will live with the shared JavaScript notification contract so producer preflight and transport validation use one definition. Cross-boundary tests will assert that these limits match the Rust protocol.

Alternatives considered:

- Keep the current character limit with a larger safety margin. This wastes diagnostic capacity and still cannot guarantee the encoded field or envelope size.
- Increase the daemon limits. This masks the producer/consumer unit mismatch and does not prevent future oversized payloads.
- Truncate the already serialized envelope. That can produce invalid JSON and corrupt required lifecycle fields.

### Repair known-invalid diagnostics at the head of the outbox

Before each delivery attempt, the drainer will run the same normalization against the pending envelope. If only optional diagnostics violate the local protocol contract, it will atomically persist the normalized payload under the existing notification ID and then deliver it. A payload rejected for this size violation could not have entered the daemon journal, so retaining its ID is safe and preserves FIFO semantics.

The drainer will not discard or bypass an item merely because delivery returned a client or server error. Valid notifications remain at the head of the queue and retry later, preserving the existing at-least-once delivery and daemon deduplication behavior.

Alternatives considered:

- Drop every non-terminal event that receives a permanent-looking HTTP response. The transport deliberately hides rejection details, and misclassification could lose meaningful lifecycle state.
- Let completion overtake activity. That can invert observable lifecycle order and make a delayed activity event reopen or conflict with a completed turn.
- Assign a new ID after normalization. Reusing the existing ID better preserves the durable notification's identity and is safe because a protocol-invalid envelope is rejected before journaling.

### Verify the JavaScript-to-Rust contract with multibyte fixtures

Node tests will cover byte-aware truncation, escaped JSON overhead, and a persisted oversized activity notification followed by completion. The outbox regression will prove that the repaired activity and completion are delivered in order with their original IDs. Rust protocol tests will cover multibyte field boundaries so a future change cannot silently revert to character-count assumptions.

Alternative considered:

- Test only the original KVG-2311 payload. A single fixture would reproduce the incident but would not pin the byte boundary or the encoded-envelope constraint that caused it.

## Risks / Trade-offs

- [A heavily truncated activity snapshot contains less context for task-title generation] → Keep the newest UTF-8-safe tail and remove content only until the protocol contract is satisfied.
- [JavaScript and Rust protocol limits can drift] → Define JavaScript limits in one shared notification-contract location and add explicit cross-boundary boundary tests.
- [Rewriting a pending payload with the same ID could conflict with a previously accepted payload] → Rewrite only when local validation proves the original envelope violates the daemon's pre-journal contract; leave all valid payloads untouched.
- [A malformed required lifecycle field can still block the queue] → Keep this change limited to the demonstrated optional-diagnostic failure; required identities originate from OpenForge and need a separate recovery policy if that invariant is ever violated.

## Migration Plan

1. Ship the updated embedded notification contract and Codex hook together.
2. On the next drain, normalize any legacy pending notification whose optional diagnostics exceed the current protocol limits and persist the repaired envelope before sending it.
3. Keep the turn-state schema version unchanged because the persisted shape and notification IDs do not change.
4. Rollback requires no data migration: older code can read normalized state, though rolling back also restores the producer bug for newly generated diagnostics.
