# PR Combined Walkthrough + AI Review Generation — Implementation Plan (Plan 2 of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the single background pass produce **both** the walkthrough steps *and* an AI review (inline pending comments), by running the repo-aware agent (Plan 1) with a schema-validated combined output and persisting the review comments locally.

**Architecture:** The plugin backend's `startAgentWalkthrough` handler stops taking a client-supplied prompt: it fetches the PR file diffs server-side, compiles a **combined** prompt (steps + review), and calls `agentGenerateInRepo` (Plan 1) with a `--json-schema` for `{ steps, review_comments }`. Steps persist as today (`walkthrough:${prId}:${headSha}`); validated review comments persist in a parallel plugin-storage key (`pr-ai-review:${prId}:${headSha}`) as `AgentReviewComment[]`, loaded into the existing `agentReviewComments` store that `DiffViewer` already renders.

**Tech Stack:** TypeScript (plugin backend + frontend), Svelte 5, plugin storage, the `agentGenerateInRepo` host command from Plan 1.

**Depends on:** Plan 1 (the `agentGenerateInRepo` host command + JSON-schema support).

## Global Constraints

- Rust command boundaries are Plan 1's concern; this plan is TypeScript in `plugins/github-sync/` + `packages/plugin-sdk/`.
- `import type` enforced by `verbatimModuleSyntax`; nullable fields are `T | null`, not optional.
- Frontend→backend only via `githubSync.*` client methods.
- Map-based stores need `new Map()` to trigger reactivity (n/a here — arrays).
- Plugin tests: `pnpm --filter @openforge-app/plugin-github-sync exec vitest run <path>`. Types: `pnpm exec tsc --noEmit` (ignore the known local `ignoreDeprecations "6.0"` artifact).
- New `@openforge-app/pr-review-ui` subpath exports (none expected here) must be added to the allowlist in `scripts/check-plugin-import-boundaries.mjs`.
- Fresh worktree: `pnpm install` if `node_modules` is missing.

---

### Task 1: `commentableLines` helper (which diff lines accept a comment)

**Files:**
- Modify: `plugins/github-sync/src/lib/hunkParser.ts`
- Test: `plugins/github-sync/src/lib/hunkParser.test.ts` (add cases; create if absent)

**Interfaces:**
- Produces: `commentableLines(patch: string | null | undefined): { right: Set<number>; left: Set<number> }` — the set of new-file line numbers (RIGHT: added + context) and old-file line numbers (LEFT: removed + context) that GitHub will accept an inline comment on.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest'
import { commentableLines } from './hunkParser'

