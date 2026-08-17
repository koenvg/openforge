# PR Review Walkthrough — Comment Sync & Final Submit Step — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make PR-review inline comments shared between the "Files changed" and "Walkthrough" tabs, and give the Walkthrough a final full-diff "Review & submit" step instead of dead-ending on the last file diff.

**Architecture:** Both tabs render the same `DiffViewer` and all comment state already lives in shared Svelte stores in `PrReviewView.svelte`. The Walkthrough's `DiffViewer` currently receives none of those props, so comments there fall into the viewer's uncontrolled internal state and are lost. The fix is (1) thread the shared comment props into the Walkthrough viewer, and (2) model the walkthrough as `parsedSteps.length + 1` steps where the trailing step shows all files + `ReviewSubmitPanel`.

**Tech Stack:** Svelte 5 (runes), TypeScript, Vitest + `@testing-library/svelte`, the `@openforge-app/pr-review-ui` shared package, the `@openforge-app/plugin-github-sync` plugin.

## Global Constraints

- Svelte 5 runes only (`$state`, `$derived`, `$effect`, `$props()`); `on`-prefixed callback props; local `Props` interface. (project CLAUDE.md)
- Tests cover business logic / behavior only — **no** assertions on CSS classes, Tailwind utilities, or visual styling. (project CLAUDE.md)
- Do not disable ESLint/TypeScript errors — fix them. (user global)
- Map-store reactivity aside, prefer plain prop threading; do not call raw IPC/preload from components — comment submission stays via the injected `onSubmitReview` callback. (project CLAUDE.md)
- Plugin test command: `pnpm --filter @openforge-app/plugin-github-sync exec vitest run <path>`.
- Typecheck: `pnpm exec tsc --noEmit` (note: local runs may fail with a `TS6` `ignoreDeprecations` env artifact unrelated to this change; CI typecheck is authoritative).
- New required props on `WalkthroughTab` must be passed by its only consumer, `PrReviewView.svelte`, in the **same** task, so every task compiles and its tests pass on their own.

---

### Task 1: Walkthrough step-count helpers

Two pure helpers so the Walkthrough can treat itself as having one extra "Review & submit"
step after the parsed steps. Pure functions, unit-tested alongside the existing helpers.

**Files:**
- Modify: `plugins/github-sync/src/lib/walkthroughViewState.ts`
- Test: `plugins/github-sync/src/lib/walkthroughViewState.test.ts`

**Interfaces:**
- Consumes: `PrWalkthroughStep` from `@openforge-app/plugin-sdk/domain` (already imported).
- Produces:
  - `totalWalkthroughSteps(steps: PrWalkthroughStep[]): number` → `steps.length + 1`.
  - `isReviewSubmitStep(index: number, steps: PrWalkthroughStep[]): boolean` → `index === steps.length`.

- [ ] **Step 1: Write the failing tests**

Append to `plugins/github-sync/src/lib/walkthroughViewState.test.ts`:

```ts
import {
  buildSyntheticStepFiles,
  clampStepIndex,
  isWalkthroughStale,
  isPrLargeEnoughForWalkthroughHint,
  totalWalkthroughSteps,
  isReviewSubmitStep,
} from './walkthroughViewState'

// NOTE: replace the existing import line at the top of the file with the one above
// (adds totalWalkthroughSteps + isReviewSubmitStep to the existing named imports).

function walkthroughStep(id: string): PrWalkthroughStep {
  return { id, title: id, summary: id, files: [{ filename: 'a.ts', hunk_indexes: null }] }
}

describe('totalWalkthroughSteps', () => {
  it('adds one trailing review/submit step to the parsed steps', () => {
    expect(totalWalkthroughSteps([walkthroughStep('a'), walkthroughStep('b')])).toBe(3)
  })

  it('is 1 (just the review/submit step) when there are no parsed steps', () => {
    expect(totalWalkthroughSteps([])).toBe(1)
  })
})

describe('isReviewSubmitStep', () => {
  const steps = [walkthroughStep('a'), walkthroughStep('b')]

  it('is true at the final index (equal to steps.length)', () => {
    expect(isReviewSubmitStep(2, steps)).toBe(true)
  })

  it('is false for every real step index', () => {
    expect(isReviewSubmitStep(0, steps)).toBe(false)
    expect(isReviewSubmitStep(1, steps)).toBe(false)
  })

  it('treats index 0 as the review/submit step when there are no parsed steps', () => {
    expect(isReviewSubmitStep(0, [])).toBe(true)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @openforge-app/plugin-github-sync exec vitest run src/lib/walkthroughViewState.test.ts`
