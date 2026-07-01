# Branch Selector Dedup & Divergence Resolution

**Date:** 2026-06-30
**Status:** Design — approved, pending spec review

## Problem

When starting a task from an existing branch, the branch selector in
`AddTaskDialog` lists local and remote branches as **separate entries** — a
local `foo` and a remote `origin/foo (remote)` appear as two rows for what the
user thinks of as one branch. The user then has to understand the subtle
difference between picking the local ref (checkout as-is, no fetch, no
fast-forward, no tracking) and the remote ref (fetch → fast-forward stale local,
or hard-refuse on divergence).

That difference is real but hidden:

- Selecting **local `foo`** → `git worktree add <path> foo`: checks out the
  local branch exactly as-is, even if stale relative to the remote
  (`git_worktree.rs:651`).
- Selecting **`origin/foo`** → fetch, then classify the local branch against the
  remote (`git_worktree.rs:669`):
  - **equal/behind** → reuse local and `merge --ff-only` to the remote tip
    (`git_worktree.rs:685`).
  - **ahead/diverged** → **hard error**, telling the user to delete/rename the
    local branch or "start the task from the local branch to keep your work"
    (`git_worktree.rs:732`).

Two problems follow:

1. **Duplication.** Showing both rows for the same logical branch forces the
   user to reason about ref mechanics they should not have to.
