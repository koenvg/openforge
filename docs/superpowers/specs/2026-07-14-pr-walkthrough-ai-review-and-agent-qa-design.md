# PR Walkthrough + AI Review + Ask-the-Author Q&A — Design

**Task:** AVIV-208
**Date:** 2026-07-14
**Status:** Approved design, pending implementation plan

## Goal

Turn the PR walkthrough from "an AI that read only the diff" into **an all-knowing PR
author sitting next to you**: an agent that has the *actual repository checked out*, so it
can explain not just *what* changed but *why*, and how it fits the surrounding code.

Concretely, one opt-in background pass produces **two** things at once:

1. **The walkthrough** — the PR broken into logical steps (exists today).
2. **An AI review** — the agent's own inline remarks, placed where it sees fit, as pending
   review comments.

After that pass, the reviewer can also **ask their own questions** on any line or step and
have the same agent answer them (a private, back-and-forth thread) — or route a comment to
the *real* human author on GitHub as today.

## Why now / what's wrong today

- The walkthrough agent is **not really an agent**. `agent_generate.rs` runs
  `claude --print --output-format text` in the user's **home directory** with **no repo
  access** (`run_child` sets `current_dir(home)` — *"the prompt is fully self-contained, so a
  neutral working directory is fine"*). It sees only the diff text piped on stdin. It cannot
  open another file, trace a caller, or read a config. So "why this and not that?" is
  unanswerable from where it stands.
- There is no way to ask the walkthrough a follow-up question, and no AI-authored review.

## Where the code lives

**Walkthrough (frontend + plugin):**
- `plugins/github-sync/src/review/pr/WalkthroughTab.svelte` — `initWalkthrough()`,
  `handleGenerate()`, `loadCachedWalkthrough()`, 2.5s completion polling.
- `plugins/github-sync/src/review/pr/PrReviewView.svelte` — owns the Overview / Files
  changed / Walkthrough tabs and the shared comment stores (`pendingManualComments`,
  `reviewComments`, `agentReviewComments`), `submitReview(...)`.
- `plugins/github-sync/src/review/pr/githubSyncClient.ts` — `startAgentWalkthrough`,
  `getPrWalkthrough`, `deletePrWalkthrough`, `submitPullRequestReview`, `listReviewComments`.
- `plugins/github-sync/src/backend.ts` — `startAgentWalkthrough` handler (`WALKTHROUGH_MODEL
  = 'sonnet'`), calls `invokeHostCommand('agentGenerate', …)`.
- `plugins/github-sync/src/lib/` — `walkthroughPrompt.ts` + `walkthroughPrompt.md`
  (prompt), `walkthroughStore.ts` (`beginWalkthroughGeneration`, `runWalkthroughGeneration`,
  `extractWalkthroughStepsJson`), `walkthroughParse.ts` (`parseAndValidateWalkthroughSteps`),
  `walkthroughViewState.ts`, `hunkParser.ts`.

**Comments (shared UI):**
- `packages/pr-review-ui/src/DiffViewer.svelte` — `onAddWidgetClick`, `submitInlineComment`;
  controlled/uncontrolled pending comments. Comments key by `path + line + side`.
- `packages/pr-review-ui/src/diffComments.ts` — `buildExtendData()` already distinguishes
  **`existingComments` / `pendingComments` / `agentComments`** and renders threads (parent +
  replies) inline. This is the hook for both the AI review remarks and the Q&A answers.
- `packages/pr-review-ui/src/ReviewSubmitPanel.svelte` — Comment / Approve / Request changes.
- `ReviewSubmissionComment { path, line, side, body }` in `packages/plugin-sdk/src/domain.ts`.

**Agent runtime (Rust):**
- `src-tauri/src/app_invoke/agent_generate.rs` — `run_headless_generation`, `run_child`
  (`current_dir(home)`, `--print --output-format text`, `kill_on_drop`, 240s timeout,
  session-key abort registry), `headless_command` (only `claude-code` supported).

**Checkout machinery (Rust):**
- `src-tauri/src/git_worktree.rs` — `create_worktree`, `create_worktree_from_existing_branch`,
  `try_create_worktree_inner` (`git worktree add`), `remove_worktree`,
  `fetch_origin_best_effort`, `fetch_origin_succeeded`.
- `src-tauri/src/db/projects.rs` — `ProjectRow.path` (local clone path).
- `src-tauri/src/github_runtime/repo_resolution.rs` — `resolve_project_repo_from_path()`
  (origin remote → `owner/repo`).
- `src-tauri/src/db/review.rs` — `review_prs` stores `repo_owner`, `repo_name`, `head_sha`,
  `head_ref` (no FK to a project).

## Confirmed decisions

1. **Code access: local checkout.** Fetch the PR head and check it out; point the agent's
   working directory there. (Not the API-file-tool alternative.)
2. **Tool policy: Tier 2 — read + git history.** Agent may read/search any file and run a
   whitelist of history commands (`git log`, `git blame`, `git show`). **No general shell.**
   Rationale: blame/history is where "why" often lives; stays fast and predictable.
   (Prompt-injection is explicitly *not* a concern for this product.)
3. **Q&A batching: one agent answers the whole batch.** Bulk-send N questions → **one**
   agent run explores once and answers all N, rather than N agents each re-reading the repo.

## User experience / flow

1. **PR list (left rail).** Each PR to review shows a **"Generate Walkthrough + AI Review"**
   button. The Walkthrough tab is **hidden** until generation completes — open a PR without
   clicking, and you see only **Overview** and **Files changed**.
2. **Click the button.** The background pass starts. The PR **stays unread**. The button
   reflects progress and, on success, flips to **"Walkthrough ready"**.
3. **Open the walkthrough.** The third tab appears with the steps *and* the AI's review
   remarks already present as pending agent comments (visible in Files changed too).
4. **Ask the author.** On any line (or on a whole step) you add a question. It's a **pending
   comment with destination = AI**. You keep reviewing and leaving more.
5. **Send.** Like submitting a GitHub review, you bulk-send. Pending questions routed to the
   **AI** go to one agent run and answers land back in their threads. Pending comments routed
   to the **human author** submit to GitHub via the existing flow.
6. **Follow up.** Reply inside an answered AI thread; the agent runs again with that thread's
   history and answers again.

## Architecture

### A. Trigger & button lifecycle

- Move triggering out of the tab's `$effect` (which auto-generates on open) to an **explicit
  button** in the PR list. The Walkthrough tab renders **only when** a `ready` walkthrough
  exists for the current `(pr_id, head_sha)`. While `generating`/`error`, the tab stays hidden
  and the button carries the state — the tab appears only once ready.
- Button states: `idle → generating (with coarse phase) → ready → error`; plus `stale` when
  `head_sha` moved (reuses today's staleness banner logic).
- Generating does **not** mark the PR read (read-state is unchanged by generation).

### B. The one background pass (checkout + agent)

Upgrade the existing fire-and-forget generation so it is **repo-aware** and emits **both**
steps and review comments:

1. **Checkout (net-new).** Resolve the PR's base repo to a local project clone
   (`resolve_project_repo_from_path`). Then:
   - `git fetch origin refs/pull/{N}/head` — note GitHub exposes the PR head under the *base*
     repo's `refs/pull/{N}/head` **even for fork PRs**, so this covers forks as long as the
     base repo is a local project.
   - Create a **temporary detached worktree at `head_sha`** (extend `git_worktree.rs`;
     today it always creates a *named branch* — we need a detached / throwaway checkout).
   - Pass that worktree path to the agent as its working directory. **Clean up** the worktree
     when generation finishes (success or failure).
   - If the base repo is **not** a local project (uncloned) → see Failure modes (E5).
2. **Agent run (extend `agent_generate.rs`).** Add optional `workingDirectory` and a
   `toolPolicy` to the headless primitive (keep today's home-dir/no-tools default for
   existing callers). For this path: `current_dir(worktree)`, Tier-2 allowed tools, a
   **longer timeout** than 240s (checkout + exploration + review is bigger work), and a
   **structured output format** (see C). Session-key abort still applies.
3. **Prompt.** Extend the compiled prompt to (a) state that the working directory is a
   checkout of the PR head it may explore, (b) still include the diff + hunk indexes (so it
   knows what changed), (c) ask for the combined output contract below.

### C. Output contract (combined)

One JSON object with both payloads:

```
{
  "steps": [ { "id", "title", "summary", "files": [ { "filename", "hunk_indexes" } ] } ],
  "review_comments": [
    { "filename", "line", "side": "LEFT"|"RIGHT", "body", "kind": "question"|"suggestion"|"note" }
  ]
}
```

- `steps` — unchanged from today; parsed/validated by `parseAndValidateWalkthroughSteps`.
- `review_comments` — validated the **same way** the walkthrough validates hunks: drop any
  comment whose `filename` isn't in the diff or whose `line/side` isn't a **commentable diff
  line** (GitHub only accepts comments on diff lines). The agent read the whole repo but can
  only *pin* remarks to changed lines; broader observations go into the relevant step summary
  or a PR-level note (see remaining decision R1).
- Valid `review_comments` load into the existing **`agentReviewComments`** store and render
  via `buildExtendData`'s `agentComments` channel, with the existing agent-comment status
  lifecycle (`onUpdateAgentCommentStatus`) for dismiss/keep.

### D. Ask-the-author Q&A threads

- **Anchors (v1):** a **line** (`filename` + `line` + `side`) or a **step** (`step_id`).
  (File-level / PR-level anchors are out of scope for v1 — R1.)
- **Pending question = a pending comment with `destination: 'ai'`.** Reuses the pending-comment
  UX; adds a per-comment destination toggle (`ai` | `github`).
- **Send (batch):** partition pending comments by destination.
  - `github` → existing `submitPullRequestReview` flow (unchanged).
  - `ai` → **one** `agentGenerate` run against a fresh checkout of `head_sha`, given: the
    diff, each question with its anchor context, and (for follow-ups) that thread's prior
    messages. Returns structured answers keyed by question/thread id; append each answer to
    its thread as an `ai` message and mark the thread `answered`.
- **Threading is stateless-replay:** each run is a fresh agent; "memory" = we replay the
  thread's message history into the prompt. No long-lived warm process in v1.
- **Follow-ups:** replying in an answered thread creates a new pending `user` message; sending
  it (individually or in the next batch) triggers another run with that thread replayed.

### E. Routing, storage, staleness — summarized (details in Remaining decisions)

- **Routing:** every user comment carries `destination`; AI-bound stay local, human-bound go
  to GitHub.
- **Storage:** AI review comments and Q&A threads persist in **plugin storage**, keyed by
  `(pr_id, head_sha)` — consistent with how the walkthrough already persists. **Local-only**;
  never pushed to GitHub (except human-routed comments, which use the normal submit path).
- **Staleness:** everything is pinned to `head_sha`. A new commit marks the whole set stale
  (today's banner); stale threads/remarks become read-only "from commit `abcdef`". No
  automatic line re-anchoring in v1 (R2).

## Data model (new / extended)

- **`PrWalkthrough`** (extend): add optional `phase` (e.g. `checking_out | reading | drafting`)
  for coarse progress; `steps_json` unchanged.
- **AI review comments** (new persisted store, key `pr-ai-review:{prId}:{headSha}`):
  `{ id, filename, line, side, body, kind, status }[]` → loaded into `agentReviewComments`.
- **Q&A threads** (new persisted store, key `pr-ai-threads:{prId}:{headSha}`):
  `{ id, anchor: {type:'line', filename, line, side} | {type:'step', step_id},
     destination, status: 'draft'|'pending'|'answered'|'error',
     messages: [{ role: 'user'|'ai', body, created_at }], created_at, updated_at }[]`.

## Remaining decisions (recommended defaults — decide inline, not blocking)

- **R1 — PR-level / off-diff remarks.** The agent may want to say something not tied to a diff
  line. **Default:** allow a small set of **PR-level notes** surfaced in the walkthrough header
  / a "General" section; keep *line* remarks constrained to diff lines. (Alternative: drop
  off-diff observations entirely.)
- **R2 — Staleness / re-anchoring.** **Default:** invalidate on new `head_sha` (read-only,
  regenerate to refresh). Automatic re-anchoring across shifted line numbers is deferred.
- **R3 — Where AI review comments show.** **Default:** both the Walkthrough per-step diffs
  **and** Files changed — they sync for free via the shared `path+line+side` store (per the
  2026-07-06 comment-sync design).
- **R4 — Progress granularity.** **Default:** coarse phase label on the button
  ("Checking out… / Reading the code… / Drafting review…") from the persisted `phase`;
  token-level streaming is out of scope for v1.
- **R5 — Model.** **Default:** keep `sonnet` for the combined pass; make the model a config
  point so review quality can be tuned (e.g. a stronger model) without code change.
- **R6 — Concurrency.** **Default:** cap concurrent generations globally (1–2) and queue the
  rest; one Q&A batch per PR at a time.
- **R7 — Promote AI → human.** **Default (v1):** no promote/convert action; an AI thread and a
  GitHub comment are separate. (Nice-to-have later: "post this to the real author".)

## Failure modes

- **E1 — Agent timeout / crash:** surface `error` state + "Try again" (reuses today's pattern).
- **E2 — Invalid JSON:** extract/validate and drop invalid entries; if nothing valid, `error`.
- **E3 — Checkout fetch fails** (network, ref missing): `error` with actionable message; retry.
- **E4 — Worktree cleanup:** always remove the temp worktree on completion/abort
  (`kill_on_drop` covers the process; worktree removal is explicit).
- **E5 — Base repo not a local project (uncloned):** v1 does **not** silently degrade to the
  old diff-only agent. Instead, show a clear "code not available locally — clone/add this repo
  as a project to enable the walkthrough" state. (Deciding whether to auto-clone is future
  work.)

## Testing strategy

TDD for business logic; no CSS/utility-class or visual assertions (per project rules).

- **Output contract (pure, unit):** parsing/validation of the combined `{steps,
  review_comments}` — valid passes through; comments on non-diff lines / unknown files are
  dropped; empty/edge cases. Extend `walkthroughParse.ts` tests + new review-comment validator.
- **Q&A batching (pure, unit):** partition pending comments by `destination`; build the
  single-agent prompt from N questions + anchors + replayed thread history; map structured
  answers back onto thread ids; status transitions (`pending → answered`/`error`).
- **Button lifecycle (component):** tab hidden with no walkthrough; button state machine
  (`idle→generating→ready→error`, `stale`); generating does not mark read.
- **Threads (component):** add question with destination toggle; answered thread renders the
  `ai` message via the agent-comment channel; follow-up creates a new pending `user` message.
- **Rust (unit where practical):** `headless_command`/`run_child` honor `workingDirectory`,
  Tier-2 tool policy, and the longer timeout; detached-worktree create + cleanup in
  `git_worktree.rs`. Full end-to-end agent runs verified manually in the running app.

Verification gates (per project conventions):
- Plugin: `pnpm --filter @openforge-app/plugin-github-sync exec vitest run <path>`.
- Shared package: `pnpm --filter @openforge-app/pr-review-ui exec vitest run <path>`.
- Frontend/types: `pnpm exec tsc --noEmit`. Rust: `cargo test` (from `src-tauri/`).
- Post-implementation code review before handoff.

## Out of scope (v1)

- Warm/long-lived agent sessions (threads use stateless replay).
- General shell (Bash) tools; running tests/builds inside the agent (Tier 3).
- File-level / PR-wide question anchors beyond the small PR-level notes in R1.
- Automatic re-anchoring of comments/threads across new commits (R2).
- Auto-cloning repos that aren't local projects (E5); promote-AI-thread-to-GitHub (R7).
- Providers other than `claude-code` (headless primitive already errors for others).