describe('commentableLines', () => {
  it('maps context/added lines to RIGHT and context/removed to LEFT', () => {
    const patch = [
      '@@ -1,3 +1,4 @@',
      ' context1',   // old 1, new 1
      '-removed',     // old 2
      '+added1',      // new 2
      '+added2',      // new 3
      ' context2',   // old 3, new 4
    ].join('\n')
    const { right, left } = commentableLines(patch)
    expect([...right].sort((a, b) => a - b)).toEqual([1, 2, 3, 4])
    expect([...left].sort((a, b) => a - b)).toEqual([1, 2, 3])
  })
  it('returns empty sets for empty/absent patch', () => {
    expect(commentableLines(null).right.size).toBe(0)
    expect(commentableLines('').left.size).toBe(0)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @openforge-app/plugin-github-sync exec vitest run src/lib/hunkParser.test.ts`
Expected: FAIL — `commentableLines` is not exported.

- [ ] **Step 3: Implement**

Add to `hunkParser.ts`:

```typescript
const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

/**
 * The line numbers a GitHub inline comment can anchor to, split by side:
 * RIGHT = added + context (new-file numbering), LEFT = removed + context
 * (old-file numbering). Used to drop AI review comments that target a
 * non-diff line.
 */
export function commentableLines(patch: string | null | undefined): {
  right: Set<number>
  left: Set<number>
} {
  const right = new Set<number>()
  const left = new Set<number>()
  if (!patch) return { right, left }

  let oldLine = 0
  let newLine = 0
  for (const line of patch.split('\n')) {
    const header = line.match(HUNK_HEADER)
    if (header) {
      oldLine = Number(header[1])
      newLine = Number(header[2])
      continue
    }
    if (line.startsWith('+')) {
      right.add(newLine)
      newLine++
    } else if (line.startsWith('-')) {
      left.add(oldLine)
      oldLine++
    } else if (line.startsWith(' ')) {
      right.add(newLine)
      left.add(oldLine)
      newLine++
      oldLine++
    }
    // '\' (no-newline marker) and any stray lines are ignored.
  }
  return { right, left }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @openforge-app/plugin-github-sync exec vitest run src/lib/hunkParser.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/github-sync/src/lib/hunkParser.ts plugins/github-sync/src/lib/hunkParser.test.ts
git commit -m "Add commentableLines helper for review-comment validation"
```

---

### Task 2: Validate AI review comments against the live diff

**Files:**
- Create: `plugins/github-sync/src/lib/reviewCommentsParse.ts`
- Test: `plugins/github-sync/src/lib/reviewCommentsParse.test.ts`

**Interfaces:**
- Consumes: `commentableLines` (Task 1).
- Produces:
  - `interface ValidatedReviewComment { filename: string; line: number; side: 'LEFT' | 'RIGHT'; body: string; kind: 'question' | 'suggestion' | 'note' }`
  - `parseAndValidateReviewComments(raw: string | null | undefined, files: PrFileDiff[]): ValidatedReviewComment[]` — reads the combined JSON's `review_comments`, drops any comment whose `filename` isn't in the diff, whose `side` isn't LEFT/RIGHT, or whose `line` isn't commentable for that side; unknown `kind` defaults to `note`. Never throws; returns `[]` on malformed input.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest'
import { parseAndValidateReviewComments } from './reviewCommentsParse'
import type { PrFileDiff } from '@openforge-app/plugin-sdk/domain'

function file(partial: Partial<PrFileDiff>): PrFileDiff {
  return {
    filename: 'a.ts', previous_filename: null, status: 'modified',
    additions: 1, deletions: 0, patch: '@@ -1,1 +1,2 @@\n context\n+added\n',
    sha: 'x', is_truncated: false, patch_line_count: 3, ...partial,
  } as PrFileDiff
}

describe('parseAndValidateReviewComments', () => {
  const files = [file({ filename: 'a.ts' })] // RIGHT lines {1,2}, LEFT {1}

  it('keeps a valid comment on a commentable line', () => {
    const raw = JSON.stringify({ review_comments: [
      { filename: 'a.ts', line: 2, side: 'RIGHT', body: 'why here?', kind: 'question' },
    ]})
    expect(parseAndValidateReviewComments(raw, files)).toEqual([
      { filename: 'a.ts', line: 2, side: 'RIGHT', body: 'why here?', kind: 'question' },
    ])
  })

  it('drops comments on unknown files or non-commentable lines and defaults kind', () => {
    const raw = JSON.stringify({ review_comments: [
      { filename: 'nope.ts', line: 1, side: 'RIGHT', body: 'x' },
      { filename: 'a.ts', line: 99, side: 'RIGHT', body: 'x' },
      { filename: 'a.ts', line: 1, side: 'RIGHT', body: 'ok' },
    ]})
    expect(parseAndValidateReviewComments(raw, files)).toEqual([
      { filename: 'a.ts', line: 1, side: 'RIGHT', body: 'ok', kind: 'note' },
    ])
  })

  it('returns [] for malformed input', () => {
    expect(parseAndValidateReviewComments('not json', files)).toEqual([])
    expect(parseAndValidateReviewComments(JSON.stringify({}), files)).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @openforge-app/plugin-github-sync exec vitest run src/lib/reviewCommentsParse.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
import type { PrFileDiff } from '@openforge-app/plugin-sdk/domain'
import { commentableLines } from './hunkParser'

export interface ValidatedReviewComment {
  filename: string
  line: number
  side: 'LEFT' | 'RIGHT'
  body: string
  kind: 'question' | 'suggestion' | 'note'
}

const KINDS = new Set(['question', 'suggestion', 'note'])

export function parseAndValidateReviewComments(
  raw: string | null | undefined,
  files: PrFileDiff[],
): ValidatedReviewComment[] {
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!parsed || typeof parsed !== 'object') return []
  const commentsRaw = (parsed as Record<string, unknown>).review_comments
  if (!Array.isArray(commentsRaw)) return []

  const linesByFile = new Map<string, { right: Set<number>; left: Set<number> }>()
  for (const f of files) linesByFile.set(f.filename, commentableLines(f.patch))

  const out: ValidatedReviewComment[] = []
  for (const c of commentsRaw) {
    if (!c || typeof c !== 'object') continue
    const obj = c as Record<string, unknown>
    const filename = obj.filename
    const line = obj.line
    const side = obj.side
    const body = obj.body
    if (typeof filename !== 'string' || typeof body !== 'string') continue
    if (typeof line !== 'number' || !Number.isInteger(line)) continue
    if (side !== 'LEFT' && side !== 'RIGHT') continue
    const lines = linesByFile.get(filename)
    if (!lines) continue
    const set = side === 'RIGHT' ? lines.right : lines.left
    if (!set.has(line)) continue
    const kindRaw = obj.kind
    const kind = typeof kindRaw === 'string' && KINDS.has(kindRaw)
      ? (kindRaw as ValidatedReviewComment['kind'])
      : 'note'
    out.push({ filename, line, side, body: body.trim(), kind })
  }
  return out
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @openforge-app/plugin-github-sync exec vitest run src/lib/reviewCommentsParse.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/github-sync/src/lib/reviewCommentsParse.ts plugins/github-sync/src/lib/reviewCommentsParse.test.ts
git commit -m "Validate AI review comments against the live diff"
```

---

### Task 3: Combined prompt + output schema

**Files:**
- Modify: `plugins/github-sync/src/lib/walkthroughPrompt.md`
- Create: `plugins/github-sync/src/lib/walkthroughSchema.ts`

**Interfaces:**
- Produces: `WALKTHROUGH_REVIEW_JSON_SCHEMA: string` — a JSON Schema (stringified) for `{ steps, review_comments }`, passed to `agentGenerateInRepo` as `outputSchema`.

- [ ] **Step 1: Extend the prompt template**

In `walkthroughPrompt.md`, after the intro paragraph add a repo-exploration note, and extend the Output Format to include `review_comments`. Insert before the closing "Rules:" list:

```markdown
You are running inside a **checkout of this PR's head commit** — you may open and search any file in the repository and use `git log`/`git blame`/`git show` to understand history and intent. Use that context to explain *why*, not just *what*.

In the SAME JSON object, also return `review_comments`: your own review remarks, each anchored to a changed line.

```json
{
  "steps": [ /* as described above */ ],
  "review_comments": [
    {
      "filename": "exact filename from the Changed Files list above",
      "line": 42,
      "side": "RIGHT",            // RIGHT = the new file (added/context lines); LEFT = the old file (removed/context lines)
      "body": "Your remark in markdown.",
      "kind": "question"          // one of: "question" | "suggestion" | "note"
    }
  ]
}
```

Additional rules for `review_comments`:
- Only anchor to lines that actually appear in the diff (added, removed, or context). Do not invent line numbers.
- Prefer a few high-value remarks over exhaustive nitpicking. `review_comments` may be an empty array.
```

- [ ] **Step 2: Add the schema constant**

Create `walkthroughSchema.ts`:

```typescript
// JSON Schema handed to `claude --json-schema` so the combined walkthrough +
// review generation returns a validated object. Kept in sync with
// parseAndValidateWalkthroughSteps + parseAndValidateReviewComments (both of
// which still re-validate against the live diff — the schema shapes output, the
// parsers enforce diff-truth).
export const WALKTHROUGH_REVIEW_JSON_SCHEMA = JSON.stringify({
  type: 'object',
  required: ['steps', 'review_comments'],
  properties: {
    steps: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'title', 'summary', 'files'],
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          summary: { type: 'string' },
          files: {
            type: 'array',
            items: {
              type: 'object',
              required: ['filename'],
              properties: {
                filename: { type: 'string' },
                hunk_indexes: { type: ['array', 'null'], items: { type: 'integer' } },
              },
            },
          },
        },
      },
    },
    review_comments: {
      type: 'array',
      items: {
        type: 'object',
        required: ['filename', 'line', 'side', 'body'],
        properties: {
          filename: { type: 'string' },
          line: { type: 'integer' },
          side: { type: 'string', enum: ['LEFT', 'RIGHT'] },
          body: { type: 'string' },
          kind: { type: 'string', enum: ['question', 'suggestion', 'note'] },
        },
      },
    },
  },
})
```

- [ ] **Step 3: Typecheck + commit**

Run: `pnpm exec tsc --noEmit` (ignore the known deprecations artifact).

```bash
git add plugins/github-sync/src/lib/walkthroughPrompt.md plugins/github-sync/src/lib/walkthroughSchema.ts
git commit -m "Add combined walkthrough+review prompt and output schema"
```

---

### Task 4: Persist review comments + combined generation orchestration

**Files:**
- Create: `plugins/github-sync/src/lib/reviewCommentsStore.ts`
- Test: `plugins/github-sync/src/lib/reviewCommentsStore.test.ts`
- Modify: `plugins/github-sync/src/lib/walkthroughStore.ts` (add `runWalkthroughAndReviewGeneration`)

**Interfaces:**
- Consumes: `parseAndValidateReviewComments` (Task 2), the plugin storage helpers pattern.
- Produces:
  - `prAiReviewStorageKey(prId, headSha)` = `pr-ai-review:${prId}:${headSha}`
  - `readAiReviewComments/writeAiReviewComments/removeAiReviewComments` (mirror walkthroughStore) storing `AgentReviewComment[]`.
  - `toAgentReviewComments(prId, sessionKey, comments: ValidatedReviewComment[], now): AgentReviewComment[]` — synthesizes ids (sequential from 1), `comment_type: 'inline'`, `status: 'pending'`, `opencode_session_id: null`.
  - `updateAiReviewCommentStatus(openforge, prId, headSha, commentId, status)`.
  - `runWalkthroughAndReviewGeneration(openforge, params, generate, files, now?)` — like `runWalkthroughGeneration` but also validates + persists review comments (session-guarded on the walkthrough row).

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest'
import { toAgentReviewComments } from './reviewCommentsStore'

describe('toAgentReviewComments', () => {
  it('maps validated comments to AgentReviewComment shape with synthetic ids', () => {
    const out = toAgentReviewComments(7, 'sess', [
      { filename: 'a.ts', line: 2, side: 'RIGHT', body: 'q', kind: 'question' },
    ], () => 1000)
    expect(out).toEqual([{
      id: 1, review_pr_id: 7, review_session_key: 'sess', comment_type: 'inline',
      file_path: 'a.ts', line_number: 2, side: 'RIGHT', body: 'q',
      status: 'pending', opencode_session_id: null, created_at: 1000, updated_at: 1000,
    }])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @openforge-app/plugin-github-sync exec vitest run src/lib/reviewCommentsStore.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `reviewCommentsStore.ts`**

```typescript
import type { BackendOpenForgeAPI } from '@openforge-app/plugin-sdk/backend'
import type { JsonValue } from '@openforge-app/plugin-sdk'
import type { AgentReviewComment } from '@openforge-app/plugin-sdk/domain'
import type { ValidatedReviewComment } from './reviewCommentsParse'

export function prAiReviewStorageKey(prId: number, headSha: string): string {
  return `pr-ai-review:${prId}:${headSha}`
}

export async function readAiReviewComments(
  openforge: BackendOpenForgeAPI, prId: number, headSha: string,
): Promise<AgentReviewComment[]> {
  const value = await openforge.storage.global.get<JsonValue>(prAiReviewStorageKey(prId, headSha))
  return (value as AgentReviewComment[] | null) ?? []
}

export async function writeAiReviewComments(
  openforge: BackendOpenForgeAPI, prId: number, headSha: string, comments: AgentReviewComment[],
): Promise<void> {
  await openforge.storage.global.set(prAiReviewStorageKey(prId, headSha), comments as unknown as JsonValue)
}

export async function removeAiReviewComments(
  openforge: BackendOpenForgeAPI, prId: number, headSha: string,
): Promise<void> {
  await openforge.storage.global.delete(prAiReviewStorageKey(prId, headSha))
}

export function toAgentReviewComments(
  prId: number, sessionKey: string, comments: ValidatedReviewComment[], now: () => number = () => Math.floor(Date.now() / 1000),
): AgentReviewComment[] {
  const ts = now()
  return comments.map((c, i) => ({
    id: i + 1,
    review_pr_id: prId,
    review_session_key: sessionKey,
    comment_type: 'inline',
    file_path: c.filename,
    line_number: c.line,
    side: c.side,
    body: c.body,
    status: 'pending',
    opencode_session_id: null,
    created_at: ts,
    updated_at: ts,
  }))
}

export async function updateAiReviewCommentStatus(
  openforge: BackendOpenForgeAPI, prId: number, headSha: string, commentId: number, status: string,
): Promise<void> {
  const current = await readAiReviewComments(openforge, prId, headSha)
  const next = current.map(c => (c.id === commentId ? { ...c, status } : c))
  await writeAiReviewComments(openforge, prId, headSha, next)
}
```

- [ ] **Step 4: Add `runWalkthroughAndReviewGeneration` to `walkthroughStore.ts`**

Add (imports: `parseAndValidateReviewComments`, the review store fns, `toAgentReviewComments`, `PrFileDiff`):

```typescript
export async function runWalkthroughAndReviewGeneration(
  openforge: BackendOpenForgeAPI,
  params: { prId: number; headSha: string; sessionKey: string; prompt: string },
  generate: (sessionKey: string, prompt: string) => Promise<string>,
  files: PrFileDiff[],
  now: () => number = nowSeconds,
): Promise<void> {
  const { prId, headSha, sessionKey, prompt } = params

  const persist = async (patch: Partial<PrWalkthrough>): Promise<void> => {
    const current = await readWalkthrough(openforge, prId, headSha)
    if (!current || current.walkthrough_session_key !== sessionKey) return
    await writeWalkthrough(openforge, { ...current, ...patch, updated_at: now() })
  }

  try {
    const text = await generate(sessionKey, prompt)
    // Only persist if this run still owns the row (not superseded/deleted).
    const current = await readWalkthrough(openforge, prId, headSha)
    if (!current || current.walkthrough_session_key !== sessionKey) return

    const stepsJson = extractWalkthroughStepsJson(text)
    const reviewComments = parseAndValidateReviewComments(text, files)
    await writeAiReviewComments(openforge, prId, headSha, toAgentReviewComments(prId, sessionKey, reviewComments, now))

    if (stepsJson) {
      await persist({ status: 'ready', steps_json: stepsJson, error_message: null })
    } else {
      await persist({ status: 'error', steps_json: null, error_message: WALKTHROUGH_INVALID_JSON_MESSAGE })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await persist({ status: 'error', steps_json: null, error_message: message })
  }
}
```

> Note: `extractWalkthroughStepsJson` already tolerates the extra `review_comments` key (it only checks for a `steps` array), so the combined object parses cleanly for steps.

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @openforge-app/plugin-github-sync exec vitest run src/lib/reviewCommentsStore.test.ts`
Expected: PASS. Also run existing `walkthroughStore` tests to confirm no regression: `pnpm --filter @openforge-app/plugin-github-sync exec vitest run src/lib/walkthroughStore.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add plugins/github-sync/src/lib/reviewCommentsStore.ts plugins/github-sync/src/lib/reviewCommentsStore.test.ts plugins/github-sync/src/lib/walkthroughStore.ts
git commit -m "Persist AI review comments and add combined generation orchestrator"
```

---

### Task 5: Backend — repo-aware combined generation + review-comment reads

**Files:**
- Modify: `plugins/github-sync/src/backend.ts`
- Modify: `plugins/github-sync/src/review/pr/githubSyncClient.ts`

**Interfaces:**
- Consumes: `agentGenerateInRepo` (Plan 1) via `invokeHostCommand`; `getPrFileDiffs` host command; `compileWalkthroughPrompt`; `WALKTHROUGH_REVIEW_JSON_SCHEMA`; `runWalkthroughAndReviewGeneration`; review store fns.
- Produces:
  - `startAgentWalkthrough` request **drops** `prompt` (compiled server-side) and gains nothing else.
  - New backend methods + client methods: `getPrAiReviewComments({ reviewPrId, headSha }) → AgentReviewComment[]`; `updatePrAiReviewCommentStatus({ reviewPrId, headSha, commentId, status }) → void`.

- [ ] **Step 1: Rewrite the `startAgentWalkthrough` handler**

Replace the handler body (backend.ts lines 119-150) so it fetches diffs, compiles the combined prompt, and calls `agentGenerateInRepo`. Remove `prompt` from the request generic; add imports for `compileWalkthroughPrompt`, `WALKTHROUGH_REVIEW_JSON_SCHEMA`, `runWalkthroughAndReviewGeneration`, and `PrFileDiff`.

```typescript
context.subscriptions.add(openforge.backend.registerMethod<{
  repoOwner: string
  repoName: string
  prNumber: number
  headRef: string
  baseRef: string
  prTitle: string
  prBody: string | null
  headSha: string
  reviewPrId: number
  projectId: string | null
}, { walkthrough_session_key: string }>('startAgentWalkthrough', {
  handler: async (request) => {
    const sessionKey = randomUUID()
    const params = { prId: request.reviewPrId, headSha: request.headSha, sessionKey, prompt: '' }
    await beginWalkthroughGeneration(openforge, params)

    // Fetch diffs server-side so the trigger works without the UI having loaded files.
    const files = await invokeHostCommand<PrFileDiff[]>(openforge, 'getPrFileDiffs', {
      owner: request.repoOwner, repo: request.repoName, prNumber: request.prNumber,
    })
    const prompt = compileWalkthroughPrompt({ title: request.prTitle, body: request.prBody, files })

    void runWalkthroughAndReviewGeneration(
      openforge,
      { ...params, prompt },
      (key, p) =>
        invokeHostCommand<{ text: string }>(openforge, 'agentGenerateInRepo', {
          sessionKey: key,
          prompt: p,
          model: WALKTHROUGH_MODEL,
          projectId: request.projectId,
          owner: request.repoOwner,
          repo: request.repoName,
          prNumber: request.prNumber,
          headSha: request.headSha,
          outputSchema: WALKTHROUGH_REVIEW_JSON_SCHEMA,
        }).then((result) => result?.text ?? ''),
      files,
    )
    return { walkthrough_session_key: sessionKey }
  },
}))
```

- [ ] **Step 2: Add the review-comment backend methods**

Add near the walkthrough handlers (import `readAiReviewComments`, `updateAiReviewCommentStatus`, `removeAiReviewComments`, `AgentReviewComment`):

```typescript
context.subscriptions.add(openforge.backend.registerMethod<{ reviewPrId: number; headSha: string }, AgentReviewComment[]>('getPrAiReviewComments', {
  handler: (request) => readAiReviewComments(openforge, request.reviewPrId, request.headSha),
}))

context.subscriptions.add(openforge.backend.registerMethod<{ reviewPrId: number; headSha: string; commentId: number; status: string }, void>('updatePrAiReviewCommentStatus', {
  handler: (request) => updateAiReviewCommentStatus(openforge, request.reviewPrId, request.headSha, request.commentId, request.status),
}))
```

Also, in `deletePrWalkthrough`'s handler, also clear the review comments so regenerate starts clean:

```typescript
  handler: async (request) => {
    await removeWalkthrough(openforge, request.reviewPrId, request.headSha)
    await removeAiReviewComments(openforge, request.reviewPrId, request.headSha)
  },
```

- [ ] **Step 3: Add client methods + update the request type**

In `githubSyncClient.ts`: remove `prompt` from the `startAgentWalkthrough` request type (interface + impl passes `request` through unchanged), and add:

```typescript
  // interface GithubSyncPrReviewClient:
  getPrAiReviewComments(request: { reviewPrId: number; headSha: string }): Promise<AgentReviewComment[]>
  updatePrAiReviewCommentStatus(request: { reviewPrId: number; headSha: string; commentId: number; status: string }): Promise<void>

  // createGithubSyncPrReviewClient return object:
  getPrAiReviewComments: ({ reviewPrId, headSha }) => invokeBackend<AgentReviewComment[]>(api, 'getPrAiReviewComments', { reviewPrId, headSha }),
  updatePrAiReviewCommentStatus: ({ reviewPrId, headSha, commentId, status }) => invokeBackend<void>(api, 'updatePrAiReviewCommentStatus', { reviewPrId, headSha, commentId, status }),
```

- [ ] **Step 4: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no new errors. If `startAgentWalkthrough` callers still pass `prompt`, they'll error — fix them (Plan 3's `generateWalkthrough` and `WalkthroughTab.handleGenerate`) to stop passing `prompt`.

- [ ] **Step 5: Commit**

```bash
git add plugins/github-sync/src/backend.ts plugins/github-sync/src/review/pr/githubSyncClient.ts
git commit -m "Generate combined walkthrough+review via repo-aware agent"
```

---

### Task 6: Frontend — load + persist AI review comments locally

**Files:**
- Modify: `plugins/github-sync/src/review/pr/PrReviewView.svelte`

**Interfaces:**
- Consumes: `githubSync.getPrAiReviewComments`, `githubSync.updatePrAiReviewCommentStatus`.
- Produces: `$agentReviewComments` is sourced from the local AI-review store (this feature), and status updates persist there.

- [ ] **Step 1: Load AI review comments on PR open**

In `openPrDetail` (PrReviewView), replace the existing agent-comment load:

```typescript
    // was: const agentComments = await githubSync.listAgentReviewComments({ reviewPrId: pr.id })
    const agentComments = await githubSync.getPrAiReviewComments({ reviewPrId: pr.id, headSha: pr.head_sha })
    if (!isCurrentPrDetailsLoad(loadSequence, pr)) return
    $agentReviewComments = agentComments
```

> Rationale: the local AI-review store (keyed by commit) is this feature's source of truth. The older `listAgentReviewComments` (Rust POC path) is superseded; leave the client method in place but unused by this view.

- [ ] **Step 2: Persist status changes to the local store**

Change the `onUpdateAgentCommentStatus` wiring passed to `PrReviewDetailSection` (line 775) from the old host-command call to the local store, using the open PR's coordinates:

```svelte
      onUpdateAgentCommentStatus={(commentId, status) =>
        githubSync.updatePrAiReviewCommentStatus({
          reviewPrId: $selectedReviewPr.id,
          headSha: $selectedReviewPr.head_sha,
          commentId,
          status,
        })}
```

- [ ] **Step 3: Refresh after generation completes**

In Plan 3's `startWalkthroughPolling`, when a poll observes `status === 'ready'` for the **currently open** PR, reload its AI review comments so they appear without reopening:

```typescript
      if (wt && wt.status !== 'generating') {
        clearInterval(timer)
        walkthroughPollTimers.delete(pr.id)
        if ($selectedReviewPr?.id === pr.id && wt.status === 'ready') {
          $agentReviewComments = await githubSync.getPrAiReviewComments({ reviewPrId: pr.id, headSha: pr.head_sha })
        }
      }
```

- [ ] **Step 4: Typecheck + targeted tests**

Run:
```bash
pnpm exec tsc --noEmit
pnpm --filter @openforge-app/plugin-github-sync exec vitest run src/lib/reviewCommentsParse.test.ts src/lib/reviewCommentsStore.test.ts src/lib/hunkParser.test.ts
```
Expected: no new type errors; tests PASS.

- [ ] **Step 5: MANUAL verification (user runs the app)**

Generate on a PR whose base repo is cloned locally; confirm: (a) after ~1–2 min the walkthrough tab appears with steps; (b) AI review remarks show as green "AI Review" comments on diff lines; (c) Approve moves one into pending comments; (d) Dismiss hides it and survives reopening the PR.

- [ ] **Step 6: Commit**

```bash
git add plugins/github-sync/src/review/pr/PrReviewView.svelte
git commit -m "Load and persist AI review comments from local store"
```

---

## Self-Review

**Spec coverage (Plan 2 slice):**
- Combined `{steps, review_comments}` in one pass → Tasks 3–5. ✓
- Schema-validated output via `--json-schema` → Task 3 + Task 5 (`outputSchema`). ✓
- Review comments constrained to commentable diff lines → Tasks 1–2. ✓
- Local-only persistence keyed per commit → Task 4. ✓
- Render through existing `agentComments` path → Task 6 (feeds `$agentReviewComments`). ✓
- Prompt compiled server-side (unblocks the card trigger) → Task 5 Step 1. ✓

**Placeholder scan:** none — pure logic (Tasks 1, 2, 4) has full code + tests; wiring (Task 5, 6) shows exact edits. `params.prompt: ''` in Task 5 is immediately overwritten by the compiled `prompt` in the `runWalkthroughAndReviewGeneration` call.

**Type consistency:** `ValidatedReviewComment` (Task 2) is consumed by `toAgentReviewComments` (Task 4); `AgentReviewComment` fields match domain.ts verbatim (`comment_type`, `file_path`, `line_number`, `side`, `status`, `opencode_session_id`); the `startAgentWalkthrough` request loses `prompt` consistently across backend + client + callers (Plan 3 flagged the same). `getPrAiReviewComments`/`updatePrAiReviewCommentStatus` signatures match between client and backend.

**R1/R2/R7 (spec) deferred:** PR-level (off-diff) remarks, re-anchoring on new commits, and promote-to-GitHub are not implemented; `review_comments` are diff-line-anchored only, and a new commit produces a fresh key (stale handling per Plan 3).