Expected: FAIL — `totalWalkthroughSteps is not a function` / `isReviewSubmitStep is not a function`.

- [ ] **Step 3: Implement the helpers**

Append to `plugins/github-sync/src/lib/walkthroughViewState.ts` (after `clampStepIndex`):

```ts
/**
 * Total number of steps shown in the Walkthrough: every parsed per-concept step
 * plus a trailing "Review & submit" step that shows the full diff and the submit
 * panel. Kept out of `parsedSteps` (which mirrors the agent's JSON) so the extra
 * step never leaks into parsing/validation.
 */
export function totalWalkthroughSteps(steps: PrWalkthroughStep[]): number {
  return steps.length + 1
}

/**
 * The trailing step (index === steps.length) is the full-diff "Review & submit"
 * step, not one of the parsed per-concept steps.
 */
export function isReviewSubmitStep(index: number, steps: PrWalkthroughStep[]): boolean {
  return index === steps.length
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @openforge-app/plugin-github-sync exec vitest run src/lib/walkthroughViewState.test.ts`
Expected: PASS (all `walkthroughViewState` describes green).

- [ ] **Step 5: Commit**

```bash
git add plugins/github-sync/src/lib/walkthroughViewState.ts plugins/github-sync/src/lib/walkthroughViewState.test.ts
git commit -m "feat(pr-review): add walkthrough step-count helpers for the review/submit step"
```

---

### Task 2: Sync inline comments into the Walkthrough per-step diff

Thread the shared comment props from `PrReviewView` → `WalkthroughTab` → the per-step
`DiffViewer` so a comment made during the walkthrough writes to the same store the Files
tab reads (and survives tab switches). Uses a stub `DiffViewer` in the test to assert the
wiring without the heavy diff renderer.

**Files:**
- Create: `plugins/github-sync/src/review/pr/__fixtures__/DiffViewerStub.svelte`
- Create: `plugins/github-sync/src/review/pr/WalkthroughTab.test.ts`
- Modify: `plugins/github-sync/src/review/pr/WalkthroughTab.svelte`
- Modify: `plugins/github-sync/src/review/pr/PrReviewView.svelte:801-809` (the `<WalkthroughTab>` usage)

**Interfaces:**
- Consumes: `DiffViewer` props `existingComments`, `pendingComments`,
  `onPendingCommentsChange`, `agentComments`, `onAgentCommentsChange`,
  `onUpdateAgentCommentStatus`, `onOpenUrl` (all already defined on `DiffViewer.svelte`);
  the shared stores `reviewComments`, `pendingManualComments`, `agentReviewComments` and the
  `githubSync.updateAgentReviewCommentStatus` / `api.system.openUrl` callbacks already used
  by the Files tab.
- Produces: `WalkthroughTab` gains required props
  `existingComments: ReviewComment[]`, `pendingComments: ReviewSubmissionComment[]`,
  `onPendingCommentsChange: (comments: ReviewSubmissionComment[]) => void`,
  `agentComments: AgentReviewComment[]`,
  `onAgentCommentsChange: (comments: AgentReviewComment[]) => void`,
  `onUpdateAgentCommentStatus: (commentId: number, status: 'approved' | 'dismissed') => Promise<void> | void`,
  `onOpenUrl: (url: string) => void | Promise<void>`.

- [ ] **Step 1: Create the DiffViewer stub fixture**

Create `plugins/github-sync/src/review/pr/__fixtures__/DiffViewerStub.svelte`. It records the
props under test and renders the `footer` snippet (used by Task 3). `...rest` absorbs the
other forwarded props so Svelte does not warn about unknown props.

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte'

  interface StubProps {
    files?: Array<{ filename: string }>
    pendingComments?: Array<{ path: string; line: number; side: string; body: string }>
    onPendingCommentsChange?: (comments: Array<{ path: string; line: number; side: string; body: string }>) => void
    footer?: Snippet
    [key: string]: unknown
  }

  let {
    files = [],
    pendingComments = [],
    onPendingCommentsChange,
    footer,
    ...rest
  }: StubProps = $props()
  void rest

  // Exposed so WalkthroughTab's `bind:this` instance calls never throw in tests.
  export function scrollToFile(_filename: string) {}
  export function focusDiff() {}
