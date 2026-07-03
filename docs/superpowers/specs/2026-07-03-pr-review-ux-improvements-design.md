# PR Review UX Improvements — Design

**Task:** AVIV-157
**Date:** 2026-07-03
**Status:** Approved design, pending implementation plan

## Problem

Reviewing a pull request in Open Forge's PR review tab is harder than it should be:

1. **Horizontal scrolling in split view.** Each side of the side-by-side diff scrolls
   horizontally, so long lines are cut off and the reviewer must scroll left/right in
   addition to up/down. GitHub instead soft-wraps lines to the available width.
2. **The review submit panel is pinned to the bottom.** The comment box + Approve /
   Request changes / Comment controls permanently occupy bottom height, shrinking the
   diff viewport. On long PRs this wastes vertical space.
3. **No keyboard navigation in the file tree.** Moving between files and
   expanding/collapsing folders requires the mouse.
4. **Review progress isn't visible in the file tree.** The "Reviewed" checkbox only
   exists in each file's diff header, so the file list doesn't show which files are done.
5. **Tab buttons are on the right.** Overview / Files changed / Walkthrough sit on the
   right of the header, inconsistent with the rest of the app where such tabs are on the
   left.

## Where the code lives

- **Primary view:** `plugins/github-sync/src/review/pr/PrReviewView.svelte` — the GitHub
  PR review (⌘G) with the Overview / Files changed / Walkthrough tabs and the GitHub
  Approve/Request-changes/Comment submit panel.
- **Shared components** (in `packages/pr-review-ui/src/`), reused by the GitHub PR
  review, the task Self-Review view (`src/components/task-detail/SelfReviewView.svelte`),
  and the Walkthrough tab:
  - `DiffViewer.svelte` — renders the diff via a patched `@git-diff-view/svelte@0.1.6`;
    owns the diff scroll container (virtualized with `@tanstack/virtual-core`), the
    split/unified toggle, the wrap toggle, and the per-file "Reviewed" checkbox.
  - `FileTree.svelte` — the changed-files tree with VSCode-style compact folders.
  - `ReviewSubmitPanel.svelte` — the Approve / Request changes / Comment panel.

**Decision (confirmed): apply shared-component changes everywhere.** Changes #1, #3, and
#4 modify the shared components and therefore also improve the task Self-Review view and
the Walkthrough tab. This is intentional for consistency and minimum code.

## Changes

### 1. Line wrapping in split view (default on)

`DiffViewer.svelte` already has a `diffViewWrap` state (`$state(false)`) and a toolbar
toggle that passes `diffViewWrap` to `<DiffView>`; `@git-diff-view/svelte` wraps long
lines when it is `true`.

- Change the default to **on** (`true`).
- Persist the toggle choice in `localStorage` (e.g. key
  `openforge.prReviewUi.diffViewWrap.v1`) so the reviewer's preference survives navigation
  and app restarts. Read the persisted value on init, falling back to `true`.
- Keep the existing toggle button so horizontal scroll remains available on demand.

No CSS changes needed — the library handles wrapping via the prop.

### 2. Un-pin the review submit panel

Today `ReviewSubmitPanel` is rendered as a `shrink-0` sibling **below** `DiffViewer`, so
it always occupies bottom height while the diff scrolls in its own
`overflow-y-auto` container.

The diff is virtualized: `DiffViewer` renders a `height: {totalSize}px; position: relative`
spacer inside `scrollContainerEl` with absolutely-positioned file rows. Content placed
**after** that spacer, still inside `scrollContainerEl`, flows directly below the last file.

- Add an optional `footer` snippet prop to `DiffViewer`, rendered inside
  `scrollContainerEl` immediately after the virtualized-list spacer (and after any
  "No files" / large-diff notices).
- In `PrReviewView.svelte`, stop rendering `ReviewSubmitPanel` as a sibling; pass it as
  the `footer` snippet to `DiffViewer` (Files tab only).
- The footer is optional, so the Self-Review and Walkthrough usages (which pass no footer)
  are unchanged.

Result: the diff gets full height; the reviewer scrolls past the last file to reach the
submit controls.

### 3. Keyboard navigation in the file tree

