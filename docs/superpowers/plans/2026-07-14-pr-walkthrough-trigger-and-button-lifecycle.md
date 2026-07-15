# PR Walkthrough Trigger Relocation + Button Lifecycle — Implementation Plan (Plan 3 of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the walkthrough+AI-review opt-in: move triggering out of the Walkthrough tab's auto-run `$effect` to an explicit **"Generate Walkthrough + AI Review"** button on each PR card in the left rail, run it in the background without marking the PR read, and reveal the Walkthrough tab only once a `ready` walkthrough exists.

**Architecture:** `PrReviewView.svelte` (parent of both the list and the detail) owns a `Map<prId, PrWalkthrough | null>` of walkthrough status. `ReviewPrCard.svelte` gains a status-driven button that calls back to `PrReviewView` to start generation and reflects `idle → generating → ready → error → stale`. `WalkthroughTab.svelte` stops auto-generating (it only *loads* now). `PrReviewDetailSection.svelte` hides the Walkthrough tab button unless the open PR has a `ready` walkthrough.

**Tech Stack:** Svelte 5 runes (`$state`, `$derived`, `$props`), daisyUI/Tailwind, the github-sync plugin client (`githubSyncClient.ts`).

**Depends on:** Plan 2 (the combined generation that `startAgentWalkthrough` now drives). Plan 3 changes only *when/where* generation is triggered and how status is surfaced; it does not change what generation produces.

## Global Constraints

- Svelte 5 runes only: `$state`, `$derived`, `$effect`, `$props()` with a local `Props` interface. Callback props are `on`-prefixed; no legacy event dispatcher.
- Map-based stores require `new Map()` to trigger reactivity — never mutate via `.set()` on the existing instance and expect a re-render.
- Never use `$effect` return-cleanup to release resources keyed by a prop value; compare previous value explicitly inside the effect body and use `onDestroy` for teardown (see the polling effect in Task 5).
- Tests cover business logic only — no assertions on CSS classes / Tailwind utilities / visual styling.
- All frontend→backend calls go through the plugin client (`githubSync.*`), never raw transport.
- Fresh worktree: run `pnpm install` if `node_modules` is missing before any test/tsc.
- Plugin tests run via the plugin's own vitest: `pnpm --filter @openforge-app/plugin-github-sync exec vitest run <path>`. Typecheck: `pnpm exec tsc --noEmit` (ignore the known local `ignoreDeprecations "6.0"` artifact — CI passes).

---

### Task 1: Pure button-state helper

**Files:**
- Create: `plugins/github-sync/src/lib/walkthroughButtonState.ts`
- Test: `plugins/github-sync/src/lib/walkthroughButtonState.test.ts`

**Interfaces:**
- Produces: `type WalkthroughButtonState = 'idle' | 'generating' | 'ready' | 'error' | 'stale'` and `walkthroughButtonState(walkthrough: PrWalkthrough | null | undefined, prHeadSha: string): WalkthroughButtonState`.
- Consumed by: `ReviewPrCard` (Task 3), `PrReviewDetailSection` (Task 4).

**Rule:** `null`/absent → `idle`; `status === 'generating'` → `generating`; `status === 'error'` → `error`; `status === 'ready'` and `walkthrough.head_sha === prHeadSha` → `ready`; `status === 'ready'` but a newer commit (`head_sha !== prHeadSha`) → `stale`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest'
import { walkthroughButtonState } from './walkthroughButtonState'
import type { PrWalkthrough } from '@openforge-app/plugin-sdk/domain'

function wt(partial: Partial<PrWalkthrough>): PrWalkthrough {
  return {
    pr_id: 1, head_sha: 'sha1', walkthrough_session_key: null,
    status: 'ready', steps_json: null, error_message: null,
    created_at: 0, updated_at: 0, ...partial,
  }
}

