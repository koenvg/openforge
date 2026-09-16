## Context

See `proposal.md` for motivation and `specs/pr-review-agent-session/spec.md` for behavior.

GitHub Sync currently splits one review across four unrelated mechanisms:

- `reviewThreadAdapter.ts` derives `("github", "gh:<owner>/<repo>#<number>", <head_sha>)` while adapting `AgentReviewComment` and `AiThread` records onto the shared Review Thread type.
- `startAgentWalkthrough` starts `agentGenerateInRepo`, receives one schema-shaped final response, and parses walkthrough steps and review comments after the process exits.
- `walkthrough:<pr-id>:<head-sha>`, `pr-ai-review:<pr-id>:<head-sha>`, `pr-ai-threads:<pr-id>:<head-sha>`, and `pr-review-session:<pr-id>` hold the output, questions, and a resumable provider pointer.
- `useWalkthroughPolling` polls the walkthrough record. Follow-up questions are collected locally, then sent in a new headless run.

`add-scoped-agent-sessions` supplies a scope-owned session, checkout, read-only policy, change invalidations, and host-rendered terminal. `add-core-review-threads` supplies durable thread writes and the agent CLI. This change is their GitHub Sync consumer.

KVG-2229 has already removed the 100-file ceiling. `GitHubClient::get_pr_files` follows every GitHub `Link: rel="next"` page and has a test with 101 files. A walkthrough validator can now use the complete changed-file set instead of choosing a degraded behavior above 100 files.

## Goals / non-goals

**Goals:**

- Build one pull request address once and use it for sessions, walkthrough attempts, and Review Threads.
- Keep every agent write narrow, scope-bound, immediately checked, and visible before the run ends.
- Separate a generation attempt from the longer-lived conversation so ordinary follow-up turns cannot change walkthrough status.
- Remove the plugin's duplicate review-comment and question-thread stores.
- Preserve valid cached walkthroughs without preserving the final-output generation path.

**Non-goals:**

- Change walkthrough step navigation, ticket coverage, reviewed-file state, or GitHub review submission.
- Put scoped sessions on Focus, Task Attention, or startup resume.
- Let the review agent edit code or turn a pull request review into a Task.
- Add semantic completeness checks such as whether the agent covered every changed file.

## Decisions

### 1. One helper owns the pull request address

Add a pure `reviewScopeForPullRequest` helper that returns:

```ts
{
  namespace: 'github',
  targetKey: `gh:${pr.repo_owner}/${pr.repo_name}#${pr.number}`,
  revision: pr.head_sha,
}
```

The session controller, Review Thread controller, terminal mount, walkthrough coordinator, and tests all consume this object. Remove the private `targetKeyFor` copy from `reviewThreadAdapter.ts`. The helper preserves the repository owner and name as GitHub Sync stores them. Core still treats all three strings as opaque.

Changing the head SHA changes the Session Scope. The scoped-session revision rotation then aborts and releases the older revision before the plugin starts work at the new head. Sharing the address does not join the session and thread stores; it gives their independent APIs the same subject identity.

Deriving a second session key from `review_pr_id` was rejected. That id is local database identity, while Review Threads already expose the stable repository and pull request address that this change is required to match.

### 2. The Agent tab is always third and Walkthrough is conditional fourth

The detail tab order becomes Overview, Files changed, Agent, then Walkthrough when a current or in-progress walkthrough has steps. `Cmd/Ctrl+3` always opens Agent. `Cmd/Ctrl+4` opens Walkthrough only when it is available. Update both `PrDetailTab` unions together.

The Agent tab always renders for a selected pull request. Before a session exists it offers Generate and explains that the checkout will be read-only. When the repository does not map to a local OpenForge Project, it states that a local Project is required and disables start. Hiding the tab in that case was rejected because tab position and the place where failures are read would change with repository setup.

`AgentTab.svelte` mounts the host terminal for the derived scope. It compares the full logical scope before replacing an attachment. It does not release a session from `$effect` cleanup. `onDestroy` disposes only the current presentation attachment; explicit pull request removal or revision rotation owns session release.

### 3. One scoped session outlives generation turns

The plugin starts the scope with the Project repository, `head_sha` checkout revision, initial review prompt, and the host's `review-read-only` policy. It never supplies a path, provider flags, permission mode, credentials, or terminal key. The host selects the configured provider and keeps the checkout and provider conversation.

Later terminal input calls scoped-session input. An inline reply to an agent Review Thread first appends the human message to that thread, then sends one input to the same session naming the thread id. The agent answers with `openforge review thread reply`. Step-anchored questions use a custom Review Thread anchor and the same immediate input path. The Questions panel no longer batches local `AiThread` records into another headless process.

The scoped credential permits repository reads, the exact Review Thread CLI routes for its own scope, and the one GitHub Sync walkthrough submission command. Final host authorization compares a Review Thread command's requested triple with the credential's Session Scope. Interactive provider approval cannot widen the policy.

A hidden Task was rejected in `add-scoped-agent-sessions`. A new headless process per question was also rejected here because it loses the visible transcript, duplicates checkout setup, and recreates the context problem this change exists to remove.

### 4. A hidden backend Plugin Command accepts one complete step

GitHub Sync registers a backend, agent-enabled, user-hidden Plugin Command named `submit-walkthrough-step`. The agent invokes it through `openforge plugin command invoke --command-id com.openforge.github-sync.submit-walkthrough-step`. Its input is an attempt id plus one complete `PrWalkthroughStep`; it does not accept a pull request id, Project id, Session Scope, storage key, or workspace path.

Scoped Plugin Command invocation adds trusted session information to `PluginCommandInvocationContext`: the owning plugin, Project, scoped session id, and Session Scope. The broker derives that context from the scoped credential and refuses another plugin, Project, session, or scope before calling the handler. Ordinary Task and person-invoked Plugin Commands receive no scoped session context. The `review-read-only` policy permits this exact qualified command, not arbitrary Plugin Commands.

This reuses the existing `/plugin_commands/invoke` agent transport route. No broader HTTP route or generic plugin write permission is added. A dedicated core walkthrough API was rejected because walkthroughs belong to GitHub Sync, not the OpenForge domain. Passing the scope inside agent-controlled JSON was rejected because it would make the handler trust the address it is meant to constrain.

The generation prompt includes the opaque attempt id and the exact CLI example. The handler compares that attempt id with the active attempt for the trusted Session Scope. A stale or invented id is rejected without a write.

### 5. Validate atomically against an immutable, complete file snapshot

Before sending the generation input, the plugin fetches all pull request files and verifies that the pull request still has the addressed `head_sha`. It builds an immutable validation snapshot for the attempt:

```text
filename -> number of parsed hunks
```

The KVG-2229 pagination loop makes this the complete file list, including pull requests above 100 files. If pagination, head verification, or patch parsing fails, generation does not start. If the snapshot is unavailable when a command arrives, the command fails closed as temporarily unverifiable.

For every submission, validate in this order:

1. The trusted Session Scope has the supplied active attempt id.
2. `id`, `title`, and `summary` are non-empty after trimming, and `files` is non-empty.
3. File references are unique and each filename exactly matches the snapshot.
4. `hunk_indexes` is either `null` for the whole file or a non-empty array of unique integers.
5. Every hunk index is zero or greater and smaller than that file's parsed hunk count.

Only after all checks pass does one storage write add or replace the step. The first accepted submission of an id appends it to submission order. A later accepted submission with that id replaces the value at the same position. A rejected first submission reserves no position.

The error names the input path and rejected value, then gives the correction boundary. Examples include `step.files[1].filename 'src/missing.ts' is not changed in github/gh:acme/web#42@abc123` and `step.files[0].hunk_indexes[0] is 4; src/app.ts has 2 hunks, valid indexes are 0..1`. Empty-patch files accept `hunk_indexes: null` but reject every numeric index.

The validator deliberately does not judge titles, summaries, grouping quality, or coverage. Those are agent-quality concerns, not facts the host can prove.

### 6. A generation attempt has its own state machine

The scoped session is long-lived. A plugin-owned generation attempt is short-lived and has a random id, a scope, validation snapshot, ordered accepted steps, and one of:

```text
generating -> ready | no-submissions | failed | aborted
```

Starting or regenerating creates a fresh attempt and clears the prior attempt's draft steps. Accepted steps publish a plugin invalidation so the open Walkthrough view re-reads and renders them while the terminal is still running. Rejected submissions do not increment the accepted count.

The coordinator subscribes to scoped-session changes and fences every transition by attempt id:

- A normal generation-turn completion with at least one accepted step becomes `ready`.
- A normal completion with zero accepted steps becomes `no-submissions`.
- Provider or session failure becomes `failed` and leaves the terminal output readable.
- Stop aborts the active turn and marks the attempt `aborted`.
- Completion from an older turn or a later conversational turn cannot change the current attempt.

`no-submissions` is a terminal result, not an error inferred by a timer. The Agent tab says, "The agent finished without submitting a walkthrough," and offers Generate again. An attempt with only rejected commands reaches the same state, with each rejection still present in the terminal.

Accepted steps from a failed or aborted attempt may remain visible as provisional output, but only `ready` steps feed review submission, ticket coverage, and the normal completed walkthrough presentation. A retry starts a clean attempt.

