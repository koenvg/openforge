# PR Review — Walkthrough Comment Sync & Final Submit Step — Design

**Task:** AVIV-182
**Date:** 2026-07-06
**Status:** Approved design, pending implementation plan

## Problem

In the GitHub PR review view, "Files changed" and "Walkthrough" render the **same**
diff and both let you leave inline line comments — but they don't share state:

1. **Comments don't sync between the tabs.** A comment left while doing the Walkthrough
   is not visible after switching to Files changed (and vice-versa), and is lost on tab
   switch. Root cause: the Walkthrough's `DiffViewer` receives none of the comment props,
   so its comments fall into `DiffViewer`'s internal *uncontrolled* pending-comment state
   instead of the shared store.
2. **The Walkthrough is a dead end.** Its last step is just the last file diff — there's
   no way to see all the pending comments together or to Approve / Request changes /
   Comment from within the Walkthrough.

## Where the code lives

- **Primary view:** `plugins/github-sync/src/review/pr/PrReviewView.svelte` — owns the
  Overview / Files changed / Walkthrough tabs and the shared comment stores. The Files tab
  wires the full comment prop set into `DiffViewer` and renders `ReviewSubmitPanel` as its
  `footer` snippet. Defines `submitReview(...)`.
- **Walkthrough:** `plugins/github-sync/src/review/pr/WalkthroughTab.svelte` — renders a
  per-step `FileTree` + `DiffViewer` fed synthetic per-step files (`buildSyntheticStepFiles`);
  currently passes the viewer **no** comment props.
- **View-state helpers:** `plugins/github-sync/src/lib/walkthroughViewState.ts` —
  `buildSyntheticStepFiles`, `clampStepIndex`, staleness.
- **Shared components** (`packages/pr-review-ui/src/`):
  - `DiffViewer.svelte` — controlled/uncontrolled pending comments:
    `visiblePendingComments = pendingComments ?? internalPendingComments`; writes go to
    `onPendingCommentsChange` when provided, else internal state. Comments keyed by
    `path + line + side` (`diffComments.ts`), so two viewers fed the same store show the
    same comments automatically. Already has an optional `footer` snippet prop.
  - `ReviewSubmitPanel.svelte` — Approve / Request changes / Comment panel.
  - `FileTree.svelte` — the changed-files tree.

## Key facts this design relies on

- The comment stores (`pendingManualComments`, `reviewComments`, `agentReviewComments`)
  live in `PrReviewView` and are **only cleared when leaving the PR** — never on tab
  switch. So once the Walkthrough viewer is fed these stores, "preserved across tab
  switches" is automatic.
- Comments key by `path + line + side`. Feeding the same store to any `DiffViewer`
  syncs comments across tabs with no extra plumbing. In a per-step (partial-hunk) view,
  only comments on currently-visible lines render, but all pending comments persist in the
  store and appear in full in Files changed and in the final Walkthrough step.

## Changes

### 1. Sync comments into the Walkthrough's per-step diff

Thread the shared comment props from `PrReviewView` → `WalkthroughTab` → its per-step
`DiffViewer`:

- Add props to `WalkthroughTab`: `existingComments`, `pendingComments`,
  `onPendingCommentsChange`, `agentComments`, `onAgentCommentsChange`,
  `onUpdateAgentCommentStatus`, `onOpenUrl`. (`repoOwner`/`repoName` come from `pr`.)
- In `PrReviewView`, pass the same store-backed values/callbacks it already passes to the
  Files tab viewer.
- In `WalkthroughTab`, forward these to the per-step `<DiffViewer>` (currently lines
  323-330). This makes the walkthrough viewer *controlled* — comments flow to the shared
  store and appear in Files changed immediately, and survive tab switches.

### 2. Final "Review & submit" step (option A — extra numbered step)

