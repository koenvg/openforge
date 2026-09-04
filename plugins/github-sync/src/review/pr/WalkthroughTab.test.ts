import { fireEvent, render, screen, within } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
import type { AiThread, PrFileDiff, PrWalkthrough, ReviewPullRequest, ReviewSubmissionComment } from '@openforge-app/plugin-sdk/domain'
import type { GithubSyncPrReviewClient } from './githubSyncClient'

// Replace the heavy diff renderer with a stub that records the props WalkthroughTab
// forwards, and renders the footer snippet (where the submit panel lives in Task 3).
vi.mock('@openforge-app/pr-review-ui/DiffViewer.svelte', async () => ({
  default: (await import('./__fixtures__/DiffViewerStub.svelte')).default,
}))

vi.mock('../../lib/domUtils', () => ({
  isInputFocused: () => false,
}))

// Generation reads the two guidance settings through the host API; the stub api
// used here has none, so stub the resolver to a fixed pair.
vi.mock('../../lib/walkthroughGuidance', () => ({
  resolveWalkthroughGuidance: vi.fn(async () => ({ reviewGuidance: '', walkthroughGuidance: '' })),
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
    getPrTicket: vi.fn(async () => ({ snapshot: null, jiraConfigured: false })),
    setPrJiraKey: vi.fn(async () => {}),
    startAgentWalkthrough: vi.fn(async () => ({ walkthrough_session_key: 'k' })),
    abortAgentWalkthrough: vi.fn(async () => {}),
    deletePrWalkthrough: vi.fn(async () => {}),
  } as unknown as GithubSyncPrReviewClient
}

/**
 * The walkthrough opens on the ticket step, so the concept steps start at 2 and
 * the review/submit step is last. Navigate by the number shown in the bubble.
 */
async function goToStep(stepNumber: number) {
  await fireEvent.click(await screen.findByRole('button', { name: String(stepNumber) }))
}

function renderWalkthrough(overrides: Record<string, unknown> = {}) {
  const onPendingCommentsChange = vi.fn()
  const onSubmitReview = vi.fn(async () => {})
  const rendered = render(WalkthroughTab, {
    props: {
      api: {} as unknown as FrontendOpenForgeAPI,
      githubSync: makeGithubSync(),
      pr: basePr,
      files: [fileA, fileB],
      fetchFileContents: vi.fn(async () => ({ oldContent: '', newContent: '' })),
      resolveRepositoryImage: vi.fn(async () => null),
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
  return { onPendingCommentsChange, onSubmitReview, unmount: rendered.unmount }
}

describe('WalkthroughTab comment sync', () => {
  it('forwards the shared pending-comment change handler to the per-step diff viewer', async () => {
    const { onPendingCommentsChange } = renderWalkthrough()
    await goToStep(2)
    await screen.findByText('Step one')

    await fireEvent.click(screen.getByTestId('stub-add-pending'))

    expect(onPendingCommentsChange).toHaveBeenCalledWith([
      { path: 'stub.ts', line: 1, side: 'RIGHT', body: 'stub comment' },
    ])
  })

  it('feeds only the current step files to the per-step diff viewer', async () => {
    renderWalkthrough()
    await goToStep(2)
    await screen.findByText('Step one')

    const stub = screen.getByTestId('diff-viewer-stub')
    expect(stub.getAttribute('data-file-count')).toBe('1')
    expect(within(stub).getByText('src/main.rs')).toBeTruthy()
    expect(within(stub).queryByText('src/checkout.ts')).toBeNull()
  })
})

describe('WalkthroughTab review/submit step', () => {
  it('opens on the ticket step so the reviewer sees the ticket before the diff', async () => {
    renderWalkthrough()

    expect(await screen.findByText('Ticket coverage')).toBeTruthy()
    // Shown even with Jira unconfigured, because otherwise nothing explains the
    // absent gap analysis.
    expect(screen.getByText(/Jira is not connected/i)).toBeTruthy()
  })

  it('adds a trailing Review & submit step beyond the parsed steps', async () => {
    renderWalkthrough()
    await goToStep(2)
    await screen.findByText('Step one')

    // 1 ticket step + 2 parsed steps + 1 review/submit step.
    expect(screen.getByText('of 4')).toBeTruthy()
    // The submit panel is not shown on a normal step.
    expect(screen.queryByText('Submit Review')).toBeNull()
  })

  it('renders the full diff and the submit panel on the final step', async () => {
    renderWalkthrough()
    await goToStep(4)

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
    await goToStep(4)
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

describe('WalkthroughTab ticket coverage → review', () => {
  function makeWalkthroughWithCoverage(): PrWalkthrough {
    const walkthrough = makeWalkthrough()
    return {
      ...walkthrough,
      steps_json: JSON.stringify({
        ...JSON.parse(walkthrough.steps_json!),
        ticket_coverage: {
          verdict: 'partial',
          summary: 'Login lands, but a label went singular.',
          criteria: [
            {
              id: 'ac-1',
              text: 'Domains label stays plural',
              status: 'partial',
              evidence: [],
              notes: 'Tooltip dropped.',
            },
          ],
          out_of_scope: [],
        },
      }),
    }
  }

  function renderWithCoverage(overrides: Record<string, unknown> = {}) {
    const githubSync = makeGithubSync()
    githubSync.getPrWalkthrough = vi.fn(async () => makeWalkthroughWithCoverage())
    githubSync.getPrTicket = vi.fn(async () => ({
      snapshot: { issue_key: 'AVIV-1', item: null, error: null, fetched_at: 0 },
      jiraConfigured: true,
    }))
    return renderWalkthrough({ githubSync, ...overrides })
  }

  it('folds a flagged ticket-coverage gap into the submitted review body, then clears it', async () => {
    const { onSubmitReview } = renderWithCoverage()

    await fireEvent.click(await screen.findByRole('button', { name: /^add to review$/i }))

    await goToStep(4)
    await screen.findByText('Review & submit')
    expect(screen.getByText('Partial')).toBeTruthy()

    const textarea = screen.getByRole('textbox', { name: 'Review summary comment' })
    await fireEvent.input(textarea, { target: { value: 'Otherwise fine.' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Comment' }))

    expect(onSubmitReview).toHaveBeenCalledWith(
      expect.objectContaining({
        body: 'Ticket coverage gaps:\n- **Partial**: Jira ticket mentions "Domains label stays plural", but Tooltip dropped.\n\nOtherwise fine.',
      }),
    )

    // Submitting clears the flagged finding, so the ticket step reverts to unflagged.
    await goToStep(1)
    expect(await screen.findByRole('button', { name: /^add to review$/i })).toBeTruthy()
  })

  it('lets the reviewer remove a flagged finding before submitting', async () => {
    renderWithCoverage()

    await fireEvent.click(await screen.findByRole('button', { name: /^add to review$/i }))
    await goToStep(4)
    await screen.findByText('Review & submit')
    expect(screen.getByText('Partial')).toBeTruthy()

    await fireEvent.click(screen.getByLabelText('Remove "Partial" from review'))

    expect(screen.queryByText('Partial')).toBeNull()
    expect((screen.getByRole('button', { name: 'Comment' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('WalkthroughTab step-details collapse', () => {
  it('hides the step summary so the diff gets the vertical space back, and remembers the choice', async () => {
    globalThis.localStorage?.clear()
    const { unmount } = renderWalkthrough()
    // Step 1 is the ticket step, so walk to the first concept step.
    await goToStep(2)
    await screen.findByText('Step one')
    expect(screen.getByText('First concept')).toBeTruthy()

    await fireEvent.click(screen.getByRole('button', { name: 'Collapse step details' }))

    expect(screen.queryByText('First concept')).toBeNull()
    // The title stays visible so the reviewer still knows which step they are on.
    expect(screen.getByText('Step one')).toBeTruthy()

    unmount()
    renderWalkthrough()
    await goToStep(2)
    await screen.findByText('Step one')
    expect(screen.queryByText('First concept')).toBeNull()
  })

  it('keeps unsent AI question and reply drafts when step details are collapsed', async () => {
    globalThis.localStorage?.clear()
    const thread: AiThread = {
      id: 'thread-1',
      anchor: { type: 'step', step_id: 's1' },
      status: 'answered',
      messages: [
        { role: 'user', body: 'Why this change?', created_at: 1 },
        { role: 'ai', body: 'Because it fixes the flow.', created_at: 2 },
      ],
      created_at: 1,
      updated_at: 2,
    }
    renderWalkthrough({
      aiThreads: [thread],
      onAskAgentStep: vi.fn(),
      onReplyToThread: vi.fn(),
    })
    await goToStep(2)
    await screen.findByText('Step one')

    await fireEvent.click(screen.getByRole('button', { name: '+ Ask about this step' }))
    const question = screen.getByLabelText('Ask the AI author about this step') as HTMLTextAreaElement
    const reply = screen.getByLabelText('Reply to the AI author') as HTMLInputElement
    await fireEvent.input(question, { target: { value: 'Question draft' } })
    await fireEvent.input(reply, { target: { value: 'Reply draft' } })

    await fireEvent.click(screen.getByRole('button', { name: 'Collapse step details' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Expand step details' }))

    expect((screen.getByLabelText('Ask the AI author about this step') as HTMLTextAreaElement).value).toBe('Question draft')
    expect((screen.getByLabelText('Reply to the AI author') as HTMLInputElement).value).toBe('Reply draft')
  })
})

describe('WalkthroughTab stop generation', () => {
  // Load resolves to no walkthrough, so clicking Generate drives the optimistic
  // "generating" row rather than a cached one — this is the window where Stop
  // used to be a no-op.
  function makeGeneratingSync(): GithubSyncPrReviewClient {
    const sync = makeGithubSync()
    sync.getPrWalkthrough = vi.fn(async () => null)
    sync.startAgentWalkthrough = vi.fn(async () => ({ walkthrough_session_key: 'sess-1' }))
    return sync
  }

  it('stops with the session key returned by start, before any poll runs', async () => {
    const githubSync = makeGeneratingSync()
    renderWalkthrough({ githubSync })

    await fireEvent.click(await screen.findByRole('button', { name: /generate walkthrough/i }))
    await fireEvent.click(await screen.findByRole('button', { name: /^stop$/i }))

    expect(githubSync.abortAgentWalkthrough).toHaveBeenCalledWith({ walkthroughSessionKey: 'sess-1' })
  })

  it('returns to the Generate state after stopping, not an error screen', async () => {
    const githubSync = makeGeneratingSync()
    renderWalkthrough({ githubSync })

    await fireEvent.click(await screen.findByRole('button', { name: /generate walkthrough/i }))
    await fireEvent.click(await screen.findByRole('button', { name: /^stop$/i }))

    expect(githubSync.deletePrWalkthrough).toHaveBeenCalledWith({ reviewPrId: basePr.id, headSha: basePr.head_sha })
    expect(await screen.findByRole('button', { name: /generate walkthrough/i })).toBeTruthy()
    expect(screen.queryByText(/aborted/i)).toBeNull()
  })
})
