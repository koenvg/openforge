## Why

Completed Task history can grow into thousands of rows with multi-megabyte prompt payloads, while ordinary Focus navigation needs only a bounded active working set. The current change proved the scaling approach but added overlapping read methods, dual renderer models, and transport-specific behavior that make the interface harder to use and maintain than the problem requires.

## What Changes

- Define `TaskReference`, `TaskSummary`, and `TaskDetail` as the only canonical Task read projections.
- Replace overlapping Task reads with three project-scoped intents across desktop IPC, HTTP, CLI, plugin hosts, the plugin SDK, and test adapters: `active(projectId)`, `completed(projectId, query?)`, and `detail(projectId, taskId)`.
- Return complete active `TaskDetail` records and compact relationship references so Focus selection remains synchronous after the active read completes.
- Return Completed Tasks in fixed pages of 50 `TaskSummary` records ordered by a scope-bound keyset cursor. Completed reads never transfer full prompts.
- Return one `TaskDetail` and its immediate relationship references from every detail adapter.
- Enforce a maximum of 500 non-Completed Tasks per project and 100 direct relationships per Task so eager active reads and complete relationship rendering have explicit bounds.
- Keep `TaskDetail.prompt` as the canonical authoring prompt. Prompt previews remain derived, image-free display data capped at 120 Unicode characters.
- Put snapshot consistency, projection assembly, cursor validation, errors, renderer caching, relationship ownership, and stale-response rejection behind deep module seams.
- Replace the current implementation instead of adding another interface beside it. Preserve the projection, preview, keyset-pagination, narrow-query, and production-fixture foundations that still fit the revised design.
- **BREAKING** Remove caller-controlled active revisions, optional project scope, history status filters, configurable history page sizes, renderer-only detail context, and first-party use of the legacy `Task` model.
- Keep published legacy `list()` and `get()` behavior through isolated deprecated compatibility adapters. First-party code cannot use those adapters, and version 2 removes them.
- Replace internal full-history scans with narrow identifier, attention, relationship, active, and single-detail reads.

## Capabilities

### New Capabilities

- `task-api-boundaries`: Defines bounded Task projections, the three canonical Task read intents, fixed Completed Task pagination, active and relationship limits, adapter parity, deprecated compatibility behavior, and synchronous Focus selection.

### Modified Capabilities

## Impact

- Rust SQLite Task persistence, limits, relationships, attention, companion reads, and GitHub synchronization.
- The shared Rust Tasks module and desktop IPC adapters.
- Focus, Task detail, command palette, cross-project navigation, event refreshes, and renderer Task state.
- Versioned local HTTP routes and OpenForge CLI Task commands.
- Frontend and backend plugin hosts, public plugin SDK types, in-memory test adapters, generated runtime artifacts, contract fixtures, and migration documentation.
- Existing code for the rejected read names, caller revisions, dual renderer state, and mixed compatibility behavior will be removed before the replacement is implemented.
