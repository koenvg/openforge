## Context

See proposal.md for motivation. `terminal_task_completion.rs` resolves desktop backlog actions to deletion and doing actions to completion. Its compare-and-set persistence call in `db/task_lifecycle.rs` writes done and updated_at but no completion date. Task invalidations are not durable completion records. No authoritative historical completion source was found in the inspected schema; session events are not task completion evidence.

`db/task_reads.rs` implements project-scoped pages of 50 with updated_at keyset ordering. `TaskSummary` and `TaskDetail` are mirrored in the SDK, both plugin hosts, transport adapters, and an in-memory test adapter. Database timestamps currently use Unix seconds.

The user confirmed that tasks cannot reopen and should count once. Existing low-level status mutation permits done-to-active writes, and the task-api-boundaries spec and a persistence test discuss restoration. Those are conflicting implementation/spec remnants, not authorization to add reopening. This change closes that path because immutable completion analytics relies on terminal state.

## Goals / Non-Goals

Goals:
- Keep lifecycle persistence authoritative and queries bounded in payload and indexed by period.
- Reuse the existing three task read intents and shared contract tests.
- Make an empty result interpretable without scanning every historical task.

Non-goals:
- Event sourcing, repeated completion cycles, dashboard UI, token collection, timezone selection in the host, or speculative historical backfill.
- Changing unfiltered completed browsing order or deprecated legacy read shapes.
- Recovering tasks already permanently removed before tracking began.

## Decisions

### Record the timestamp at the terminal write

Add nullable `tasks.completed_at`. Set it using the host clock in the same transaction that successfully changes doing to done. Capture neither request arrival nor asynchronous workspace cleanup time. Repeated requests retain existing rejection behavior and never fill a legacy null. Reject done-to-active updates in persistence and map the error consistently through adapters. Direct creation of done rows used by fixtures or legacy imports does not prove a completion transition and leaves the date unknown.

A separate completion event table is unnecessary because completion is terminal and task rows survive it. Agent completion and task invalidation listeners cannot supply this timestamp reliably.

### Separate known dates from tracking coverage

Persist a singleton history-coverage record when the migration first installs authoritative tracking. Expose `completionCoverage` on every completed page with `trackedFrom: number | null`, `unknownCompletedTaskCount: number`, and `rangeStatus: 'complete' | 'partial' | 'unavailable' | 'notRequested'`.

All timestamps use Unix seconds. `trackedFrom` is the start of continuous supported tracking, not a completion date. With second-resolution storage, use the next whole second after tracking installation as a conservative boundary. Migration/repair reruns must not advance the boundary. An absent or untrustworthy marker means unavailable coverage, never a guessed installation date.

The unknown count covers retained done tasks in the same project and non-date filters, before pagination and without assigning them to a period. Compute it in the same read transaction as the page. For a requested range: complete means the entire interval is covered; partial means it overlaps the covered interval; unavailable means it precedes tracking or tracking cannot be established. Without a range, report notRequested and expose the other fields. Known dated records can still be returned when coverage is partial or unavailable.

This deliberately distinguishes a count of known completions from a proven historical total. Counting nulls alone is insufficient because deleted legacy tasks may no longer exist. Document that coverage concerns the supported local database history, not other installations or deleted projects. If an older writer or import introduces unverifiable post-tracking completions, invalidate coverage rather than silently promise continuity. Downgrading to an older writer is not a supported analytics-preserving rollback.

### Extend the existing bounded read

Add `completedAt: number | null` to canonical summaries/details and paired optional `completedFrom` and `completedBefore` query fields. Validate nonnegative safe integers and increasing bounds. Query `[completedFrom, completedBefore)` and omit null dates from matches. Use a partial index on project_id, completed_at DESC, id DESC for done tasks; retain existing browsing indexes. Add an index suitable for project-scoped unknown-date counts. Search and labels may require residual filtering but must not hydrate prompts or entire task histories.

Date queries use immutable completion-date ordering. Unfiltered queries keep updatedAt ordering and still expose unknown rows. Version date-query cursors and bind their project, normalized filters, endpoints, and mode. Preserve existing browsing cursors where feasible; reject incompatible ones with the existing typed cursor error. No new broad list method is needed.

A plugin computes both local calendar boundaries separately, converts them to Unix seconds, and pages that interval. It must not add a fixed 86400 seconds across daylight-saving transitions. Pages are live reads, not snapshot exports: metadata edits cannot shift completion ordering, but changing filter membership or new completions can require a fresh query after invalidation.

### Keep adapter and package contracts aligned

Carry fields and errors through Rust projections, typed renderer IPC, HTTP query parsing, CLI flags, frontend host, backend host, SDK entry points, and fake adapter. Legacy reads need not gain fields. Extend shared fixtures with known and unknown dates, coverage states, and date cursors.

Build `@openforge-app/plugin-sdk`, run its published-contract checks, build the host SDK runtime, and publish through the repository's supported release process. Add an external-package consumer fixture. Document the minimum host/SDK versions; a missing field on an older host is unsupported, not zero history.

## Risks / Trade-offs

- Existing spec/test restoration behavior conflicts with the confirmed terminal lifecycle. Replace that expectation explicitly and test refusal below as well as at the active limit.
- Historical evidence is absent in the inspected schema. Default backfill is null; preserve a verified completed_at if schema repair encounters one. Never backfill from updated_at.
- Legacy and date-range queries have different ordering. Bind ordering in cursors and document both.
- Unknown-count queries can become expensive with search and labels. Validate query plans and large-history fixtures; keep scalar counts and bounded summaries rather than loading records into memory.
- Mutable clocks and unsupported older writers can undermine coverage. Document clock assumptions and do not claim uninterrupted coverage after an unverified downgrade.

## Migration Plan

1. Append a migration and idempotent schema-repair support for the nullable field, indexes, and coverage marker. Do not rewrite existing migration slots.
2. Preserve verified existing values and initialize unknown legacy rows without guessed dates. Test fresh, upgraded, partial, and repeated-repair databases.
3. Deploy host persistence and reads before consumers depend on the new SDK contract.
4. Build and release the SDK through the supported package workflow, recording the version and publication result for KVG-5232.
5. On rollback, retain schema and completion data. Prefer a forward fix; if an older writer is run, treat continuity as unverified until repaired rather than retaining a false complete-coverage claim.