2. **A dead end.** When the local branch has diverged, the only outcome today is
   an error message. The escape hatch it suggests ("start from the local
   branch") only exists because the local entry is shown separately — which this
   design removes.

## Goals

- The selector shows **exactly one entry per branch name** — never both the
  local and remote of the same branch.
- The single entry behaves correctly in every case (local-only, remote-only,
  both-and-aligned, both-and-diverged) without the user choosing a ref kind.
- When the local branch has **diverged** from the remote, replace the dead-end
  error with an **informed choice**: a prompt that shows the divergent commits
  and lets the user keep local, reset to remote, or cancel.

## Non-goals

- Changing the new-branch-from-main path (`worktreeSource = "newBranchFromMain"`)
  or the disabled-worktree path — unchanged.
- Handling working-tree dirtiness. Worktree creation operates on the branch
  **ref**, not a working tree, so only committed state (commits) is ever in play.
- Resolving divergence for a branch currently checked out in the main repo — a
  pre-existing `git worktree add` limitation, out of scope.

## Key constraint: creation and start are separate

`worktreeSource`/`worktreeBranch` are **stored at task creation**
(`app_invoke/core.rs`), but the worktree — and therefore the fetch +
classification in `create_worktree_from_existing_branch` — only runs at **Start
Task** time, via `prepare_start_workspace` (`app_invoke/lifecycle.rs:233`). The
remote can move between those two moments.

Therefore the divergence check is authoritative **only at Start time, right
after the fetch**. The branch selector at create time does *cosmetic dedup
only*; the divergence prompt fires at Start.

## Design

### 1. Selector dedup (frontend, `AddTaskDialog`)

A pure helper merges the `listGitBranches()` result by **short name** (strip the
`origin/` prefix from remotes). The single merged entry's stored `value` — which
becomes `worktreeBranch` — decides backend behavior, so it is chosen
deliberately:

| Branch exists as | Entry label | Stored `value` | Resulting backend path |
|---|---|---|---|
| local only | `foo` | `foo` | local checkout, as-is (unchanged) |
| remote only | `foo` (muted "remote" tag) | `origin/foo` | create tracking branch (unchanged) |
| **both** | `foo` | **`origin/foo`** | remote path → fetch + classify → auto-ff or divergence gate |

The both-case sending `origin/foo` is the linchpin: passing `foo` would take the
local path and silently skip alignment/divergence detection.

**Multi-remote:** collapse local + `origin/<name>` only. A non-origin remote
branch (e.g. `upstream/foo`) remains its own distinct entry, since
`local_branch_from_remote_ref` strips by remote name and dedup-by-short-name
would otherwise hide it.

This helper is pure → unit-tested in isolation.

### 2. Start-time gate (read-only pre-flight — "Approach 1")

New read-only IPC `inspectExistingBranch(repoPath, branch)` → backend
`inspect_existing_branch`. It fetches origin, classifies, and returns **without
creating a worktree or mutating any local branch**:

```ts
interface ExistingBranchPlan {
  relation: "localOnly" | "remoteOnly" | "autoFastForward" | "diverged";
  ahead:  CommitSummary[];  // local-only commits: origin/foo..foo
  behind: CommitSummary[];  // remote-only commits: foo..origin/foo
  remoteReachable: boolean; // false if the fetch failed (stale comparison)
}
interface CommitSummary {
  shortSha: string;
  subject: string;
  author: string;
  relativeDate: string;
}
```

Commit lists are **capped** (50) with an explicit `+N more` indicator surfaced to
the UI — no silent truncation.

Relation is derived as:

- `refs/heads/<short>` only → `localOnly`
- `refs/remotes/origin/<short>` only → `remoteOnly`
- both, local equal-or-behind → `autoFastForward`
- both, local ahead-or-diverged → `diverged` (with populated `ahead`/`behind`)

The Start flow is **centralized in one helper** that every Start entry point
(`TaskContextMenu` "Start Task", and any other call site) routes through:

- `localOnly` / `remoteOnly` / `autoFastForward` → start immediately with
  `resolution: "auto"`. One-click happy path, no modal.
- `diverged` → open the divergence modal; the chosen button supplies the
  resolution; Cancel aborts the start.

### 3. Backend create resolution

`create_worktree_from_existing_branch` gains a `resolution: DivergenceResolution`
parameter (`Auto | KeepLocal | ResetToRemote`). Only the `AheadOrDiverged` branch
(`git_worktree.rs:732`) consults it; all other paths are untouched.

- **Auto** → preserve current behavior. Diverged still returns the structured
  error/signal — a defensive guard, since the frontend pre-flighted. We never
  silently mutate a diverged branch.
- **KeepLocal** → `git worktree add <path> <localBranch>` on the diverged local
  branch as-is. No fast-forward, no reset; ahead commits preserved. This is the
  replacement for today's "start from the local branch to keep your work"
  escape hatch.
- **ResetToRemote** → worktree add on the local branch, then
  `git reset --hard origin/<localBranch>` inside the freshly created worktree
  (clean — a new worktree has no uncommitted changes to lose), then set
  upstream. Discards the ahead commits — the explicitly destructive choice.

The `resolution` flag is threaded from the Start IPC through
`prepare_start_workspace` into `create_worktree_from_existing_branch`.

### 4. The divergence modal

Store-driven global component (`BranchDivergenceModal.svelte`) that the Start
helper awaits as a Promise (`await resolveBranchStart(task)` → resolution or
cancel). Contents:

> **`foo` has diverged from `origin/foo`** — 2 ahead, 1 behind.
> **Your local commits (lost if you reset):**
> &nbsp;&nbsp;`a1b2c3d` Fix null check · `e4f5g6h` WIP refactor
> **On remote, not local:**
> &nbsp;&nbsp;`9z8y7x6` Update README
> **[Keep local]** start on your branch as-is ·
> **[Reset to remote]** discard the 2 local commits ·
> **[Cancel]**

When `remoteReachable` is false, the modal shows a muted "couldn't reach remote —
comparison may be stale" note.

### 5. IPC & types

- `src/lib/ipc.ts`: add `inspectExistingBranch()`; thread an optional
  `divergenceResolution` through the existing start wrapper.
- Shared types (`ExistingBranchPlan`, `CommitSummary`, `DivergenceResolution`)
  live alongside `GitBranchInfo` in `packages/plugin-sdk/src/domain.ts`, matching
  existing convention.
- Rust command boundary returns `Result<T, String>` per repo conventions; IPC
  payload uses camelCase (`repoPath`, `divergenceResolution`).

## Edge cases

- **Offline / fetch fails:** `fetch_origin_best_effort` already swallows the
  failure; classification falls back to the cached tracking ref and
  `remoteReachable` is reported `false` so the modal can warn.
- **Branch checked out in main repo:** pre-existing `git worktree add`
  limitation; unchanged.
- **Commit list longer than cap:** show first 50 + `+N more`.

## Test plan (TDD — business logic only)

**Rust (`cargo test` from `src-tauri/`):**

- `inspect_existing_branch` classification across all four relations, with
  correct `ahead`/`behind` commit lists, using temp git repos.
- `create_worktree_from_existing_branch` with `KeepLocal` (ahead commits survive;
  worktree HEAD == local tip) and `ResetToRemote` (worktree HEAD == remote tip;
  ahead commits gone).
- `Auto` + diverged still returns the structured error/signal.
- Commit-list cap behavior.

**Vitest:**

- The dedup helper: all collision cases (local-only, remote-only, both,
  multi-remote) and the correct stored `value` per case.
- The Start-resolution router: relation → `auto` start vs. opens-modal.

No assertions on CSS, Tailwind utilities, or visual styling.

## Open questions

None blocking. Reset-to-remote semantics, modal copy, and the cap value (50) are
the adjustable knobs.