</script>

<div data-testid="diff-viewer-stub" data-file-count={files.length} data-pending-count={pendingComments.length}>
  {#each files as f}
    <span data-diff-file>{f.filename}</span>
  {/each}
  <button
    type="button"
    data-testid="stub-add-pending"
    onclick={() => onPendingCommentsChange?.([...pendingComments, { path: 'stub.ts', line: 1, side: 'RIGHT', body: 'stub comment' }])}
  >stub add pending</button>
  {#if footer}
    {@render footer()}
  {/if}
</div>
```

- [ ] **Step 2: Write the failing test**

Create `plugins/github-sync/src/review/pr/WalkthroughTab.test.ts`:

```ts
import { fireEvent, render, screen, within } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
import type { PrFileDiff, PrWalkthrough, ReviewPullRequest, ReviewSubmissionComment } from '@openforge-app/plugin-sdk/domain'
import type { GithubSyncPrReviewClient } from './githubSyncClient'

// Replace the heavy diff renderer with a stub that records the props WalkthroughTab
// forwards, and renders the footer snippet (where the submit panel lives in Task 3).
vi.mock('@openforge-app/pr-review-ui/DiffViewer.svelte', async () => ({
  default: (await import('./__fixtures__/DiffViewerStub.svelte')).default,
}))

vi.mock('../../lib/domUtils', () => ({
  isInputFocused: () => false,
}))

import WalkthroughTab from './WalkthroughTab.svelte'

const basePr: ReviewPullRequest = {
  id: 12345,
  number: 42,
  title: 'Fix authentication middleware',
  body: null,
  state: 'open',
  draft: false,
  html_url: 'https://github.com/acme/repo/pull/42',
  user_login: 'alice',
  user_avatar_url: null,
  repo_owner: 'acme',
  repo_name: 'repo',
  head_ref: 'fix/auth',
  base_ref: 'main',
  head_sha: 'head-sha',
  additions: 5,
  deletions: 2,
  changed_files: 2,
  mergeable: null,
  mergeable_state: null,
  created_at: 1_700_000_000,
  updated_at: 1_700_000_000,
  viewed_at: null,
  viewed_head_sha: null,
  labels: [],
}

const fileA: PrFileDiff = {
  sha: 'file-sha-a',
  filename: 'src/main.rs',
  status: 'modified',
  additions: 1,
  deletions: 0,
  changes: 1,
  patch: '@@ -1,1 +1,2 @@\n a\n+B0',
  previous_filename: null,
  is_truncated: false,
  patch_line_count: null,
}

const fileB: PrFileDiff = {
  sha: 'file-sha-b',
  filename: 'src/checkout.ts',
  status: 'modified',
  additions: 1,
  deletions: 0,
  changes: 1,
  patch: '@@ -1,1 +1,2 @@\n a\n+B0',
  previous_filename: null,
  is_truncated: false,
  patch_line_count: null,
}

function makeWalkthrough(): PrWalkthrough {
  return {
    pr_id: basePr.id,
    head_sha: basePr.head_sha,
    walkthrough_session_key: null,
    status: 'ready',
    steps_json: JSON.stringify({
      steps: [
        { id: 's1', title: 'Step one', summary: 'First concept', files: [{ filename: 'src/main.rs', hunk_indexes: null }] },
        { id: 's2', title: 'Step two', summary: 'Second concept', files: [{ filename: 'src/checkout.ts', hunk_indexes: null }] },
      ],
    }),
    error_message: null,
    created_at: 0,
    updated_at: 0,
  }
}

function makeGithubSync(): GithubSyncPrReviewClient {
  return {
    getPrWalkthrough: vi.fn(async () => makeWalkthrough()),
    startAgentWalkthrough: vi.fn(async () => ({ walkthrough_session_key: 'k' })),
    abortAgentWalkthrough: vi.fn(async () => {}),
    deletePrWalkthrough: vi.fn(async () => {}),
  } as unknown as GithubSyncPrReviewClient
}

function renderWalkthrough(overrides: Record<string, unknown> = {}) {
  const onPendingCommentsChange = vi.fn()
  const onSubmitReview = vi.fn(async () => {})
  render(WalkthroughTab, {
    props: {
      api: {} as unknown as FrontendOpenForgeAPI,
      githubSync: makeGithubSync(),
      pr: basePr,
      files: [fileA, fileB],
      fetchFileContents: vi.fn(async () => ({ oldContent: '', newContent: '' })),
      projectId: 'project-1',
      existingComments: [],
      pendingComments: [] as ReviewSubmissionComment[],
      onPendingCommentsChange,
      agentComments: [],
      onAgentCommentsChange: vi.fn(),
      onUpdateAgentCommentStatus: vi.fn(),
      onOpenUrl: vi.fn(),
      onSubmitReview,
      ...overrides,
    },
  })
  return { onPendingCommentsChange, onSubmitReview }
}

describe('WalkthroughTab comment sync', () => {
  it('forwards the shared pending-comment change handler to the per-step diff viewer', async () => {
    const { onPendingCommentsChange } = renderWalkthrough()
    await screen.findByText('Step one')

    await fireEvent.click(screen.getByTestId('stub-add-pending'))

    expect(onPendingCommentsChange).toHaveBeenCalledWith([
      { path: 'stub.ts', line: 1, side: 'RIGHT', body: 'stub comment' },
    ])
  })

  it('feeds only the current step files to the per-step diff viewer', async () => {
    renderWalkthrough()
    await screen.findByText('Step one')

    const stub = screen.getByTestId('diff-viewer-stub')
    expect(stub.getAttribute('data-file-count')).toBe('1')
    expect(within(stub).getByText('src/main.rs')).toBeTruthy()
    expect(within(stub).queryByText('src/checkout.ts')).toBeNull()
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @openforge-app/plugin-github-sync exec vitest run src/review/pr/WalkthroughTab.test.ts`
Expected: FAIL — the per-step `DiffViewer` currently receives no `onPendingCommentsChange`, so clicking `stub-add-pending` does not call the spy (and TypeScript render props are not yet accepted). This proves the missing wiring.

- [ ] **Step 4: Add the comment props to `WalkthroughTab` and forward them**

In `plugins/github-sync/src/review/pr/WalkthroughTab.svelte`:

4a. Extend the domain type import (lines 3-8) to add the comment types:

```svelte
  import type {
    AgentReviewComment,
    PrFileDiff,
    PrWalkthrough,
    PrWalkthroughStep,
    ReviewComment,
    ReviewPullRequest,
    ReviewSubmissionComment,
  } from '@openforge-app/plugin-sdk/domain'
```

4b. Extend the `Props` interface (lines 22-29) — add the seven comment props:

```svelte
  interface Props {
    api: FrontendOpenForgeAPI
    githubSync: GithubSyncPrReviewClient
    pr: ReviewPullRequest
    files: PrFileDiff[]
    fetchFileContents: (file: PrFileDiff) => Promise<FileContents>
    projectId: string | null
    existingComments: ReviewComment[]
    pendingComments: ReviewSubmissionComment[]
    onPendingCommentsChange: (comments: ReviewSubmissionComment[]) => void
    agentComments: AgentReviewComment[]
    onAgentCommentsChange: (comments: AgentReviewComment[]) => void
    onUpdateAgentCommentStatus: (commentId: number, status: 'approved' | 'dismissed') => Promise<void> | void
    onOpenUrl: (url: string) => void | Promise<void>
  }
```

4c. Update the destructuring (line 31):

```svelte
  let {
    api: _api,
    githubSync,
    pr,
    files,
    fetchFileContents,
    projectId,
    existingComments,
    pendingComments,
    onPendingCommentsChange,
    agentComments,
    onAgentCommentsChange,
    onUpdateAgentCommentStatus,
    onOpenUrl,
  }: Props = $props()
```

4d. Forward the props to the per-step `<DiffViewer>` (lines 323-330):

```svelte
        <DiffViewer
          bind:this={diffViewer}
          files={stepFiles}
          existingComments={existingComments}
          repoOwner={pr.repo_owner}
          repoName={pr.repo_name}
          fileTreeVisible={false}
          {fetchFileContents}
          agentComments={agentComments}
          pendingComments={pendingComments}
          onPendingCommentsChange={onPendingCommentsChange}
          onAgentCommentsChange={onAgentCommentsChange}
          onUpdateAgentCommentStatus={onUpdateAgentCommentStatus}
          onOpenUrl={onOpenUrl}
        />
```

- [ ] **Step 5: Pass the comment props from `PrReviewView`**

In `plugins/github-sync/src/review/pr/PrReviewView.svelte`, replace the `<WalkthroughTab>` block (lines 801-809) with:

```svelte
      {:else if activeTab === 'walkthrough'}
        <WalkthroughTab
          {api}
          {githubSync}
          pr={$selectedReviewPr}
          files={$prFileDiffs}
          fetchFileContents={fetchPrFileContents}
          projectId={$activeProjectId}
          existingComments={$reviewComments}
          agentComments={$agentReviewComments}
          pendingComments={$pendingManualComments}
          onPendingCommentsChange={(comments) => { $pendingManualComments = comments }}
          onAgentCommentsChange={(comments) => { $agentReviewComments = comments }}
          onUpdateAgentCommentStatus={(commentId, status) => githubSync.updateAgentReviewCommentStatus({ commentId, status })}
          onOpenUrl={(url) => api.system.openUrl(url)}
        />
```

- [ ] **Step 6: Run the WalkthroughTab test to verify it passes**

Run: `pnpm --filter @openforge-app/plugin-github-sync exec vitest run src/review/pr/WalkthroughTab.test.ts`
Expected: PASS (both `WalkthroughTab comment sync` tests green).

- [ ] **Step 7: Run the PrReviewView suite to confirm no regression**

Run: `pnpm --filter @openforge-app/plugin-github-sync exec vitest run src/review/pr/PrReviewView.test.ts`
Expected: PASS (the existing Cmd+3 walkthrough-tab test still passes with the new props threaded).

- [ ] **Step 8: Commit**

```bash
git add plugins/github-sync/src/review/pr/WalkthroughTab.svelte plugins/github-sync/src/review/pr/PrReviewView.svelte plugins/github-sync/src/review/pr/WalkthroughTab.test.ts plugins/github-sync/src/review/pr/__fixtures__/DiffViewerStub.svelte
git commit -m "feat(pr-review): sync inline comments into the walkthrough diff"
```

---

### Task 3: Final "Review & submit" walkthrough step

Add the trailing full-diff step. Navigation counts `parsedSteps.length + 1` steps; the last
one shows all files and the `ReviewSubmitPanel`, wired to `PrReviewView`'s existing
`submitReview`.

**Files:**
- Modify: `plugins/github-sync/src/review/pr/WalkthroughTab.svelte`
- Modify: `plugins/github-sync/src/review/pr/PrReviewView.svelte` (add `onSubmitReview` to the `<WalkthroughTab>` usage from Task 2)
- Test: `plugins/github-sync/src/review/pr/WalkthroughTab.test.ts` (append)

**Interfaces:**
- Consumes: `totalWalkthroughSteps` / `isReviewSubmitStep` from Task 1;
  `ReviewSubmitPanel` from `@openforge-app/pr-review-ui/ReviewSubmitPanel.svelte`;
  `submitReview` in `PrReviewView.svelte` (already defined, lines 645-670).
- Produces: `WalkthroughTab` gains required prop
  `onSubmitReview: (request: { repoOwner: string; repoName: string; prNumber: number; event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES'; body: string; comments: ReviewSubmissionComment[]; commitId: string }) => Promise<void>`.

- [ ] **Step 1: Write the failing tests**

Append to `plugins/github-sync/src/review/pr/WalkthroughTab.test.ts`:

```ts
describe('WalkthroughTab review/submit step', () => {
  it('adds a trailing Review & submit step beyond the parsed steps', async () => {
    renderWalkthrough()
    await screen.findByText('Step one')

    // 2 parsed steps + 1 review/submit step.
    expect(screen.getByText('of 3')).toBeTruthy()
    // The submit panel is not shown on a normal step.
    expect(screen.queryByText('Submit Review')).toBeNull()
  })

  it('renders the full diff and the submit panel on the final step', async () => {
    renderWalkthrough()
    await screen.findByText('Step one')

    await fireEvent.click(screen.getByRole('button', { name: '3' }))

    expect(await screen.findByText('Review & submit')).toBeTruthy()
    const stub = screen.getByTestId('diff-viewer-stub')
    expect(stub.getAttribute('data-file-count')).toBe('2')
    expect(within(stub).getByText('src/main.rs')).toBeTruthy()
    expect(within(stub).getByText('src/checkout.ts')).toBeTruthy()
    expect(screen.getByText('Submit Review')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy()
  })

  it('submits the pending review from the final step', async () => {
    const comment: ReviewSubmissionComment = { path: 'src/main.rs', line: 2, side: 'RIGHT', body: 'nit' }
    const { onSubmitReview } = renderWalkthrough({ pendingComments: [comment] })
    await screen.findByText('Step one')

    await fireEvent.click(screen.getByRole('button', { name: '3' }))
    await screen.findByText('Review & submit')
    await fireEvent.click(screen.getByRole('button', { name: 'Comment' }))

    expect(onSubmitReview).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'COMMENT',
        comments: [comment],
        prNumber: basePr.number,
        commitId: basePr.head_sha,
        repoOwner: basePr.repo_owner,
        repoName: basePr.repo_name,
      }),
    )
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @openforge-app/plugin-github-sync exec vitest run src/review/pr/WalkthroughTab.test.ts`
Expected: FAIL — there is no third step/dot, the header never says "Review & submit", and no `ReviewSubmitPanel` renders (`Submit Review` not found).

- [ ] **Step 3: Add the `onSubmitReview` prop + imports to `WalkthroughTab`**

3a. Extend the view-state import (lines 11-15) to add the two helpers:

```svelte
  import {
    buildSyntheticStepFiles,
    clampStepIndex,
    isReviewSubmitStep,
    isWalkthroughStale,
    totalWalkthroughSteps,
  } from '../../lib/walkthroughViewState'
```

3b. Add the `ReviewSubmitPanel` import (next to the `DiffViewer` import, line 18):

```svelte
  import ReviewSubmitPanel from '@openforge-app/pr-review-ui/ReviewSubmitPanel.svelte'
```

3c. Add `onSubmitReview` to the `Props` interface (after `onOpenUrl`):

```svelte
    onSubmitReview: (request: {
      repoOwner: string
      repoName: string
      prNumber: number
      event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES'
      body: string
      comments: ReviewSubmissionComment[]
      commitId: string
    }) => Promise<void>
```

3d. Add `onSubmitReview` to the destructuring (in the `$props()` list from Task 2, after `onOpenUrl`):

```svelte
    onOpenUrl,
    onSubmitReview,
  }: Props = $props()
```

- [ ] **Step 4: Add the derived step-count state**

In `WalkthroughTab.svelte`, replace the `activeStep` / `stepFiles` derivations (currently
lines 51-59) with the following (adds `totalSteps`, `clampedStepIndex`, `isFinalStep`,
`stepTitle`, `stepSummary`):

```svelte
  let totalSteps = $derived(parsedSteps ? totalWalkthroughSteps(parsedSteps) : 0)

  let clampedStepIndex = $derived(
    parsedSteps ? clampStepIndex(activeStepIndex, totalSteps) : 0,
  )

  let isFinalStep = $derived(
    parsedSteps ? isReviewSubmitStep(clampedStepIndex, parsedSteps) : false,
  )

  let activeStep = $derived<PrWalkthroughStep | null>(
    parsedSteps && !isFinalStep ? parsedSteps[clampedStepIndex] : null,
  )

  // The final step shows every file; a per-concept step shows only its hunks.
  let stepFiles = $derived<PrFileDiff[]>(
    isFinalStep ? files : activeStep ? buildSyntheticStepFiles(files, activeStep) : [],
  )

  let stepTitle = $derived(isFinalStep ? 'Review & submit' : activeStep?.title ?? '')
  let stepSummary = $derived(
    isFinalStep
      ? 'Review every change together, then submit your review.'
      : activeStep?.summary ?? '',
  )
```

- [ ] **Step 5: Point navigation at the `+1` total**

In `WalkthroughTab.svelte`, update `goPrev`, `goNext`, and `selectStep` (currently lines
186-199) to clamp against `totalSteps`:

```svelte
  function goPrev() {
    if (!parsedSteps) return
    activeStepIndex = clampStepIndex(activeStepIndex - 1, totalSteps)
  }

  function goNext() {
    if (!parsedSteps) return
    activeStepIndex = clampStepIndex(activeStepIndex + 1, totalSteps)
  }

  function selectStep(index: number) {
    if (!parsedSteps) return
    activeStepIndex = clampStepIndex(index, totalSteps)
  }
```

- [ ] **Step 6: Update the stepper header + dots markup**

In `WalkthroughTab.svelte`, in the `{:else}` walkthrough-ready block:

6a. Replace the step-number header (currently lines 275-285) so it uses the derived
`clampedStepIndex`, `totalSteps`, `stepTitle`, `stepSummary`:

```svelte
        <div class="flex flex-col items-center leading-none shrink-0 pt-0.5">
          <span class="text-4xl font-bold text-base-content tabular-nums">{clampedStepIndex + 1}</span>
          <span class="text-[10px] font-medium uppercase tracking-wider text-base-content/40 mt-2 whitespace-nowrap">of {totalSteps}</span>
        </div>

        <div class="flex flex-col gap-1.5 min-w-0 flex-1">
          <h3 class="text-sm font-semibold text-base-content m-0 leading-snug">{stepTitle}</h3>
          {#if stepSummary}
            <p class="text-lg leading-relaxed text-base-content/90 m-0">{stepSummary}</p>
          {/if}
        </div>
```

6b. Update the Prev/Next disabled bounds (currently lines 288-299) to use
`clampedStepIndex` / `totalSteps`:

```svelte
          <button
            class="btn btn-ghost btn-xs"
            onclick={goPrev}
            disabled={clampedStepIndex <= 0}
            title="Previous step (←)"
          >◀ Prev</button>
          <button
            class="btn btn-ghost btn-xs"
            onclick={goNext}
            disabled={clampedStepIndex >= totalSteps - 1}
            title="Next step (→)"
          >Next ▶</button>
```

6c. Replace the dots row (currently lines 306-315) so it renders one extra dot for the
review/submit step:

```svelte
      <div class="flex flex-wrap justify-center gap-2">
        {#each parsedSteps as step, i}
          <button
            type="button"
            class="btn btn-sm btn-circle {i === clampedStepIndex ? 'btn-primary' : 'btn-ghost text-base-content/60'}"
            onclick={() => selectStep(i)}
            title={step.title}
          >{i + 1}</button>
        {/each}
        <button
          type="button"
          class="btn btn-sm btn-circle {isFinalStep ? 'btn-primary' : 'btn-ghost text-base-content/60'}"
          onclick={() => selectStep(parsedSteps.length)}
          title="Review & submit"
        >{parsedSteps.length + 1}</button>
      </div>
```

- [ ] **Step 7: Render the submit panel as the final-step footer**

In `WalkthroughTab.svelte`, replace the per-step `<DiffViewer>` from Task 2 (step 4d) with
the version that adds the `footer` snippet gated on `isFinalStep`:

```svelte
        <DiffViewer
          bind:this={diffViewer}
          files={stepFiles}
          existingComments={existingComments}
          repoOwner={pr.repo_owner}
          repoName={pr.repo_name}
          fileTreeVisible={false}
          {fetchFileContents}
          agentComments={agentComments}
          pendingComments={pendingComments}
          onPendingCommentsChange={onPendingCommentsChange}
          onAgentCommentsChange={onAgentCommentsChange}
          onUpdateAgentCommentStatus={onUpdateAgentCommentStatus}
          onOpenUrl={onOpenUrl}
        >
          {#snippet footer()}
            {#if isFinalStep}
              <ReviewSubmitPanel
                repoOwner={pr.repo_owner}
                repoName={pr.repo_name}
                prNumber={pr.number}
                commitId={pr.head_sha}
                pendingComments={pendingComments}
                onPendingCommentsChange={onPendingCommentsChange}
                onSubmitReview={onSubmitReview}
              />
            {/if}
          {/snippet}
        </DiffViewer>
```

- [ ] **Step 8: Pass `onSubmitReview` from `PrReviewView`**

In `plugins/github-sync/src/review/pr/PrReviewView.svelte`, add `onSubmitReview` to the
`<WalkthroughTab>` usage (extending the Task 2 block), right after `onOpenUrl`:

```svelte
          onOpenUrl={(url) => api.system.openUrl(url)}
          onSubmitReview={submitReview}
        />
```

- [ ] **Step 9: Run the WalkthroughTab test to verify it passes**

Run: `pnpm --filter @openforge-app/plugin-github-sync exec vitest run src/review/pr/WalkthroughTab.test.ts`
Expected: PASS (all `WalkthroughTab comment sync` + `WalkthroughTab review/submit step` tests green).

- [ ] **Step 10: Run the full plugin PR-review + view-state suites**

Run: `pnpm --filter @openforge-app/plugin-github-sync exec vitest run src/review/pr/PrReviewView.test.ts src/review/pr/WalkthroughTab.test.ts src/lib/walkthroughViewState.test.ts`
Expected: PASS (no regressions in PrReviewView; helpers and walkthrough tab green).

- [ ] **Step 11: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: No new errors from the changed files. (If the only failure is the known `TS6`
`ignoreDeprecations` env artifact, that is pre-existing and unrelated — confirm no
`WalkthroughTab`/`PrReviewView`/`walkthroughViewState` errors.)

- [ ] **Step 12: Commit**

```bash
git add plugins/github-sync/src/review/pr/WalkthroughTab.svelte plugins/github-sync/src/review/pr/PrReviewView.svelte plugins/github-sync/src/review/pr/WalkthroughTab.test.ts
git commit -m "feat(pr-review): add final review & submit step to the walkthrough"
```

---

### Task 4: Post-implementation review & manual verification

**Files:** none (verification only).

- [ ] **Step 1: Code review**

Use the `superpowers:requesting-code-review` skill (or `/code-review`) over the branch diff.
Focus: prop threading correctness, no duplicated submit logic, no reviewed-file scope creep,
Svelte 5 rune correctness, and that the final-step footer is gated on `isFinalStep`. Resolve
any blocking findings before handoff.

- [ ] **Step 2: Manual smoke (user-run app)**

Ask the user to run `pnpm electron:dev` (never run it yourself) and confirm:
1. Open a PR → Walkthrough. Leave an inline comment on a step; switch to Files changed →
   the comment is there. Add another comment in Files changed; return to Walkthrough → it
   persists.
2. Walk to the last real step → "Next" lands on step `N+1` "Review & submit" showing the
   full diff and all pending comments, with Comment / Approve / Request Changes.
3. Submit from the final step; the review posts and pending comments clear in both tabs.

- [ ] **Step 3: Completion summary**

Summarize the change, the commands run and their results, and anything deferred
(e.g. reviewed-file state in the walkthrough — intentionally out of scope).

---

## Self-Review

**1. Spec coverage:**
- Spec change #1 (comment sync) → Task 2. ✅
- Spec change #2 (final Review & submit step, option A) → Tasks 1 + 3. ✅
- "Preserved across tab switches" → guaranteed by the shared stores (unchanged) + Task 2 wiring; asserted via the `onPendingCommentsChange` forwarding test. ✅
- Non-goal "submitReview stays owned by PrReviewView" → Task 3 passes `submitReview` down as `onSubmitReview`; no duplication. ✅
- Out-of-scope reviewed-file state → not wired into the walkthrough viewer. ✅
- Testing strategy (pure helpers + component behavior, no CSS assertions) → Tasks 1-3. ✅

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to". Every code step shows full code. ✅

**3. Type consistency:**
- `totalWalkthroughSteps(steps)` / `isReviewSubmitStep(index, steps)` — same signatures in Task 1 (definition + tests) and Task 3 (usage). ✅
- `WalkthroughTab` props added in Task 2 (`existingComments`, `pendingComments`,
  `onPendingCommentsChange`, `agentComments`, `onAgentCommentsChange`,
  `onUpdateAgentCommentStatus`, `onOpenUrl`) and Task 3 (`onSubmitReview`) match exactly what
  `PrReviewView` passes (Task 2 step 5 + Task 3 step 8). ✅
- `onSubmitReview` request shape matches `PrReviewView.submitReview` and `ReviewSubmitPanel`'s
  `onSubmitReview` (`repoOwner`, `repoName`, `prNumber`, `event`, `body`, `comments`,
  `commitId`). ✅
