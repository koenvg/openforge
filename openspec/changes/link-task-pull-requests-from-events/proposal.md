## Why

A PR created by an agent can remain absent from its OpenForge task until the next global GitHub discovery cycle, normally four minutes at default settings. Local terminal and agent-completion signals can trigger a verified task-specific lookup immediately, leaving polling as recovery rather than the normal linking path.

## What Changes

- Detect GitHub PR URLs in live task-owned terminal output across agent providers, without requiring a visible terminal or provider-specific instructions.
- Verify the candidate against the task's current repository and worktree branch before persisting a link, then update the existing PR UI through task-scoped events.
- Debounce a branch lookup after an accepted agent-completion transition to discover PRs whose URLs were not printed.
- Coalesce duplicate signals, reject stale PTY/worktree results, preserve existing associations, and respect GitHub rate limits.
- Separate task-link reconciliation from global review-list refreshes and run automatic reconciliation less often, with startup and manual synchronization retained.
- Retain existing adaptive polling for linked PR status, CI, reviews, comments, and merges performed outside OpenForge.

## Capabilities

### New Capabilities

- `task-pull-request-discovery`: Verified event-driven task-to-PR linking with bounded signal handling and slower recovery reconciliation.

### Modified Capabilities

None. Existing terminal-session coordination and task API boundary requirements remain unchanged; this capability must preserve them.

## Impact

- Rust sidecar: live output handling for local and daemon-backed PTYs, accepted agent lifecycle notifications, task/worktree resolution, GitHub lookup and persistence, and poll scheduling.
- Existing `task-pull-request-updated` event and renderer PR/attention invalidation listeners; no new PR presentation is required.
- Tests for terminal parsing, lifecycle identity, GitHub verification, persistence races, scheduling, and renderer event delivery.
- No new provider dependency, GitHub webhook service, or requirement for agents to call a registration command. No replacement of remote-status polling or change to explicit manual linking semantics.