`FileTree.svelte` has `selectedFile` and `expandedDirs` state but no keyboard handling.
Add arrow-key navigation using a roving-tabindex pattern (honoring the existing
`FileTree.accessibility.test.ts`):

- **ArrowDown / ArrowUp** — move selection to the next/previous **file** in the currently
  visible, flattened file order (files under collapsed folders are skipped). Selecting a
  file calls the existing `onSelectFile(filename)`, which the host wires to
  `diffViewer.scrollToFile(...)`, bringing that file to the top of the diff pane.
- **ArrowRight** — expand the folder that directly contains the selected file (if
  collapsed).
- **ArrowLeft** — collapse the folder that directly contains the selected file (if
  expanded).
- The selected row receives focus and is scrolled into view within the tree
  (`scrollIntoView({ block: 'nearest' })`).
- Clicking a file focuses the selected row so the arrows work immediately afterward.

**Model notes:** ArrowUp/Down operate on files only; folders are toggled via
ArrowLeft/Right on the selected file's immediate parent folder (matching the user's
description). Collapsing a folder that contains the selected file hides the row but keeps
it logically selected; ArrowRight re-expands, ArrowDown moves to the next visible file.
Compact (chained) folders toggle as a unit via their node path.

### 4. Reviewed checkbox in the file tree

`FileTree` already receives `reviewedFileShas` and `getFileReviewIdentity` and draws a
strike-through on reviewed files. Add a real checkbox per file row:

- Add an `onToggleFileReviewed?: (file: PrFileDiff, reviewed: boolean) => void` prop to
  `FileTree` (mirroring `DiffViewer`'s prop).
- Render a small checkbox on each file row reflecting `isFileReviewed(file)` (same
  identity logic already used for the strike-through).
- The checkbox's `change`/`click` stops propagation so it toggles review state without
  triggering file selection/scroll.
- Hosts (`PrReviewView.svelte`, `SelfReviewView.svelte`) pass the same
  `handleToggleFileReviewed` they already pass to `DiffViewer`, so the tree and diff
  headers stay in sync.

### 5. Swap tab buttons to the left

In `PrReviewView.svelte`'s header second row, the order is currently
`[PR metadata] …flex-1 spacer… [Overview][Files changed][Walkthrough]`.

- Reorder to `[Overview][Files changed][Walkthrough] …flex-1 spacer… [PR metadata]` so the
  tabs pin to the left and the metadata (`#num · author · time`) moves to the right of the
  same row.
- No behavior change; tab state and the `1/2/3` shortcuts are untouched.

## Testing strategy

Follow TDD for the behavioral changes; use targeted verification for purely visual ones
(no CSS/utility-class assertions, per project rules).

- **#3 keyboard nav** (business logic): unit tests on `FileTree.svelte` — ArrowDown/Up
  select next/previous visible file and fire `onSelectFile`; ArrowRight/Left
  expand/collapse the selected file's parent folder; collapsed folders are skipped by
  Up/Down.
- **#4 tree checkbox** (business logic): unit tests — toggling the checkbox fires
  `onToggleFileReviewed(file, reviewed)` with correct args; checkbox reflects
  `reviewedFileShas`; toggling does not fire `onSelectFile`.
- **#1 wrap default/persistence**: unit-test the persistence helper (default `true`,
  round-trips a stored value) rather than asserting on classes.
- **#2 footer** and **#5 tab swap**: primarily layout. Verify with a light render/behavior
  check (footer snippet renders inside the scroll region; submit actions still fire) and
  manual/visual confirmation in the running app — no CSS assertions.

Verification gates (per project conventions):
- Plugin changes: `pnpm --filter @openforge/plugin-github-sync exec vitest run <path>`.
- Shared package: `pnpm --filter @openforge/pr-review-ui exec vitest run <path>`
  (or the package's own vitest).
- Frontend/types: `pnpm exec tsc --noEmit`.
- Post-implementation code review before handoff.

## Out of scope

- Redesigning the diff viewer toolbar, comment threading, or the Overview/Walkthrough tab
  contents.
- Changing the review submission flow/logic itself (only the panel's placement changes).
- Unrelated refactors of `PrReviewView.svelte` beyond the header reorder and footer wiring.
