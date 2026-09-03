## Why

Agent output can be missed when a task has a pull request whose workflow state keeps it in In Flight. Attention currently reflects only the task's workflow state, so it cannot distinguish a new agent reply that has not been viewed from one the user has already read.

## What Changes

- Track unread agent output for every task and every stopped outcome, including completed, paused, failed, and interrupted runs.
- Bring a task with unread agent output into Focus even when its underlying pull request or workflow state would otherwise place it in In Flight.
- Mark output as read only while the task's Agent pane is visible, including when new output arrives while that pane is already open.
- Return a read task to the lane selected by its underlying workflow state. Tasks with another Focus reason remain in Focus.
- Show an accessible unread marker on task cards, attention-overview rows, and the Agent pane tab.
- Persist read state across application restarts and protect newer output from stale read acknowledgements.

## Capabilities

### New Capabilities

- `task-attention-unread-output`: Defines unread agent output, its effect on task attention and board lanes, acknowledgement behavior, persistence, and visual presentation.

### Modified Capabilities

- None.

## Impact

- Rust agent-session persistence, lifecycle transitions, and Task Attention projections.
- Desktop IPC commands and generated IPC metadata.
- Shared Plugin SDK Task Attention types.
- Focus Board, Attention Overview, and Task Detail Agent pane presentation.
- Attention counts and refresh behavior across projects.
