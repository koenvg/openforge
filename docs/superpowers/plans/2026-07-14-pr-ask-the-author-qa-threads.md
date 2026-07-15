# PR Ask-the-Author Q&A Threads — Implementation Plan (Plan 4 of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the reviewer attach questions to a diff line or a walkthrough step, batch-send them, and have **one** repo-aware agent run answer them all — rendered as private back-and-forth threads that never go to GitHub.

**Architecture:** A new local, per-commit thread store (`pr-ai-threads:${prId}:${headSha}`). Questions are created via an "Ask the AI" affordance (a second button in the diff comment widget; a small input in each walkthrough step). A batch "Send to AI" fires `askAgentQuestions`, which sets the pending threads to `pending`, then (fire-and-forget, poll to completion like the walkthrough) runs `agentGenerateInRepo` once with every unanswered question + its anchor + the diff + that thread's prior messages, maps the structured answers back by `thread_id`, and appends AI replies. Threads render inline through an extended `buildExtendData`/`DiffViewer`.

**Tech Stack:** TypeScript (plugin + shared `pr-review-ui`), Svelte 5, plugin storage, the `agentGenerateInRepo` host command (Plan 1).

**Depends on:** Plans 1–3. Reuses Plan 2's `commentableLines`, prompt patterns, and fire-and-forget+poll shape.

## Global Constraints

- `import type` (verbatimModuleSyntax); nullable = `T | null`, not optional.
- Svelte 5 runes only; `on`-prefixed callback props.
- Frontend→backend only via `githubSync.*`.
- Tests cover business logic only — no CSS/markup assertions. UI states verified manually.
- Shared `pr-review-ui` changes: any **new** subpath export must be added to the allowlist in `scripts/check-plugin-import-boundaries.mjs` (this plan adds no new subpath, only extends existing components/types — but run the boundary check to confirm).
- Plugin tests: `pnpm --filter @openforge-app/plugin-github-sync exec vitest run <path>`. Shared: `pnpm --filter @openforge-app/pr-review-ui exec vitest run <path>`. Types: `pnpm exec tsc --noEmit`.
- Fresh worktree: `pnpm install` if `node_modules` missing.

---

### Task 1: Thread types + store

**Files:**
- Modify: `packages/plugin-sdk/src/domain.ts` (add `AiThreadMessage`, `AiThreadAnchor`, `AiThread`)
- Create: `plugins/github-sync/src/lib/aiThreadStore.ts`
- Test: `plugins/github-sync/src/lib/aiThreadStore.test.ts`

**Interfaces:**
- Produces (domain.ts):
  ```typescript
  export interface AiThreadMessage { role: 'user' | 'ai'; body: string; created_at: number }
  export type AiThreadAnchor =
    | { type: 'line'; filename: string; line: number; side: 'LEFT' | 'RIGHT' }
    | { type: 'step'; step_id: string }
  export interface AiThread {
    id: string
    anchor: AiThreadAnchor
    status: 'draft' | 'pending' | 'answered' | 'error'
    messages: AiThreadMessage[]
    created_at: number
    updated_at: number
  }
  ```
- Produces (aiThreadStore.ts): `aiThreadsStorageKey`, `readAiThreads`, `writeAiThreads`, `removeAiThreads`, and pure helpers `threadsNeedingAnswer(threads)` (threads whose last message is from `user`) and `upsertThread(threads, thread)`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest'
import { threadsNeedingAnswer, upsertThread } from './aiThreadStore'
import type { AiThread } from '@openforge-app/plugin-sdk/domain'

function thread(id: string, lastRole: 'user' | 'ai', status: AiThread['status']): AiThread {
  return {
    id, anchor: { type: 'line', filename: 'a.ts', line: 1, side: 'RIGHT' }, status,
    messages: [{ role: 'user', body: 'q', created_at: 1 }, ...(lastRole === 'ai' ? [{ role: 'ai' as const, body: 'a', created_at: 2 }] : [])],
    created_at: 1, updated_at: 2,
  }
}