describe('walkthroughButtonState', () => {
  it('is idle when there is no walkthrough', () => {
    expect(walkthroughButtonState(null, 'sha1')).toBe('idle')
    expect(walkthroughButtonState(undefined, 'sha1')).toBe('idle')
  })
  it('reflects generating and error status', () => {
    expect(walkthroughButtonState(wt({ status: 'generating' }), 'sha1')).toBe('generating')
    expect(walkthroughButtonState(wt({ status: 'error' }), 'sha1')).toBe('error')
  })
  it('is ready only when the ready walkthrough matches the current head sha', () => {
    expect(walkthroughButtonState(wt({ status: 'ready', head_sha: 'sha1' }), 'sha1')).toBe('ready')
  })
  it('is stale when a ready walkthrough is for an older commit', () => {
    expect(walkthroughButtonState(wt({ status: 'ready', head_sha: 'old' }), 'sha1')).toBe('stale')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @openforge-app/plugin-github-sync exec vitest run src/lib/walkthroughButtonState.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
import type { PrWalkthrough } from '@openforge-app/plugin-sdk/domain'

export type WalkthroughButtonState = 'idle' | 'generating' | 'ready' | 'error' | 'stale'

export function walkthroughButtonState(
  walkthrough: PrWalkthrough | null | undefined,
  prHeadSha: string,
): WalkthroughButtonState {
  if (!walkthrough) return 'idle'
  if (walkthrough.status === 'generating') return 'generating'
  if (walkthrough.status === 'error') return 'error'
  // status === 'ready'
  return walkthrough.head_sha === prHeadSha ? 'ready' : 'stale'
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @openforge-app/plugin-github-sync exec vitest run src/lib/walkthroughButtonState.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/github-sync/src/lib/walkthroughButtonState.ts plugins/github-sync/src/lib/walkthroughButtonState.test.ts
git commit -m "Add pure walkthrough button-state helper"
```

---

### Task 2: Stop auto-generating in `WalkthroughTab`

**Files:**
- Modify: `plugins/github-sync/src/review/pr/WalkthroughTab.svelte` (`initWalkthrough` lines 138-143)

**Interfaces:**
- Produces: `WalkthroughTab` becomes load-only — it never calls `handleGenerate()` on open. Generation is triggered exclusively from the PR card (Task 3). `handleRegenerate` (explicit user action inside the tab) stays.

- [ ] **Step 1: Write the failing test**

Create `plugins/github-sync/src/review/pr/WalkthroughTab.autogen.test.ts` (component test with Svelte testing utilities used elsewhere in this package — mirror an existing `*.test.ts` in `plugins/github-sync/src/review/pr/`):

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/svelte'
import WalkthroughTab from './WalkthroughTab.svelte'
// Reuse the test factories/mocks that sibling WalkthroughTab tests already use
// for `api`, `githubSync`, `pr`, and `files`. The key assertion:

describe('WalkthroughTab does not auto-generate', () => {
  it('loads the cached walkthrough but never starts generation on open', async () => {
    const getPrWalkthrough = vi.fn().mockResolvedValue(null) // no cache
    const startAgentWalkthrough = vi.fn()
    const githubSync = makeGithubSyncStub({ getPrWalkthrough, startAgentWalkthrough })
    render(WalkthroughTab, { props: makeWalkthroughTabProps({ githubSync, files: [makeFileDiff()] }) })
    await Promise.resolve()
    expect(getPrWalkthrough).toHaveBeenCalled()
    expect(startAgentWalkthrough).not.toHaveBeenCalled()
  })
})
```

(If this package has no existing component-test harness, place the assertion at the `initWalkthrough` unit level instead: export `initWalkthrough`'s decision as a tiny pure helper `shouldAutoGenerate()` that now always returns `false`, and assert that — see note in Step 3.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @openforge-app/plugin-github-sync exec vitest run src/review/pr/WalkthroughTab.autogen.test.ts`
Expected: FAIL — `startAgentWalkthrough` is called (current auto-generate behavior).

- [ ] **Step 3: Implement — remove the auto-generate branch**

Change `initWalkthrough` (lines 138-143) from:

```typescript
  async function initWalkthrough() {
    const existing = await loadCachedWalkthrough()
    if (!existing && files.length > 0 && !isStarting) {
      await handleGenerate()
    }
  }
```

to load-only:

```typescript
  async function initWalkthrough() {
    // Generation is now triggered explicitly from the PR card, so the tab only
    // loads whatever has already been generated for this (pr, head_sha).
    await loadCachedWalkthrough()
  }
```

`handleGenerate` stays (used by `handleRegenerate`). If any now-unused import/var warns, remove it.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @openforge-app/plugin-github-sync exec vitest run src/review/pr/WalkthroughTab.autogen.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/github-sync/src/review/pr/WalkthroughTab.svelte plugins/github-sync/src/review/pr/WalkthroughTab.autogen.test.ts
git commit -m "Stop auto-generating walkthrough on tab open"
```

---

### Task 3: "Generate Walkthrough + AI Review" button on the PR card

**Files:**
- Modify: `plugins/github-sync/src/review/pr/ReviewPrCard.svelte` (add prop + button; near the existing mark-unread button ~lines 27-39)

**Interfaces:**
- Consumes: `walkthroughButtonState` (Task 1).
- Produces: `ReviewPrCard` new props `walkthroughState: WalkthroughButtonState` and `onGenerateWalkthrough: () => void`. Renders a button that:
  - `idle`/`stale`/`error` → label "Generate Walkthrough + AI Review" (stale: "Regenerate — new commits"), enabled, `onclick` → `onGenerateWalkthrough()` (with `e.stopPropagation()` so it doesn't open the PR).
  - `generating` → label "Generating…", disabled, spinner.
  - `ready` → label "Walkthrough ready", clicking opens the PR (let the click bubble / call `onClick`).

- [ ] **Step 1: Add the props**

In `ReviewPrCard.svelte`'s `Props` interface add:

```typescript
    walkthroughState: import('../../lib/walkthroughButtonState').WalkthroughButtonState
    onGenerateWalkthrough: () => void
```

and destructure them in `$props()`.

- [ ] **Step 2: Add the button markup**

Add below the mark-unread button block (after line 39), inside the card:

```svelte
{#if walkthroughState === 'ready'}
  <div class="mt-2 text-xs text-success flex items-center gap-1" aria-label="Walkthrough ready">
    <span class="inline-block w-1.5 h-1.5 rounded-full bg-success"></span>
    Walkthrough ready
  </div>
{:else if walkthroughState === 'generating'}
  <button type="button" class="mt-2 btn btn-xs btn-ghost gap-1" disabled aria-label="Generating walkthrough">
    <span class="loading loading-spinner loading-xs"></span>
    Generating…
  </button>
{:else}
  <button
    type="button"
    class="mt-2 btn btn-xs btn-outline"
    aria-label="Generate walkthrough and AI review"
    onclick={(e) => { e.stopPropagation(); onGenerateWalkthrough() }}
  >
    {walkthroughState === 'stale' ? 'Regenerate — new commits' : 'Generate Walkthrough + AI Review'}
    {#if walkthroughState === 'error'} · retry{/if}
  </button>
{/if}
```

- [ ] **Step 3: Verify it compiles/typechecks**

Run: `pnpm exec tsc --noEmit`
Expected: no new errors referencing `ReviewPrCard` (ignore the known local deprecations artifact).

Behavioral verification for this card is manual (visual states) — no unit test asserts markup per project rules. The state *logic* is already unit-tested in Task 1.

- [ ] **Step 4: Commit**

```bash
git add plugins/github-sync/src/review/pr/ReviewPrCard.svelte
git commit -m "Add generate-walkthrough button to PR card"
```

---

### Task 4: Hide the Walkthrough tab until a ready walkthrough exists

**Files:**
- Modify: `plugins/github-sync/src/review/pr/PrReviewDetailSection.svelte` (tab button block lines 119-142; add a `walkthroughReady: boolean` prop)

**Interfaces:**
- Consumes: `walkthroughButtonState` result for the open PR (passed from `PrReviewView` as `walkthroughReady`).
- Produces: the Walkthrough `<button role="tab">` renders only when `walkthroughReady`. If the active tab is `walkthrough` and it becomes not-ready (e.g. after switching PRs), fall back to `overview`.

- [ ] **Step 1: Add the prop + guard**

Add to the `Props` interface:

```typescript
    walkthroughReady: boolean
```

Wrap the Walkthrough tab button (lines 131-141) in a guard:

```svelte
        {#if walkthroughReady}
          <button
            class="btn btn-ghost btn-xs {activeTab === 'walkthrough' ? 'text-primary bg-primary/10 border border-primary' : 'text-base-content/50'}"
            onclick={() => onActiveTabChange('walkthrough')}
            title="AI walkthrough"
          >
            Walkthrough
          </button>
        {/if}
```

(The `isPrLargeEnoughForWalkthroughHint` dot is dropped from the tab — the "should I generate this?" hint now belongs on the card button, not a hidden tab.)

- [ ] **Step 2: Guard the tab content + active-tab fallback**

The content block `{:else if activeTab === 'walkthrough'}` (lines ~162-179) is only reachable when the button was shown, but guard against a stale `activeTab` after a PR switch. Add near the top of the component:

```svelte
  $effect(() => {
    if (activeTab === 'walkthrough' && !walkthroughReady) {
      onActiveTabChange('overview')
    }
  })
```

- [ ] **Step 3: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no new errors (ignore the known deprecations artifact).

- [ ] **Step 4: Commit**

```bash
git add plugins/github-sync/src/review/pr/PrReviewDetailSection.svelte
git commit -m "Hide walkthrough tab until a ready walkthrough exists"
```

---

### Task 5: Own walkthrough status + generation in `PrReviewView`

**Files:**
- Modify: `plugins/github-sync/src/review/pr/PrReviewView.svelte` (add status map + generation trigger + polling; wire props to list and detail)

**Interfaces:**
- Consumes: `githubSync.getPrWalkthrough`, `githubSync.startAgentWalkthrough` (Plan 2's combined version), `walkthroughButtonState` (Task 1).
- Produces: `walkthroughByPr: Map<number, PrWalkthrough | null>` state; `generateWalkthrough(pr)`; passes `walkthroughState` + `onGenerateWalkthrough` to each `ReviewPrCard`, and `walkthroughReady` to `PrReviewDetailSection`.

- [ ] **Step 1: Add the status map and helpers**

Near the other `$state` in `PrReviewView` (~line 62):

```typescript
  import { walkthroughButtonState } from '../../lib/walkthroughButtonState'
  import type { PrWalkthrough, ReviewPullRequest } from '@openforge-app/plugin-sdk/domain'

  // Per-PR walkthrough status, so the card button and the tab visibility can
  // reflect generating/ready/stale without each card hitting the backend.
  let walkthroughByPr = $state<Map<number, PrWalkthrough | null>>(new Map())

  async function refreshWalkthroughStatus(pr: ReviewPullRequest) {
    const wt = await githubSync.getPrWalkthrough({ reviewPrId: pr.id, headSha: pr.head_sha })
    // Reassign a new Map so Svelte re-renders (project rule: no in-place .set).
    const next = new Map(walkthroughByPr)
    next.set(pr.id, wt)
    walkthroughByPr = next
  }
```

- [ ] **Step 2: Add the generation trigger + background polling**

```typescript
  let walkthroughPollTimers = new Map<number, ReturnType<typeof setInterval>>()

  async function generateWalkthrough(pr: ReviewPullRequest) {
    // NOTE: does NOT mark the PR read — read state only changes in openPrDetail.
    await githubSync.startAgentWalkthrough({
      repoOwner: pr.repo_owner,
      repoName: pr.repo_name,
      prNumber: pr.number,
      headRef: pr.head_ref,
      baseRef: pr.base_ref,
      prTitle: pr.title,
      prBody: pr.body,
      headSha: pr.head_sha,
      reviewPrId: pr.id,
      prompt: '', // Plan 2 builds the combined prompt inside startAgentWalkthrough's handler path
      projectId: $activeProjectId,
    })
    await refreshWalkthroughStatus(pr) // now 'generating'
    startWalkthroughPolling(pr)
  }

  function startWalkthroughPolling(pr: ReviewPullRequest) {
    if (walkthroughPollTimers.has(pr.id)) return
    const timer = setInterval(async () => {
      await refreshWalkthroughStatus(pr)
      const wt = walkthroughByPr.get(pr.id)
      if (wt && wt.status !== 'generating') {
        clearInterval(timer)
        walkthroughPollTimers.delete(pr.id)
      }
    }, 2500)
    walkthroughPollTimers.set(pr.id, timer)
  }

  onDestroy(() => {
    for (const timer of walkthroughPollTimers.values()) clearInterval(timer)
    walkthroughPollTimers.clear()
  })
```

> **Prompt note:** Plan 2 changes `startAgentWalkthrough` so the *combined* prompt (steps + review) is compiled inside the handler/generation path using repo coords, not passed from the caller. If Plan 2 still expects a `prompt`, compile it here with `compileWalkthroughPrompt({ title: pr.title, body: pr.body, files })` — but `files` aren't loaded for un-opened PRs, which is exactly why Plan 2 moves prompt compilation server-side. Implement Plan 2 first; this call passes the fields Plan 2's handler needs.

- [ ] **Step 3: Seed statuses when the list loads**

Where the review PR list is loaded/refreshed (the existing list-load path), after the list is set, refresh statuses for the visible PRs:

```typescript
  async function refreshVisibleWalkthroughStatuses(prs: ReviewPullRequest[]) {
    await Promise.all(prs.map(refreshWalkthroughStatus))
  }
```

Call `void refreshVisibleWalkthroughStatuses($reviewPrs)` after the list is populated (mirror where `$reviewPrs` is assigned). This is best-effort; failures are per-PR and non-blocking.

- [ ] **Step 4: Wire the list section**

Where `PrReviewListSection` is rendered, pass through per-PR state. In `PrReviewListSection.svelte`, thread two new props (`walkthroughByPr` + `onGenerateWalkthrough`) down to each `ReviewPrCard`:

```svelte
                      <ReviewPrCard
                        {pr}
                        selected={false}
                        onClick={() => onSelectPr(pr)}
                        onMarkUnread={() => onMarkUnread(pr)}
                        walkthroughState={walkthroughButtonState(walkthroughByPr.get(pr.id), pr.head_sha)}
                        onGenerateWalkthrough={() => onGenerateWalkthrough(pr)}
                      />
```

Add `walkthroughByPr` and `onGenerateWalkthrough` to `PrReviewListSection`'s `Props`, and pass them from `PrReviewView` (`walkthroughByPr={walkthroughByPr}` and `onGenerateWalkthrough={generateWalkthrough}`). Import `walkthroughButtonState` in `PrReviewListSection`.

- [ ] **Step 5: Wire the detail section's `walkthroughReady`**

In `PrReviewView`, where `PrReviewDetailSection` is rendered (lines 748-779), add:

```svelte
      walkthroughReady={walkthroughButtonState(walkthroughByPr.get($selectedReviewPr.id), $selectedReviewPr.head_sha) === 'ready'}
```

Also refresh the open PR's status when it's opened: in `openPrDetail`, after `$selectedReviewPr` is set, add `void refreshWalkthroughStatus(updatedPr)`.

- [ ] **Step 6: Typecheck + targeted tests**

Run:
```bash
pnpm exec tsc --noEmit
pnpm --filter @openforge-app/plugin-github-sync exec vitest run src/lib/walkthroughButtonState.test.ts src/review/pr/WalkthroughTab.autogen.test.ts
```
Expected: no new type errors; both test files PASS.

- [ ] **Step 7: MANUAL verification (user runs the app)**

In the running app: (a) a PR with no walkthrough shows the "Generate…" button and only Overview/Files changed tabs; (b) clicking Generate keeps the PR unread and flips the button to "Generating…"; (c) when it finishes, the button shows "Walkthrough ready" and opening the PR now shows the Walkthrough tab; (d) a PR with a new commit shows "Regenerate — new commits".

- [ ] **Step 8: Commit**

```bash
git add plugins/github-sync/src/review/pr/PrReviewView.svelte plugins/github-sync/src/review/pr/PrReviewListSection.svelte
git commit -m "Own walkthrough status and generation trigger in PrReviewView"
```

---

## Self-Review

**Spec coverage (Plan 3 slice):**
- Button in the left-rail PR list → Tasks 3, 5. ✓
- Background generation, PR stays unread → Task 5 Step 2 (no `markReviewPrViewed` call). ✓
- Button states idle/generating/ready/error/stale → Task 1 + Task 3. ✓
- Walkthrough tab hidden until ready → Task 4. ✓
- No auto-generate on tab open → Task 2. ✓

**Placeholder scan:** The only soft spot is the `prompt: ''` in Task 5 Step 2, explicitly annotated: Plan 2 moves prompt compilation into the handler; implement Plan 2 first. Not a hidden placeholder — it's a documented cross-plan dependency with the fallback spelled out.

**Type consistency:** `WalkthroughButtonState` (Task 1) is used identically in Tasks 3–5; `walkthroughByPr: Map<number, PrWalkthrough | null>` is keyed by `pr.id` (number) everywhere; `startAgentWalkthrough`'s request object matches `githubSyncClient.ts`'s signature verbatim (`repoOwner/repoName/prNumber/headRef/baseRef/prTitle/prBody/headSha/reviewPrId/prompt/projectId`).

**Note on `new Map()`:** every mutation of `walkthroughByPr` reassigns a fresh `Map` (project reactivity rule); poll timers live in a plain (non-reactive) `Map` and are cleared in `onDestroy` (not via `$effect` cleanup), per the effect-cleanup constraint.
