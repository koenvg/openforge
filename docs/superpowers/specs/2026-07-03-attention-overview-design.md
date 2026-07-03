# Attention Overview — design

**Task:** AVIV-148
**Mockup:** `docs/superpowers/mockups/attention-overview.html`

## Problem

When finishing a task, finding "what to do next" is scattered: focus-column tasks live per-project, review-requested PRs are behind a badge per project, and other projects have their own waiting tasks and PRs. The user has to click through everything to assemble the picture.

## Solution

A single keyboard-triggered dialog that aggregates, **across all projects**, the two things that need the user's attention:

1. **Focus tasks** — the tasks in each project's Focus column.
2. **Review requests** — the unwatched review-requested PRs for each project (the same set the per-project rail badge counts).

### Trigger

`⌘⇧A` ("Attention"). Free (used: ⌘B/D/H/K/N/P, ⌘⇧P/⌘⇧F, ⌘,), avoids the ⌘A select-all conflict, and matches the existing ⌘⇧P / ⌘⇧F global-overlay pattern. Toggles the dialog open/closed.

### Data semantics

- **Focus tasks (per project):** `status === 'doing'` and **not** in that project's low-fire set — i.e. the whole Focus column as `filterTasks(tasks, 'focus')` defines it (matches the approved mockup, which includes running agents). Within a project, ordered attention-first (needs-action states via `isFocusTask`) then in-flight, each by recency. Each row shows the computed `TaskState` (running / waiting / idle dot + reason).
- **Review requests (per project):** review PRs where `viewed_at === null` and not `DO NOT REVIEW` (i.e. `isUnopened`), not in the global excluded-repos set, whose `owner/name` matches the project's resolved repo. This is exactly the existing badge logic (`prReviewBadgeCounts`). A PR whose `viewed_head_sha` no longer matches HEAD is auto-reset to unviewed by the backend, so a re-pushed PR reappears.
- **PR → project mapping:** via each project's cached `resolved_repo` config. First project (in sidebar order) owning a repo claims its PRs. Review PRs matching no local project fall into an **"Other repositories"** group at the bottom, so nothing that needs attention is silently dropped.
- **Empty projects are hidden.** Only projects with ≥1 focus task or review PR appear.

### Ordering & scroll

- Projects appear in **exact sidebar order** (never reordered).
- On open, the dialog **auto-scrolls to the project the user is currently viewing** and marks it "viewing". If the active project has nothing pending (hidden), it scrolls to the top.

### Layout (see mockup)

- Centered overlay (reuses `Modal`), grouped by project.
- Each project is a **collapsible disclosure**: header with a caret; items nested under an indented guide rail so a project reads as a group, not one flat list.
- Count badges ("N focus / N reviews") show **only when the project is collapsed** (expanded shows the items already).
- Collapse state is **remembered per project**, persisted in config (global key `attention_overview_collapsed_projects`, a JSON array of project ids).

### Keyboard navigation

One cursor over a flattened sequence of [project header, …its items when expanded]:

- **↑/↓** (and `k`/`j`) — move through headers and items.
- **←** (and `h`) — collapse: on an item, collapse its project and move the cursor to the project header; on a header, collapse it.
- **→** (and `l`) — expand a collapsed project (cursor stays on the header).
- **↵** — open the item (task: switch project + open detail; PR: see below) or toggle a header.
- **esc** — close.

### Actions on open

- **Task:** close dialog, switch `activeProjectId` to the task's project (await task load to avoid the selected-task clear race), then `router.navigateToTask`.
- **PR:** close dialog, open `pr.html_url` via `openUrl`, and mark it viewed (`markReviewPrViewed` + optimistic `reviewPrs` update) so it drops off the overview and the badge — consistent with the existing "opening a review = viewed" semantics. *(Open decision: browser vs in-app review view. Browser chosen for v1 to avoid coupling to github-sync plugin internals; easy to switch later.)*

## Components / files

- **`src/lib/attentionOverview.ts`** — pure aggregation: `buildAttentionOverview(input) → AttentionOverview`. Unit-tested.
- **`src/components/shared/AttentionOverviewDialog.svelte`** — presentation, collapse persistence, keyboard nav. Loads cross-project data on open (`getAllTasks`, `getLatestSessions`, per-project `resolved_repo` + low-fire).
- **Wiring:** `appShortcutDefinitions.ts` (+`AppShortcutAction`), `appShortcuts.ts` (handler), `App.svelte` (state, render, handlers, shortcut help entry).

## Testing

- Unit tests for `buildAttentionOverview`: focus filtering (low-fire excluded, backlog/done excluded), attention-first ordering, review filtering (viewed/DO NOT REVIEW/excluded repos), PR→project first-match + Other bucket, empty-project hiding, sidebar order preserved, totals.
- No CSS/visual assertions (per repo test policy).
