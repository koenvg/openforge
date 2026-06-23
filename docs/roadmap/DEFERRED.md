# Roadmap Board — Deferred Features

Things intentionally **left out of the v1 MVP** of the Roadmap rail view, kept here so we
can find them again. See the design at [`docs/roadmap/design.md`](./design.md).

The original app is **github-roadmap** (https://github.com/Avivhdr/github-roadmap) —
reference it when picking these up.

## Deferred

### 1. Drag-and-drop
- Manual card reordering within a column, and drag-to-relabel across columns.
- Brings back the original's `item_order` table (`roadmap_item_order(project_id, label,
  issue_number, manual_order)`), a `roadmap_set_column_order` command, the fractional-index
  ordering, and the `applyReorder` / `applyRelabel` pure functions.
- Needs a Svelte DnD approach (e.g. `svelte-dnd-action`) replacing the original's React
  `@dnd-kit`.
- In the MVP, cards sort by value desc then issue number desc, and you relabel via the
  drawer instead of dragging.

### 2. Pull-request column & badges
- The pinned "PRs · no issue" column (orphan open PRs) and the PR-closes-issue badge shown
  on an issue card.
- Needs the GitHub **GraphQL** PR query (`closingIssuesReferences`, `statusCheckRollup`,
  `reviewDecision`) — the MVP is REST-only.
- Note: OpenForge core already has PR data (`pull_requests` tables, `github_poller`); check
  whether that can be reused before re-fetching.

### 3. Label color editing & new-label creation
- Color picker on column headers / column settings, recoloring labels on GitHub, and
  creating brand-new labels from the drawer/create dialog.
- Needs `create_label` / `update_label_color` GitHub calls. The MVP only toggles **existing**
  labels on an issue.

### 4. Card-drawer comments
- Read-only display of an issue's comments (author + timestamp + body) in the drawer.
- Needs a `list_comments` GitHub call.

### 5. AI "Refine" ticket drafting
- Rough note → structured issue (title + Markdown body), grounded in repo context
  (README/description/labels), with iterative "refine with feedback".
- **Decision (important):** do **not** use Groq (the original) and do **not** add a separate
  Anthropic/OpenAI API key. Instead **reuse the project's already-configured agent** —
  `ai_provider` is one of `claude-code` / `codex` / `opencode` / `pi` (per-project, falling
  back to global, default `claude-code`). Call that agent's CLI in **non-interactive / print
  mode** (e.g. `claude -p --output-format json`, `codex exec`, `opencode run`) and parse the
  returned JSON. This reuses the user's existing agent login — no new credential, same LLM
  the rest of the app uses.
- Caveat: each provider's headless flags + output shape differ, so this is more than a
  one-liner. Start with the configured agent (usually Claude Code) and its print mode.
- OpenForge currently only launches agents as interactive PTY sessions; this would be the
  first programmatic one-shot call, so add a small headless-invocation helper in core Rust.

### 6. Free repo picker & last-opened-repo
- The original lets you pick **any** accessible repo via a dropdown, independent of context,
  and remembers the last one (`app_state.last_repo`, plus a "list my repos" GitHub call).
- The MVP instead scopes the board to the **active project's** repo. Revisit if
  active-project scoping proves limiting; if added, re-key persistence off `project_id`
  (e.g. back to a `repo` string) and add the repo-list fetch + picker UI.
