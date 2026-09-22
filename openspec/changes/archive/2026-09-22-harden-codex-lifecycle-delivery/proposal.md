## Why

Codex can finish a turn while OpenForge leaves its Agent Session running when a diagnostic lifecycle notification exceeds the daemon's UTF-8 byte limit. The invalid notification remains at the head of Codex's durable outbox and blocks the valid completion behind it.

## What Changes

- Bound Codex lifecycle diagnostic fields by the shared notification protocol's UTF-8 byte limits before enqueueing them.
- Prevent permanently invalid, non-terminal activity notifications from blocking later lifecycle transitions such as completion.
- Preserve notification identity, ordering, and durable replay for lifecycle transitions whose delivery failure is temporary.
- Add regression coverage for multibyte diagnostic snapshots and a rejected activity notification followed by completion.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `codex-background-work`: Require Codex completion to remain deliverable when an earlier diagnostic activity notification is permanently invalid, while preserving ordered replay for temporarily rejected lifecycle transitions.

## Impact

- Codex hook snapshot construction and its durable lifecycle outbox.
- Shared agent notification delivery and rejection handling where needed to identify invalid payloads.
- Codex lifecycle tests and shared notification protocol contract tests.
