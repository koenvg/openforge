# Local-first, task-prioritized GitHub Sync

OpenForge will keep **GitHub Sync** local-first instead of adding a webhook receiver as the default path. GitHub freshness should prioritize task-linked **Merge Readiness** and pipeline status for the user's active attention surface, because stale CI/mergeability on task cards is the painful workflow while global PR-review lists can tolerate slower refreshes.

## Consequences

- The Rust Sidecar should support a narrower GitHub status refresh path for task/project-scoped PR readiness and CI signals, separate from full global PR-list refresh.
- Background sync should spend its fastest budget on Focus-column Tasks in the active project, then other active-project task-linked PRs, then inactive projects, then global review-list data.
- Manual refresh copy should say GitHub status when it refreshes Task pipeline and Merge Readiness signals; the existing full sync can remain available as an explicit global refresh.
- Webhooks remain a possible future optional integration, but not a requirement for the desktop app's core sync model.
