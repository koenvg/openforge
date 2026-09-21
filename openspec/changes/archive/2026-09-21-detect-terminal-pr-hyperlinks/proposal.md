## Why

Agents can print a clickable `PR #2549` label whose GitHub URL exists only in an OSC 8 terminal hyperlink. Task PR detection currently discards all OSC payloads, so that link cannot trigger immediate discovery even though the terminal lets the user open it.

## What Changes

- Recognize complete GitHub PR URLs in OSC 8 hyperlink targets from accepted live task terminal output.
- Handle BEL and ESC-backslash terminators, optional hyperlink parameters, and sequences split across output chunks.
- Route hidden targets through the same candidate deduplication and repository/branch verification as visible URLs.
- Keep parsing bounded and fail closed for malformed links, other terminal metadata, stale output, and replay. Do not infer associations from bare PR numbers.

## Capabilities

### New Capabilities

- `terminal-pr-hyperlinks`: Discover task PR candidates from terminal hyperlink targets without depending on their visible labels.

### Modified Capabilities

None. The broader `task-pull-request-discovery` capability exists only in the active `link-task-pull-requests-from-events` change, not in main specs. This focused capability supplements that work without duplicating or editing its requirements.

## Impact

- Rust sidecar detector at `src-tauri/src/github_runtime/task_pr_discovery/detector.rs` and focused discovery/PTY tests.
- Integrate hyperlink parsing with the daemon live-output adapter now supplied by main, preserving inventory ownership, full PTY identity, sequence fencing, and disconnect recovery. The approved daemon expansion is satisfied through the upstream implementation rather than a duplicate adapter.
- No new GitHub API, renderer behavior, persistence schema, dependency, or polling cadence is required.
- The existing discovery design intentionally skips unsupported escapes; this change makes OSC 8 targets a narrow exception, not a general terminal metadata scanner.
