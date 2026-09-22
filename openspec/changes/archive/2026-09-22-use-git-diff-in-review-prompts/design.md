## Context

The built-in prompt currently renders one JSON object per changed file before its Git instructions. Each object contains the current filename, previous filename, status, line counts, and hunk indexes. The agent can derive every field except the hunk indexes from the scoped checkout.

The walkthrough validator still needs filenames and hunk indexes from its host-owned snapshot. Local Git hunk boundaries are not the validation contract, so the prompt cannot safely ask the agent to infer those indexes from `git diff`. The scoped checkout is pinned to the pull request head, and prompt generation receives the pull request's base branch name.

## Goals / Non-Goals

**Goals:**

- Make Git inspection the explicit source for changed files, rename information, diff content, and history.
- Compare the pull request head with the merge base of its configured target branch.
- Keep only the host data needed for valid walkthrough-step submissions.

**Non-Goals:**

- Change the walkthrough step payload, validation snapshot, storage, or CLI commands.
- Add patch bodies to the prompt.
- Add a new host command for querying coordinates.
- Change how scoped workspaces fetch or retain Git refs.

## Decisions

### Put the Git inspection contract before walkthrough guidance

The prompt will identify the supplied pull request base branch and tell the agent to resolve its available remote-tracking or local ref. It will then prescribe three-dot comparison against `HEAD` for the changed-file summary and full diff. It will also point to the commit range and existing `git show` and `git blame` tools for intent and history.

The instructions will explicitly reject reviewing only `HEAD^` or the latest commit. A pull request may contain several commits, and three-dot diffing matches the change since the base and head diverged. The examples will use a symbolic resolved base rather than hard-coding `main`, because pull requests may target release branches.

We considered leaving the current generic `git diff` sentence in place. That does not tell the agent which comparison to make and allows two-dot, latest-commit, or working-tree-only interpretations.

### Move a reduced coordinate block beside step submission

The prompt compiler will replace the current changed-file formatter with a submission-coordinate formatter. Each JSON line will contain only `filename` and `hunk_indexes`, using JSON encoding so unusual filenames cannot alter record boundaries. The template will place this block beside the walkthrough-step contract and explain that it is for submission only.

We considered removing the block and requiring `hunk_indexes: null`. That would stop an agent from assigning unrelated hunks in one file to different conceptual steps. We also considered deriving indexes from local Git output, but those indexes would not be authoritative for the host snapshot.

### Preserve the existing generation and validation flow

`WalkthroughPromptInput.files`, snapshot creation, step validation, and the submission command remain unchanged. Only prompt formatting and wording change. The compiler still has the complete file data, but it serializes only submission coordinates into the prompt.

This keeps the change within the GitHub Sync prompt module and avoids a migration or compatibility path for stored walkthroughs.

## Risks / Trade-offs

- [The base ref is absent or stale in the checkout] -> Name the exact pull request base branch, tell the agent to resolve the remote-tracking ref first, and allow it to use Git to obtain the ref when needed. Passing an exact base SHA or changing workspace fetch behavior remains outside this change.
- [The smaller coordinate block removes convenient status and line-count hints] -> The prompt requires `git diff --stat` and `git diff --name-status --find-renames` before the full diff.
- [The agent treats coordinates as review content again] -> Place the block under the submission contract and state that Git is the source for understanding the change.
