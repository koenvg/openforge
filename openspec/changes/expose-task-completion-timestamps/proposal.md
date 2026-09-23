## Why

KVG-5232 needs authoritative task completion dates to compare completed work with token usage. OpenForge currently exposes mutable update dates but no completion timestamp, so plugins cannot reliably count completions in a calendar period.

## What Changes

- Persist the first successful task completion timestamp atomically with the terminal lifecycle transition. Tasks cannot be reopened and count once.
- Expose nullable completion timestamps with explicit Unix-second units in bounded task summaries and details.
- Add bounded completion-date filtering and immutable date ordering for period queries, while retaining existing unfiltered browsing behavior.
- Return historical coverage information even when a page is empty, so consumers can distinguish zero completions from unavailable history.
- Preserve verified historical completion timestamps where evidence exists. Leave other historical dates unknown.
- Build and release the public SDK contract and document period queries, including local-calendar boundaries.
- Do not implement Codex analytics UI or infer task completion from agent sessions.

## Capabilities

### New Capabilities

- `task-completion-history`: Authoritative terminal completion dates, historical coverage, migration guarantees, and SDK availability.

### Modified Capabilities

- `task-api-boundaries`: Completion fields and range filters in existing bounded reads, date-query pagination, and terminal-state constraints replacing obsolete restoration scenarios.

## Impact

Rust task persistence, migrations, lifecycle service, task reads, IPC/HTTP/CLI adapters, frontend and backend plugin hosts, SDK types and testing adapter, shared contract fixtures, and authoring documentation. KVG-5266 is a host prerequisite for KVG-5232, not a dependent cleanup task. Existing legacy reads remain compatible; no additional unbounded task read is introduced.
