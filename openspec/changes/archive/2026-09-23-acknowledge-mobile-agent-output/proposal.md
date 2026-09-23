## Why

Mobile shows a Task's live Agent terminal but never acknowledges the output the user has seen. Unread output can therefore keep the Task in Focus, while the mobile Board card gives no clue why. Desktop already handles both acknowledgement and an explicit unread label.

## What Changes

- Acknowledge the specific unread Agent output occurrence after the paired mobile app presents it in the visible, foreground Terminal tab. Do not acknowledge merely because Task detail opens or a terminal is connecting.
- Preserve unread status when mobile is backgrounded, the terminal is unavailable, or a newer output occurrence arrives before an older acknowledgement completes.
- Show "Unread agent output" on mobile Board cards alongside the underlying workflow state, including Out of Focus cards. Refresh Board and Attention data after acknowledgement so lane placement and counts match desktop.
- Extend the Companion contract with the minimum occurrence-scoped acknowledgement and unread-status data needed for those behaviors. No terminal transcript storage or historical-output viewer is included.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `task-attention-unread-output`: Extend existing viewing, unread-card, and lane/count requirements to the paired mobile Terminal tab and Board.

## Impact

The Companion Gateway's authenticated Task endpoint and Board projection, its OpenAPI contract and generated Dart client, mobile terminal/task-detail lifecycle, Board card, and contract/widget tests. The desktop's revision-scoped persistence and Attention placement remain authoritative. The interactive terminal protocol and its privacy rules stay in force.
