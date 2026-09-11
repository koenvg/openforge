import type { Meta, StoryObj } from '@storybook/svelte-vite'
import { expect, fn, within } from 'storybook/test'
import type { PrComment, PullRequestInfo } from '@openforge-app/plugin-sdk/domain'
import PullRequestCard from '../../../plugins/github-sync/src/task/PullRequestCard.svelte'
import { createPullRequest } from '../../shared/fixtures/appFixtures'
import GitHubSyncCardFrame from '../../shared/frames/GitHubSyncCardFrame.svelte'

const meta = {
  title: 'Components/GitHub Sync/Pull Request Card',
  component: PullRequestCard,
  decorators: [() => ({ Component: GitHubSyncCardFrame })],
  args: {
    sectionKey: 'storybook:github-sync:pull-request-card',
    comments: [],
    feedback: undefined,
    pendingPrId: null,
    taskActionPending: false,
    resolveRemoteMedia: undefined,
    onOpenUrl: fn(),
    onMarkAddressed: fn(),
    onRequestAction: fn(),
  },
} satisfies Meta<typeof PullRequestCard>
export default meta

type Story = StoryObj<typeof meta>

type CheckRun = {
  id: number
  name: string
  status: string
  conclusion: string | null
  html_url: string
}

function checkRun(id: number, name: string, status: string, conclusion: string | null): CheckRun {
  return {
    id,
    name,
    status,
    conclusion,
    html_url: `https://github.com/openforge/openforge/actions/runs/${id}`,
  }
}

const passingChecks = Array.from({ length: 11 }, (_, index) =>
  checkRun(index + 10, `Passing check ${index + 1}`, 'completed', 'success'))

const failedPr = createPullRequest({
  title: 'fix(cli): preserve shell profiles on read errors',
  ci_status: 'failure',
  ci_check_runs: JSON.stringify([
    checkRun(1, 'Live Electron Terminal Invariants', 'completed', 'failure'),
    ...passingChecks,
  ]),
  mergeable: false,
  mergeable_state: 'unstable',
  review_status: 'approved',
})

const runningPr = createPullRequest({
  title: 'ci: validate terminal startup on supported shells',
  ci_status: 'pending',
  ci_check_runs: JSON.stringify([
    checkRun(2, 'Live Electron Terminal Invariants', 'in_progress', null),
    ...passingChecks,
  ]),
  mergeable: null,
  mergeable_state: 'clean',
  review_status: 'approved',
})

const passingPr = createPullRequest({
  title: 'docs: clarify plugin authoring workflow',
  ci_status: 'success',
  ci_check_runs: JSON.stringify(passingChecks),
  mergeable: true,
  mergeable_state: 'clean',
  review_status: 'approved',
})

const commentedPr: PullRequestInfo = {
  ...failedPr,
  id: 43,
  pr_number: 43,
  title: 'fix(cli): preserve shell profiles with review feedback',
  url: 'https://github.com/openforge/openforge/pull/43',
  unaddressed_comment_count: 1,
}

const reviewComment: PrComment = {
  id: 101,
  pr_id: commentedPr.id,
  author: 'octocat',
  body: 'Please keep this shell profile change scoped to the CLI path.',
  comment_type: 'review_comment',
  file_path: 'src/cli/profile.ts',
  line_number: 42,
  addressed: 0,
  outdated: 0,
  created_at: 1767346000,
}

function card(pr: PullRequestInfo, sectionKey: string): Story {
  return { args: { pr, sectionKey } }
}

export const Failed: Story = {
  ...card(failedPr, 'storybook:github-sync:pull-request-card:failed'),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const checks = await canvas.findByLabelText('Pipeline checks')
    await expect(canvas.getByText('Failing').closest('[data-status-badge]')).toHaveAttribute('data-status', 'failed')
    await expect(within(checks).getByRole('img', { name: 'Failed' })).toHaveAttribute('data-status', 'failed')
    await expect(within(checks).getByText('11 passing')).toBeVisible()
  },
}

export const Running: Story = {
  ...card(runningPr, 'storybook:github-sync:pull-request-card:running'),
  play: async ({ canvasElement }) => {
    const checks = within(await within(canvasElement).findByLabelText('Pipeline checks'))
    await expect(checks.getByRole('img', { name: 'Running' })).toHaveAttribute('data-status', 'in-progress')
  },
}

export const Passing: Story = {
  ...card(passingPr, 'storybook:github-sync:pull-request-card:passing'),
  play: async ({ canvasElement }) => {
    const signals = within(await within(canvasElement).findByLabelText('Pull request signals'))
    const checks = within(await within(canvasElement).findByLabelText('Pipeline checks'))
    await expect(signals.getByText('Ready to Merge').closest('[data-status-badge]')).toHaveAttribute('data-status', 'success')
    await expect(checks.getByRole('img', { name: 'Passed' })).toHaveAttribute('data-status', 'success')
    await expect(checks.getByText('11 passing')).toBeVisible()
  },
}

export const WithComment: Story = {
  ...card(commentedPr, 'storybook:github-sync:pull-request-card:with-comment'),
  args: {
    pr: commentedPr,
    sectionKey: 'storybook:github-sync:pull-request-card:with-comment',
    comments: [reviewComment],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('1 comment')).toBeVisible()
    await expect(canvas.getByText('1 comment').closest('span')).toHaveClass('github-sync-signal-count')
    await expect(canvas.getByText('Failing').closest('[data-status-badge]')).toHaveClass('github-sync-signal-status')
    await expect(canvas.getByText('Approved').closest('[data-status-badge]')).toHaveAttribute('data-status', 'success')
    await expect(canvas.getByText('Approved').closest('[data-status-badge]')).toHaveClass('github-sync-signal-status')
    await expect(canvas.getByText('open').closest('[data-status-badge]')).toHaveClass('github-sync-state-chip')
    await expect(canvas.getByText('open').closest('[data-status-badge]')).toHaveAttribute('data-status', 'success')
    await expect(canvas.queryByLabelText('Pull request merge status')).not.toBeInTheDocument()
    const comments = await canvas.findByLabelText('Unaddressed comments')
    await expect(within(comments).getByRole('article', { name: 'Comment by octocat' })).toBeVisible()
    await expect(within(comments).getByText(reviewComment.body)).toBeVisible()
    await expect(within(comments).getByRole('button', { name: '✓ Mark addressed' })).toBeVisible()
  },
}

export const Collapsed: Story = {
  ...card(failedPr, 'storybook:github-sync:pull-request-card:collapsed'),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const toggle = await canvas.findByRole('button', { name: `#${failedPr.pr_number} ${failedPr.title}` })
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(canvas.queryByLabelText('Pipeline checks')).not.toBeInTheDocument()
  },
}