describe('aiThreadStore helpers', () => {
  it('threadsNeedingAnswer returns threads whose last message is from the user', () => {
    const needs = thread('t1', 'user', 'draft')
    const answered = thread('t2', 'ai', 'answered')
    expect(threadsNeedingAnswer([needs, answered]).map(t => t.id)).toEqual(['t1'])
  })
  it('upsertThread replaces by id or appends', () => {
    const a = thread('t1', 'user', 'draft')
    const b = thread('t2', 'user', 'draft')
    const updatedA = { ...a, status: 'answered' as const }
    expect(upsertThread([a, b], updatedA).find(t => t.id === 't1')?.status).toBe('answered')
    const c = thread('t3', 'user', 'draft')
    expect(upsertThread([a], c).map(t => t.id)).toEqual(['t1', 't3'])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @openforge-app/plugin-github-sync exec vitest run src/lib/aiThreadStore.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement types (domain.ts) + store**

Add the three types to `packages/plugin-sdk/src/domain.ts` (after `AgentReviewComment`). Then create `aiThreadStore.ts`:

```typescript
import type { BackendOpenForgeAPI } from '@openforge-app/plugin-sdk/backend'
import type { JsonValue } from '@openforge-app/plugin-sdk'
import type { AiThread } from '@openforge-app/plugin-sdk/domain'

export function aiThreadsStorageKey(prId: number, headSha: string): string {
  return `pr-ai-threads:${prId}:${headSha}`
}

export async function readAiThreads(openforge: BackendOpenForgeAPI, prId: number, headSha: string): Promise<AiThread[]> {
  const value = await openforge.storage.global.get<JsonValue>(aiThreadsStorageKey(prId, headSha))
  return (value as AiThread[] | null) ?? []
}

export async function writeAiThreads(openforge: BackendOpenForgeAPI, prId: number, headSha: string, threads: AiThread[]): Promise<void> {
  await openforge.storage.global.set(aiThreadsStorageKey(prId, headSha), threads as unknown as JsonValue)
}

export async function removeAiThreads(openforge: BackendOpenForgeAPI, prId: number, headSha: string): Promise<void> {
  await openforge.storage.global.delete(aiThreadsStorageKey(prId, headSha))
}

/** Threads awaiting an AI answer: the most recent message is from the user. */
export function threadsNeedingAnswer(threads: AiThread[]): AiThread[] {
  return threads.filter(t => t.messages.length > 0 && t.messages[t.messages.length - 1].role === 'user')
}

export function upsertThread(threads: AiThread[], thread: AiThread): AiThread[] {
  const idx = threads.findIndex(t => t.id === thread.id)
  if (idx === -1) return [...threads, thread]
  const next = [...threads]
  next[idx] = thread
  return next
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @openforge-app/plugin-github-sync exec vitest run src/lib/aiThreadStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/plugin-sdk/src/domain.ts plugins/github-sync/src/lib/aiThreadStore.ts plugins/github-sync/src/lib/aiThreadStore.test.ts
git commit -m "Add AI Q&A thread types and store"
```

---

### Task 2: Question prompt builder + answer mapping

**Files:**
- Create: `plugins/github-sync/src/lib/aiThreadPrompt.ts`
- Test: `plugins/github-sync/src/lib/aiThreadPrompt.test.ts`

**Interfaces:**
- Consumes: `AiThread`, `PrFileDiff`, `PrWalkthroughStep`, `parseHunks`.
- Produces:
  - `AI_ANSWERS_JSON_SCHEMA: string` — schema for `{ answers: [{ thread_id, body }] }`.
  - `buildQuestionsPrompt(threads: AiThread[], files: PrFileDiff[], steps: PrWalkthroughStep[]): string` — one prompt with every needing-answer thread: its `thread_id`, the anchor context (for a line anchor, the file + line + the containing hunk text; for a step anchor, the step title/summary), and the prior conversation.
  - `mapAnswersToThreads(raw: string, threads: AiThread[], now: () => number): AiThread[]` — parse `{answers}`, append each matched answer as an `ai` message + status `answered`; threads with no answer become `error`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest'
import { buildQuestionsPrompt, mapAnswersToThreads } from './aiThreadPrompt'
import type { AiThread } from '@openforge-app/plugin-sdk/domain'

const threads: AiThread[] = [{
  id: 't1', anchor: { type: 'line', filename: 'a.ts', line: 2, side: 'RIGHT' }, status: 'pending',
  messages: [{ role: 'user', body: 'why a Map here?', created_at: 1 }], created_at: 1, updated_at: 1,
}]

describe('aiThreadPrompt', () => {
  it('includes each thread id and question text in the prompt', () => {
    const prompt = buildQuestionsPrompt(threads, [], [])
    expect(prompt).toContain('t1')
    expect(prompt).toContain('why a Map here?')
    expect(prompt).toContain('a.ts')
  })
  it('maps answers back onto threads by id and marks answered', () => {
    const raw = JSON.stringify({ answers: [{ thread_id: 't1', body: 'Because ordering matters.' }] })
    const out = mapAnswersToThreads(raw, threads, () => 5)
    expect(out[0].status).toBe('answered')
    expect(out[0].messages.at(-1)).toEqual({ role: 'ai', body: 'Because ordering matters.', created_at: 5 })
  })
  it('marks threads with no answer as error', () => {
    const out = mapAnswersToThreads(JSON.stringify({ answers: [] }), threads, () => 5)
    expect(out[0].status).toBe('error')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @openforge-app/plugin-github-sync exec vitest run src/lib/aiThreadPrompt.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
import type { AiThread, PrFileDiff, PrWalkthroughStep } from '@openforge-app/plugin-sdk/domain'
import { parseHunks } from './hunkParser'

export const AI_ANSWERS_JSON_SCHEMA = JSON.stringify({
  type: 'object',
  required: ['answers'],
  properties: {
    answers: {
      type: 'array',
      items: {
        type: 'object',
        required: ['thread_id', 'body'],
        properties: { thread_id: { type: 'string' }, body: { type: 'string' } },
      },
    },
  },
})

function anchorContext(thread: AiThread, files: PrFileDiff[], steps: PrWalkthroughStep[]): string {
  if (thread.anchor.type === 'step') {
    const step = steps.find(s => s.id === thread.anchor.type === 'step' && s.id === (thread.anchor as { step_id: string }).step_id)
    return step ? `About walkthrough step "${step.title}": ${step.summary}` : `About walkthrough step ${(thread.anchor as { step_id: string }).step_id}`
  }
  const a = thread.anchor
  const file = files.find(f => f.filename === a.filename)
  const hunk = file ? parseHunks(file.patch).find(h => h.text.length > 0) : undefined
  return `About ${a.filename} line ${a.line} (${a.side}):\n\`\`\`diff\n${hunk?.text ?? '(diff unavailable)'}\n\`\`\``
}

export function buildQuestionsPrompt(threads: AiThread[], files: PrFileDiff[], steps: PrWalkthroughStep[]): string {
  const blocks = threads.map(t => {
    const convo = t.messages.map(m => `${m.role === 'user' ? 'Reviewer' : 'You'}: ${m.body}`).join('\n')
    return `--- thread_id: ${t.id} ---\n${anchorContext(t, files, steps)}\n${convo}`
  })
  return [
    'You are the author of this pull request, answering a reviewer\'s questions. You are running inside a checkout of the PR head — read any file and use git history to answer precisely and honestly. If a choice was arbitrary, say so.',
    '',
    'Answer EACH thread below. Respond with a single JSON object: { "answers": [ { "thread_id": "<id>", "body": "<markdown answer>" } ] }. Include one entry per thread_id. No prose outside the JSON.',
    '',
    ...blocks,
  ].join('\n')
}

export function mapAnswersToThreads(raw: string, threads: AiThread[], now: () => number = () => Math.floor(Date.now() / 1000)): AiThread[] {
  let byId = new Map<string, string>()
  try {
    const parsed = JSON.parse(raw) as { answers?: Array<{ thread_id?: unknown; body?: unknown }> }
    for (const a of parsed.answers ?? []) {
      if (typeof a?.thread_id === 'string' && typeof a?.body === 'string') byId.set(a.thread_id, a.body.trim())
    }
  } catch {
    byId = new Map()
  }
  const ts = now()
  return threads.map(t => {
    const answer = byId.get(t.id)
    if (answer === undefined) return { ...t, status: 'error', updated_at: ts }
    return { ...t, status: 'answered', updated_at: ts, messages: [...t.messages, { role: 'ai', body: answer, created_at: ts }] }
  })
}
```

> Fix the `anchorContext` step-lookup (the test only exercises line anchors); the correct step branch is:
> ```typescript
> if (thread.anchor.type === 'step') {
>   const step = steps.find(s => s.id === thread.anchor.step_id)
>   return step ? `About walkthrough step "${step.title}": ${step.summary}` : `About walkthrough step ${thread.anchor.step_id}`
> }
> ```
> (Use this cleaner form when implementing — TypeScript narrows `thread.anchor` to the step variant inside the `if`.)

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @openforge-app/plugin-github-sync exec vitest run src/lib/aiThreadPrompt.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/github-sync/src/lib/aiThreadPrompt.ts plugins/github-sync/src/lib/aiThreadPrompt.test.ts
git commit -m "Add Q&A prompt builder and answer mapping"
```

---

### Task 3: Backend — thread CRUD + batch answer run

**Files:**
- Modify: `plugins/github-sync/src/backend.ts`
- Modify: `plugins/github-sync/src/review/pr/githubSyncClient.ts`

**Interfaces:**
- Consumes: `readAiThreads/writeAiThreads/threadsNeedingAnswer/upsertThread`, `buildQuestionsPrompt/mapAnswersToThreads/AI_ANSWERS_JSON_SCHEMA`, `agentGenerateInRepo`, `getPrFileDiffs`, the walkthrough steps (`readWalkthrough` + `parseAndValidateWalkthroughSteps`).
- Produces client + backend methods:
  - `getAiThreads({ reviewPrId, headSha }) → AiThread[]`
  - `saveAiThread({ reviewPrId, headSha, thread }) → void` (create/update a single thread; used for new questions + follow-up replies + deletes-by-omission)
  - `deleteAiThread({ reviewPrId, headSha, threadId }) → void`
  - `askAgentQuestions({ reviewPrId, headSha, repoOwner, repoName, prNumber, projectId }) → void` (fire-and-forget; sets needing-answer threads to `pending`, runs one agent pass, persists answers)

- [ ] **Step 1: Add thread CRUD backend + client methods**

In `backend.ts` (import the store fns + `AiThread`):

```typescript
context.subscriptions.add(openforge.backend.registerMethod<{ reviewPrId: number; headSha: string }, AiThread[]>('getAiThreads', {
  handler: (r) => readAiThreads(openforge, r.reviewPrId, r.headSha),
}))

context.subscriptions.add(openforge.backend.registerMethod<{ reviewPrId: number; headSha: string; thread: AiThread }, void>('saveAiThread', {
  handler: async (r) => {
    const threads = await readAiThreads(openforge, r.reviewPrId, r.headSha)
    await writeAiThreads(openforge, r.reviewPrId, r.headSha, upsertThread(threads, r.thread))
  },
}))

context.subscriptions.add(openforge.backend.registerMethod<{ reviewPrId: number; headSha: string; threadId: string }, void>('deleteAiThread', {
  handler: async (r) => {
    const threads = await readAiThreads(openforge, r.reviewPrId, r.headSha)
    await writeAiThreads(openforge, r.reviewPrId, r.headSha, threads.filter(t => t.id !== r.threadId))
  },
}))
```

Add the matching client methods in `githubSyncClient.ts` (interface + impl), mirroring the `invokeBackend` pattern, plus `askAgentQuestions` below.

- [ ] **Step 2: Add the batch answer run**

```typescript
context.subscriptions.add(openforge.backend.registerMethod<{
  reviewPrId: number; headSha: string; repoOwner: string; repoName: string; prNumber: number; projectId: string | null
}, void>('askAgentQuestions', {
  handler: async (r) => {
    const threads = await readAiThreads(openforge, r.reviewPrId, r.headSha)
    const pending = threadsNeedingAnswer(threads)
    if (pending.length === 0) return

    // Mark pending, persist immediately so the UI shows "thinking".
    const pendingIds = new Set(pending.map(t => t.id))
    const marked = threads.map(t => (pendingIds.has(t.id) ? { ...t, status: 'pending' as const } : t))
    await writeAiThreads(openforge, r.reviewPrId, r.headSha, marked)

    const files = await invokeHostCommand<PrFileDiff[]>(openforge, 'getPrFileDiffs', {
      owner: r.repoOwner, repo: r.repoName, prNumber: r.prNumber,
    })
    const walkthrough = await readWalkthrough(openforge, r.reviewPrId, r.headSha)
    const steps = parseAndValidateWalkthroughSteps(walkthrough?.steps_json ?? null, files) ?? []
    const prompt = buildQuestionsPrompt(pending, files, steps)

    void (async () => {
      const sessionKey = randomUUID()
      try {
        const result = await invokeHostCommand<{ text: string }>(openforge, 'agentGenerateInRepo', {
          sessionKey, prompt, projectId: r.projectId,
          owner: r.repoOwner, repo: r.repoName, prNumber: r.prNumber, headSha: r.headSha,
          outputSchema: AI_ANSWERS_JSON_SCHEMA,
        })
        const answered = mapAnswersToThreads(result?.text ?? '', pending)
        // Re-read (guard against a concurrent change) and merge answered threads back.
        const latest = await readAiThreads(openforge, r.reviewPrId, r.headSha)
        let merged = latest
        for (const t of answered) merged = upsertThread(merged, t)
        await writeAiThreads(openforge, r.reviewPrId, r.headSha, merged)
      } catch {
        const latest = await readAiThreads(openforge, r.reviewPrId, r.headSha)
        const errored = latest.map(t => (pendingIds.has(t.id) ? { ...t, status: 'error' as const } : t))
        await writeAiThreads(openforge, r.reviewPrId, r.headSha, errored)
      }
    })()
  },
}))
```

Add the `askAgentQuestions` client method. Also clear threads in `deletePrWalkthrough` (extend Plan 2's handler to also `removeAiThreads`).

- [ ] **Step 3: Typecheck + commit**

Run: `pnpm exec tsc --noEmit`

```bash
git add plugins/github-sync/src/backend.ts plugins/github-sync/src/review/pr/githubSyncClient.ts
git commit -m "Add AI thread CRUD and batch answer backend"
```

---

### Task 4: Render line-anchored threads in `buildExtendData`

**Files:**
- Modify: `packages/pr-review-ui/src/diffComments.ts`
- Test: `packages/pr-review-ui/src/diffComments.test.ts` (add cases; create if absent)

**Interfaces:**
- Consumes: `AiThread`.
- Produces: `buildExtendData(filename, existingComments, pendingComments, agentComments, aiThreads?)` — appends, for each line-anchored thread on `filename`, one `CommentDisplayData` entry `{ type: 'ai-thread', thread }`. `CommentDisplayData.comments[]` entry type gains `'ai-thread'` and an optional `thread?: AiThread` field.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest'
import { buildExtendData } from './diffComments'
import type { AiThread } from '@openforge-app/plugin-sdk/domain'

const thread: AiThread = {
  id: 't1', anchor: { type: 'line', filename: 'a.ts', line: 3, side: 'RIGHT' }, status: 'answered',
  messages: [{ role: 'user', body: 'why?', created_at: 1 }, { role: 'ai', body: 'because', created_at: 2 }],
  created_at: 1, updated_at: 2,
}

describe('buildExtendData with AI threads', () => {
  it('places a line-anchored thread on the RIGHT side at its line', () => {
    const { newFile } = buildExtendData('a.ts', [], [], [], [thread])
    const entry = newFile['3'].data.comments.find(c => c.type === 'ai-thread')
    expect(entry?.thread?.id).toBe('t1')
  })
  it('ignores step-anchored threads and threads for other files', () => {
    const stepThread: AiThread = { ...thread, id: 't2', anchor: { type: 'step', step_id: 's1' } }
    const otherFile: AiThread = { ...thread, id: 't3', anchor: { type: 'line', filename: 'b.ts', line: 3, side: 'RIGHT' } }
    const { newFile } = buildExtendData('a.ts', [], [], [], [stepThread, otherFile])
    expect(newFile['3']?.data.comments.some(c => c.type === 'ai-thread')).toBeFalsy()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @openforge-app/pr-review-ui exec vitest run src/diffComments.test.ts`
Expected: FAIL — `buildExtendData` ignores the 5th arg / type error.

- [ ] **Step 3: Implement**

In `diffComments.ts`: extend `CommentDisplayData` entry type union to include `'ai-thread'` and add `thread?: AiThread` (import the type). Add a 5th param and a loop mirroring the agent-comment loop:

```typescript
export function buildExtendData(
  filename: string,
  existingComments: ReviewComment[],
  pendingComments: ReviewSubmissionComment[],
  agentComments: AgentReviewComment[] = [],
  aiThreads: AiThread[] = [],
): { oldFile: Record<string, { data: CommentDisplayData }>; newFile: Record<string, { data: CommentDisplayData }> } {
  // ... existing body unchanged ...

  for (const thread of aiThreads) {
    if (thread.anchor.type !== 'line') continue
    if (!pathMatches(thread.anchor.filename, filename)) continue
    const target = sideToSplitSide(thread.anchor.side) === 'oldFile' ? oldFile : newFile
    const lineKey = String(thread.anchor.line)
    ensureLine(target, lineKey).comments.push({ body: '', type: 'ai-thread', thread })
  }

  return { oldFile, newFile }
}
```

(`sideToSplitSide` already maps `'LEFT'`→`oldFile`, else `newFile`.)

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @openforge-app/pr-review-ui exec vitest run src/diffComments.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/pr-review-ui/src/diffComments.ts packages/pr-review-ui/src/diffComments.test.ts
git commit -m "Render line-anchored AI threads in buildExtendData"
```

---

### Task 5: DiffViewer UI — "Ask the AI" + thread rendering + reply

**Files:**
- Modify: `packages/pr-review-ui/src/DiffViewer.svelte`

**Interfaces:**
- Produces new props: `aiThreads?: AiThread[]`, `onAskAgent?: (filename: string, line: number, side: ReviewSubmissionComment['side'], body: string) => void`, `onReplyToThread?: (threadId: string, body: string) => void`. Passes `aiThreads` into `buildExtendData`.
- Behavior verified manually (no markup assertions per project rules).

- [ ] **Step 1: Add the props + thread into extendData**

In `DiffViewer.svelte` `BaseProps` add the three props above (import `AiThread`), destructure with defaults (`aiThreads = []`), and pass `aiThreads` as the 5th arg wherever `buildExtendData(...)` is called.

- [ ] **Step 2: Add "Ask the AI" to the widget**

In the `renderWidgetLine` snippet, add a third button beside Cancel / Add Comment:

```svelte
      <button
        type="button"
        class="btn btn-sm btn-outline"
        title="Ask the AI author (private, not posted to GitHub)"
        onclick={() => {
          const text = getInlineCommentText(file.filename, lineNumber, side)
          if (!text.trim()) return
          onAskAgent?.(file.filename, lineNumber, inlineCommentDraftSide(side), text.trim())
          clearInlineCommentText(file.filename, lineNumber, side)
          onClose()
        }}
      >Ask the AI</button>
```

- [ ] **Step 3: Render threads in `renderExtendLine`**

Add a branch in the `{#each data.comments as comment}` loop for `comment.type === 'ai-thread'` that renders the thread's messages (user vs AI styling) and, when `comment.thread.status === 'answered'`, a reply textarea whose submit calls `onReplyToThread?.(comment.thread.id, text)`; when `status === 'pending'` show a "The AI is thinking…" spinner; when `error` show a retry hint. Concrete block:

```svelte
{:else if comment.type === 'ai-thread' && comment.thread}
  <div class="px-4 py-2.5 mx-4 my-1.5 bg-base-100 border border-base-300 border-l-4 border-l-info rounded-md text-[0.8rem]">
    <div class="flex items-center gap-2 mb-1.5">
      <span class="badge badge-info badge-sm">Ask the AI</span>
      {#if comment.thread.status === 'pending'}<span class="loading loading-spinner loading-xs"></span>{/if}
      {#if comment.thread.status === 'error'}<span class="text-error text-[0.7rem]">failed — send again</span>{/if}
    </div>
    {#each comment.thread.messages as m}
      <div class="{m.role === 'ai' ? '' : 'font-medium'} mb-1.5">
        <span class="text-base-content/50 text-[0.7rem] mr-1">{m.role === 'ai' ? 'AI author' : 'You'}</span>
        <span class="[&_p]:m-0"><MarkdownContent content={m.body} {onOpenUrl} /></span>
      </div>
    {/each}
    {#if comment.thread.status === 'answered'}
      <ThreadReply threadId={comment.thread.id} {onReplyToThread} />
    {/if}
  </div>
```

`ThreadReply` is a tiny local snippet/component: a textarea + "Reply" button calling `onReplyToThread(threadId, text)` (mirror `renderWidgetLine`'s textarea handling). Define it inline as a Svelte snippet in the same file.

- [ ] **Step 4: Typecheck + import-boundary check**

Run:
```bash
pnpm exec tsc --noEmit
node scripts/check-plugin-import-boundaries.mjs
```
Expected: no new type errors; boundary check passes (no new subpath export added).

- [ ] **Step 5: Commit**

```bash
git add packages/pr-review-ui/src/DiffViewer.svelte
git commit -m "Add Ask-the-AI action and thread rendering to DiffViewer"
```

---

### Task 6: Wire threads through the plugin (create, batch-send, follow-up, step-level)

**Files:**
- Modify: `plugins/github-sync/src/review/pr/PrReviewView.svelte`, `PrReviewDetailSection.svelte`, `WalkthroughTab.svelte`
- Modify: `plugins/github-sync/src/lib/stores.ts` (add `aiThreads` store)

**Interfaces:**
- Consumes: the client methods from Task 3.
- Produces: `$aiThreads` store loaded on PR open; `onAskAgent`/`onReplyToThread` handlers; a "Send N questions to AI" action; step-level ask in the walkthrough.

- [ ] **Step 1: Add the store + load on open**

In `stores.ts`: `export const aiThreads = writable<AiThread[]>([])`. In `PrReviewView.openPrDetail`, after loading review comments: `$aiThreads = await githubSync.getAiThreads({ reviewPrId: pr.id, headSha: pr.head_sha })` (guarded by `isCurrentPrDetailsLoad`), and reset `$aiThreads = []` at the top with the other resets and in `backToList`.

- [ ] **Step 2: Handlers in PrReviewView**

```typescript
  function newThreadId() { return `thread-${crypto.randomUUID()}` }

  async function askAgent(filename: string, line: number, side: 'LEFT' | 'RIGHT', body: string) {
    const pr = $selectedReviewPr; if (!pr) return
    const now = Math.floor(Date.now() / 1000)
    const thread: AiThread = {
      id: newThreadId(), anchor: { type: 'line', filename, line, side }, status: 'draft',
      messages: [{ role: 'user', body, created_at: now }], created_at: now, updated_at: now,
    }
    $aiThreads = [...$aiThreads, thread]
    await githubSync.saveAiThread({ reviewPrId: pr.id, headSha: pr.head_sha, thread })
  }

  async function replyToThread(threadId: string, body: string) {
    const pr = $selectedReviewPr; if (!pr) return
    const now = Math.floor(Date.now() / 1000)
    const updated = $aiThreads.map(t => t.id === threadId
      ? { ...t, status: 'draft' as const, updated_at: now, messages: [...t.messages, { role: 'user' as const, body, created_at: now }] }
      : t)
    $aiThreads = updated
    const t = updated.find(x => x.id === threadId)
    if (t) await githubSync.saveAiThread({ reviewPrId: pr.id, headSha: pr.head_sha, thread: t })
  }

  async function sendQuestionsToAgent() {
    const pr = $selectedReviewPr; if (!pr) return
    await githubSync.askAgentQuestions({
      reviewPrId: pr.id, headSha: pr.head_sha,
      repoOwner: pr.repo_owner, repoName: pr.repo_name, prNumber: pr.number, projectId: $activeProjectId,
    })
    startThreadPolling(pr)
  }
```

`startThreadPolling` mirrors Plan 3's walkthrough polling: every 2.5s `$aiThreads = await githubSync.getAiThreads(...)` until no thread is `pending`; clear timer in `onDestroy`.

- [ ] **Step 3: Thread down to DiffViewer**

Pass `aiThreads={$aiThreads}`, `onAskAgent={askAgent}`, `onReplyToThread={replyToThread}` from `PrReviewView` → `PrReviewDetailSection` → both `DiffViewer` instances (files tab + walkthrough tab) and into `WalkthroughTab`. Add the props to each component's `Props`.

- [ ] **Step 4: "Send N questions to AI" action**

Compute `pendingCount = $derived($aiThreads.filter(t => t.messages.at(-1)?.role === 'user').length)`. Render a button (near `ReviewSubmitPanel`, or a slim bar above the diff) shown when `pendingCount > 0`: label `Send {pendingCount} question{pendingCount === 1 ? '' : 's'} to AI`, `onclick={sendQuestionsToAgent}`. This is separate from the GitHub "Comment/Approve/Request changes" submit (which handles `$pendingManualComments`).

- [ ] **Step 5: Step-level ask in WalkthroughTab**

In `WalkthroughTab`'s step header, add a small "Ask about this step" toggle → textarea → on submit call a new prop `onAskAgentStep(stepId, body)` wired in `PrReviewView` to create a `{ type: 'step', step_id }`-anchored thread (same as `askAgent` but step anchor). Render step-anchored answered threads under the step summary by filtering `$aiThreads` for `anchor.type === 'step' && step_id === step.id`.

- [ ] **Step 6: Typecheck + targeted tests + manual**

Run:
```bash
pnpm exec tsc --noEmit
pnpm --filter @openforge-app/plugin-github-sync exec vitest run src/lib/aiThreadStore.test.ts src/lib/aiThreadPrompt.test.ts
pnpm --filter @openforge-app/pr-review-ui exec vitest run src/diffComments.test.ts
```
Expected: no new type errors; tests PASS.

MANUAL (user, in-app): add a question on a line ("Ask the AI") and on a step; both show as draft; "Send N questions to AI" flips them to "thinking"; after the run, answers appear inline; a follow-up reply re-sends and appends another answer; none of it appears on GitHub.

- [ ] **Step 7: Commit**

```bash
git add plugins/github-sync/src/review/pr/PrReviewView.svelte plugins/github-sync/src/review/pr/PrReviewDetailSection.svelte plugins/github-sync/src/review/pr/WalkthroughTab.svelte plugins/github-sync/src/lib/stores.ts
git commit -m "Wire AI Q&A threads: ask, batch-send, follow-up, step-level"
```

---

## Self-Review

**Spec coverage (Plan 4 slice):**
- Questions on lines and steps → Tasks 5 (line), 6 Step 5 (step). ✓
- Pending + batch-send, one agent answers all → Tasks 2–3, 6 Step 4. ✓
- Back-and-forth threads with replayed history → Task 2 (`buildQuestionsPrompt` includes prior messages), Task 6 (`replyToThread`). ✓
- Local-only, never GitHub → all storage in plugin storage; GitHub path untouched. ✓
- Routing AI vs human → "Ask the AI" (AI thread) vs "Add Comment" (existing pending→GitHub). ✓
- Fire-and-forget + poll (no blocking wait) → Task 3 (`void` run) + Task 6 polling. ✓

**Placeholder scan:** pure logic (Tasks 1, 2, 4) has full code + tests. The `anchorContext` step branch has an explicit corrected version noted in Task 2 Step 3. UI (Tasks 5–6) shows concrete markup/handlers; behavior is manual-verified per the no-markup-assertions rule.

**Type consistency:** `AiThread`/`AiThreadAnchor`/`AiThreadMessage` (Task 1, domain.ts) are used identically in Tasks 2–6; `threadsNeedingAnswer`/`upsertThread` signatures match between store (Task 1) and backend (Task 3); `askAgentQuestions`/`saveAiThread`/`getAiThreads`/`deleteAiThread` client and backend signatures line up; `buildExtendData`'s new 5th param and the `'ai-thread'` entry type are consumed in DiffViewer (Task 5).

**Deferred (spec R-items):** step-anchored threads reuse the same store but a richer step-thread UI is minimal in v1; warm sessions and promote-to-GitHub remain out of scope.
