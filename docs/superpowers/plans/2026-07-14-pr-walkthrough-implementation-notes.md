# PR Walkthrough + AI Review + Q&A — Implementation Notes & Open Items

Cross-cutting caveats and decisions that don't belong to a single plan task. Read this **before** starting execution. Companion to the four plan docs and the spec (`docs/superpowers/specs/2026-07-14-pr-walkthrough-ai-review-and-agent-qa-design.md`).

## Execution order

Implement **1 → 2 → 3 → 4**:

1. `2026-07-14-pr-repo-aware-agent-runtime.md` (Rust runtime)
2. `2026-07-14-pr-combined-walkthrough-and-ai-review.md` (generation)
3. `2026-07-14-pr-walkthrough-trigger-and-button-lifecycle.md` (button UI)
4. `2026-07-14-pr-ask-the-author-qa-threads.md` (Q&A threads)

**Plan 2 must land before Plan 3.** Plan 2 removes `prompt` from the `startAgentWalkthrough` request (the prompt is now compiled server-side from server-fetched diffs). Plan 3's card button calls that new signature. Building Plan 3 first leaves a call that passes a `prompt` the handler no longer accepts.

## Open items (not yet resolved in any plan task)

### 1. Global concurrency cap — DECIDE: implement or consciously defer
The spec (decision R6) called for capping concurrent generations globally (1–2) and queueing the rest, but **no plan task implements it.** As written, every button click / question batch spawns its own PR-head checkout + a 1–2 minute `claude` process with no ceiling — clicking "Generate" on several PRs runs them all at once (N worktrees + N agents + N× disk/CPU).

Options:
- **Defer (simplest):** accept unbounded parallelism for v1; realistically the user triggers one at a time. Just say so explicitly.
- **Implement:** a semaphore/queue. Cleanest home is the Rust side (Plan 1's `agent_generate_in_repo`) since it already owns a session registry — gate concurrent `agent_generate_in_repo` runs there so both walkthrough generation and Q&A batches share one limit. A frontend-only cap would miss the Q&A path.

Whichever you pick, make it a deliberate choice, not an accident of omission.

### 2. Stale per-commit storage is never pruned + the "stale" UX diverges from the spec
All state is keyed by `(prId, headSha)`: `walkthrough:*`, `pr-ai-review:*`, `pr-ai-threads:*`. Two gaps:
- **Orphaned storage:** `deletePrWalkthrough` clears the *current* key only. When a new commit lands, the previous SHA's walkthrough/review/threads stay in plugin storage forever. Add pruning — e.g. on generate for a new SHA, delete entries for the PR's older SHAs (list keys by the `*:${prId}:` prefix), or prune on PR open.
- **Stale UX:** the spec said a stale (older-SHA) walkthrough/review/threads should render **read-only** with a "from commit `abc`" banner. The plans instead key strictly by the current SHA, so a new commit shows **empty** until regeneration and the old content is simply not loaded. If the read-only-stale experience matters, it needs explicit work (load the newest available entry, compare SHA, render read-only). Otherwise, document that "new commit → regenerate" is the accepted v1 behavior.

### 3. Add `--no-session-persistence` to the repo-aware headless command
Plan 1's Global Constraints list `--no-session-persistence` as part of this repo's headless `claude` convention, but the `headless_command` implementation in Plan 1 Task 2 does **not** emit it (the diff-only `agent_generate` never did either). The other headless callers (`roadmap_ai.rs`, `task_metadata_refresh/providers.rs`) do use it. Add `--no-session-persistence` to the `claude-code` arg vector (at least for the `ReadAndGitHistory` / repo-aware path) so these one-shot review runs don't accumulate session history. Update the Task 2 arg-building test accordingly.

### 4. The `claude --allowedTools` grammar is the load-bearing unknown — verify FIRST
Plan 1 Task 2 Step 5 is a manual smoke test confirming that `--allowedTools "Read Grep Glob Bash(git log:*) …"` (with `--permission-mode dontAsk`) actually lets the agent read/grep/`git log` **and** blocks Write/Edit/general Bash on the installed CLI version. The entire Tier-2 policy — and the safety story — rests on this. Run it before building anything on top; if the accepted grammar differs (comma-separated, repeated flags, different tool identifiers), adjust `READ_AND_GIT_HISTORY_TOOLS` and the arg construction, then continue.

## Product-intent reminders (shape the prompts, not the code)

- The target is "the all-knowing PR author sitting next to you" — explain *why*, using the checked-out repo + `git log`/`blame`, not just *what*. The agent **cannot** recall a real author's arbitrary private intent; for genuinely arbitrary choices it should give a grounded best guess and say it's a judgment call (Plan 4's question prompt already instructs "if a choice was arbitrary, say so"; keep that spirit in Plan 2's review prompt too).
- Everything the AI produces (review remarks, Q&A answers) stays **local** — never pushed to GitHub. The only path to GitHub is the reviewer explicitly approving an AI remark into pending comments, or writing a human-destined comment, both via the existing submit flow.