A separate `finalize` CLI command was rejected. The host already owns the provider turn lifecycle, so requiring the agent to announce completion would turn a forgotten command into another stuck state.

### 7. Review comments move directly to Review Threads

The review prompt tells the agent to create each finding with `openforge review thread create`, using a stable idempotency key and the exact address supplied in the prompt. Each successful thread appears through `reviewThreads.onDidChange`; there is no end-of-run import.

Review Thread writes keep their existing contract. They check structural anchor fields and scope authorization. They do not use the walkthrough hunk validator, and an unresolved line remains an orphaned thread rather than disappearing. This preserves the deliberate boundary in `add-core-review-threads`.

The GitHub Sync review workspace reads, replies to, resolves, dismisses, and marks threads seen through `api.reviewThreads`. Remove `AgentReviewComment`, `AiThread`, `reviewThreadAdapter.ts`, their Svelte stores, and the adapter-specific status mapping once no caller remains.

### 8. Replace the walkthrough record, but retain valid cached steps

Keep the known `walkthrough:<pr-id>:<head-sha>` key so existing ready walkthroughs can be read when their pull request is next opened. Replace its value with a versioned record containing the derived scope, typed steps, attempt state, attempt id, timestamps, and no provider session key or raw `steps_json`.

The compatibility reader handles an old record once:

- `ready` with a valid `steps_json` value is decoded, checked against the now-complete diff, and rewritten as a versioned `ready` record.
- `generating` has no surviving headless process and becomes `aborted`.
- `error` becomes `failed` with its message.
- Invalid legacy steps become `failed`; they are never silently trimmed into a different walkthrough.

This compatibility decoder is not used for new agent output. Delete `walkthroughSchema.ts`, `reviewCommentsParse.ts`, the final-output extraction helpers, and the `agentGenerateInRepo` walkthrough path after the new path is active.

Retire these key families completely:

- `pr-ai-review:<pr-id>:<head-sha>`
- `pr-ai-threads:<pr-id>:<head-sha>`
- `pr-review-session:<pr-id>`

The plugin stops reading and writing them. Plugin storage has no key enumeration, so old values may remain physically present until ordinary per-pull-request cleanup can delete a known key. They are unreachable product data. Existing local AI review comments and question threads are intentionally not migrated and disappear from the UI. New comments live in core Review Threads, and new conversation lives in the Scoped Agent Session. The Jira keys and walkthrough key are not retired.

Migrating old comments into Review Threads was rejected because the adapter assigned local numeric identities, some anchors no longer resolve, and no safe idempotency key exists. Importing old `AiThread` messages into a provider transcript is not supported by the scoped-session contract.

## Risks / trade-offs

- [The head changes while the file list is loading] -> Read and compare the current head around snapshot creation. Refuse to start unless it still matches the Session Scope revision.
- [A plugin reload loses the active validation snapshot] -> Scoped sessions do not survive plugin deactivation. Mark the attempt `failed` or `aborted`; never rebuild validation against a possibly newer head for an old attempt.
- [An accepted partial walkthrough looks complete] -> Mark steps provisional until the attempt reaches `ready`. Completed presentation and dependent ticket coverage use only ready steps.
- [The generic Plugin Command route is wider than one walkthrough verb] -> The Session Tool Policy names the exact qualified command, and the broker checks the scope-bound credential before dispatch.
- [Legacy cached steps fail stricter validation after pagination] -> Report the legacy walkthrough as failed with a regeneration action. Do not discard bad references and present a changed walkthrough as the original.
- [Retired plugin values still occupy storage] -> Delete known keys during pull request cleanup and regeneration. Enumeration and bulk deletion can be added to plugin storage separately if retained bytes become material.

## Migration plan

1. Land the shared scope helper and Agent tab on top of `add-scoped-agent-sessions`, keeping walkthrough generation unchanged until the terminal path is proven.
2. Add scoped Plugin Command context, exact-command policy authorization, the versioned walkthrough record, complete-diff snapshot, step validator, and attempt state machine.
3. Register `submit-walkthrough-step`, change the prompt to CLI submissions, and render accepted steps from the versioned record while the run is active.
4. Point GitHub Sync at core Review Threads and the same scoped session for inline and terminal follow-ups. Remove local question batching.
5. Remove `agentGenerateInRepo` walkthrough generation, output schemas, standard-output parsers, adapter records, and retired key reads and writes.
6. Keep the legacy walkthrough compatibility reader for one release boundary. Remove it only in a later change with an explicit cache-drop decision.

Rollback before step 5 can restore the old headless path while leaving scoped sessions and submitted Review Threads in place. After step 5, rollback cannot reconstruct retired local comments or questions. A rollback must treat already-created Review Threads as the source of truth and may leave versioned walkthrough records for the newer build to read again.