Model the walkthrough as `parsedSteps.length + 1` steps; the extra last one is a full-diff
review step. `parsedSteps` stays pure (parsed from the AI JSON); the `+1` is handled in
view state and the stepper UI.

- **View state (new pure helpers in `walkthroughViewState.ts`, unit-tested):**
  - `totalWalkthroughSteps(parsedSteps)` → `parsedSteps.length + 1`.
  - `isReviewSubmitStep(index, parsedSteps)` → `index === parsedSteps.length`.
  - `clampStepIndex` callers switch to the `+1` total so prev/next, the numbered dots,
    and "of N" all include the final step.
- **Stepper UI:** dots read `1 2 … N N+1`; the final dot / header label is
  **"Review & submit"** (rendered as step `N+1 of N+1`). "Next ▶" on the last real step
  advances into it; "◀ Prev" leaves it back to step N.
- **Final-step render:** instead of the synthetic per-step slice, render the **full**
  `files` in `FileTree` + `DiffViewer`, fed the same comment props as change #1 so every
  existing / pending / agent comment is visible. Render `ReviewSubmitPanel` as the viewer's
  `footer` snippet, wired to a new `onSubmitReview` prop that `PrReviewView` sets to its
  existing `submitReview` handler. This yields Comment / Approve / Request Changes without
  leaving the Walkthrough. Submission clears `pendingManualComments` via the existing panel
  behavior, so the cleared state reflects in both tabs.
- **Props added to `WalkthroughTab` for this step:** `onSubmitReview`. The review
  identifiers the panel needs come from `pr` (`prNumber` = `pr.number`,
  `commitId` = `pr.head_sha`).

### Non-goals / guardrails

- `submitReview` (GitHub submission + already-submitted recovery) stays owned by
  `PrReviewView` — passed down, not duplicated in `WalkthroughTab`.
- The per-step comment sync (change #1) applies to every step, not just the final one.
- No change to the AI walkthrough generation, step parsing, or `DiffViewer` internals
  beyond consuming the already-existing comment/footer props.

## Testing strategy

TDD for the behavioral logic; no CSS/utility-class or visual assertions (per project rules).

- **View-state (business logic, pure):** unit tests in `walkthroughViewState.ts` for
  `totalWalkthroughSteps` (= parsed + 1, incl. empty/edge cases) and `isReviewSubmitStep`
  (true only at the final index), and that `clampStepIndex` bounds against the `+1` total.
- **WalkthroughTab (behavior):** component tests that
  (a) the per-step `DiffViewer` receives `pendingComments` / `onPendingCommentsChange`
  (comment made in a step propagates via the callback);
  (b) navigating to the final step renders `ReviewSubmitPanel` and the full `files`;
  (c) submitting from the final step calls `onSubmitReview` with the pending comments.
- **Cross-tab sync (integration, light):** assert both tabs' viewers are fed the same
  store so a pending comment added in one is present for the other (state-level, not
  pixel-level). Manual confirmation in the running app for the visual/UX feel.

Verification gates (per project conventions):
- Plugin changes: `pnpm --filter @openforge-app/plugin-github-sync exec vitest run <path>`.
- Shared package: `pnpm --filter @openforge-app/pr-review-ui exec vitest run <path>`.
- Frontend/types: `pnpm exec tsc --noEmit`.
- Post-implementation code review before handoff.

## Out of scope

- Changing the AI walkthrough generation, step schema, or diff rendering internals.
- Changing the review submission flow/logic (only where the panel is rendered).
- Reviewed-file ("viewed") state in the Walkthrough. The per-step diff shows only partial
  hunks, so a per-file "reviewed" toggle there would be ambiguous; the Walkthrough keeps
  its current no-reviewed-checkbox behavior. Reviewed state stays a Files-changed concern.
- The task Self-Review view and Overview tab.
- Unrelated refactors of `PrReviewView.svelte` / `WalkthroughTab.svelte` beyond the prop
  threading and final-step wiring above.
