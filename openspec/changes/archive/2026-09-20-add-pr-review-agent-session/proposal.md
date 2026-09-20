## Why

`add-core-review-threads` deferred moving GitHub Sync's writes off the parse path onto the CLI to a third change. This is that change, and it also gives the pull request page the session surface that move needs.

Walkthrough generation is invisible. It runs for up to ten minutes with nothing to look at, in a checkout deleted the moment it ends, with session persistence switched off so the run cannot be resumed. On failure the user gets a retry label. On success the question panel answers each batch by starting a new run in a new checkout, with no memory of the walkthrough it is being asked about.

A Task already offers what is missing: a tab where the agent is visible while it works, and where the user keeps asking questions in the same conversation.

## What Changes

- Add an always-present Agent tab to the pull request detail view while keeping the Walkthrough tab conditional on an available walkthrough.
- Run walkthrough and AI review generation in a visible Scoped Agent Session instead of a headless subprocess, so the user watches it work and reads its failures directly.
- Address the session by the namespace, target key, and revision triple the plugin already builds for that pull request's Review Threads, so threads and session share one address.
- Run the session in a host-owned Scoped Workspace checked out at the pull request head, kept alive for the life of the session instead of removed when generation ends.
- Have the agent submit walkthrough steps through the OpenForge CLI instead of printing a schema-validated payload, and have the host validate each submission as it arrives and reject it with a reason the agent can act on. Review comment submission already lands as Review Threads through the CLI in `add-core-review-threads`.
- Bound submission validation by the complete changed-file set. KVG-2229 lifts the 100-file cap first, so a submission above that boundary is checked against every changed file instead of a truncated set.
- Give a generation that submits nothing an explicit terminal state, with the session readable so the user can see why.
- Continue the same session in the same workspace for follow-up questions, replacing the batched question runs.
- Keep the session read-only through a Session Tool Policy. It explains and answers; it cannot edit code. Edits belong in a Task with a real branch.
- **BREAKING** Drop the plugin's `pr-ai-review:*`, `pr-ai-threads:*`, and `pr-review-session:*` storage keys and the walkthrough cache status model built around the parse path. Locally stored AI review comments and question threads for existing pull requests do not carry over.

Out of scope, deliberately:

- Scoped sessions raising attention, appearing on the Focus board, or surviving an application restart. That follows `add-scoped-agent-sessions`.
- Walkthrough presentation, step navigation, ticket coverage, and review submission, which keep their current behavior.

## Capabilities

### New Capabilities

- `pr-review-agent-session`: the pull request Agent tab, the scoped session that generates a walkthrough and then discusses it, how walkthrough results are submitted and validated, and what happens when nothing is submitted.

### Modified Capabilities

None yet in `openspec/specs`. Pull request walkthrough behavior has never been specified, and the `review-threads` capability this change consumes is still in-flight in `add-core-review-threads`.

## Impact

- Depends on `add-scoped-agent-sessions` for Session Scope, Scoped Workspace, Session Tool Policy, and the host-rendered session terminal.
- Depends on `add-core-review-threads` for scope-bound Review Thread submission and uses the existing agent-facing Plugin Command CLI for walkthrough steps.
- OpenForge CLI and agent authorization: one hidden GitHub Sync walkthrough command on the existing allowlisted Plugin Command route, constrained to the calling Scoped Agent Session.
- GitHub Sync detail tabs: the tab list and its shortcuts, plus the duplicated tab-id union held in both the detail section and the selected-review state.
- GitHub Sync generation: the walkthrough prompt, the walkthrough cache and its status model, the question panel, and retirement of the output schema and the standard-output parsers.
- Removal of the plugin's headless walkthrough generation path once the session path replaces it.
