import type { Meta, StoryObj } from '@storybook/svelte-vite'
import { expect, fn, within } from 'storybook/test'
import type { PrOverviewComment, ReviewPullRequest } from '@openforge-app/plugin-sdk/domain'
import PrOverviewTab from '@openforge-app/pr-review-ui/PrOverviewTab.svelte'
import PrReviewPackageFrame from '../../shared/frames/PrReviewPackageFrame.svelte'

const pullRequest: ReviewPullRequest = {
  id: 42,
  number: 42,
  title: 'Keep review presentation semantic',
  body: 'The overview stays readable while the active theme changes.',
  state: 'open',
  draft: false,
  html_url: 'https://github.com/openforge/openforge/pull/42',
  user_login: 'alex',
  user_avatar_url: null,
  repo_owner: 'openforge',
  repo_name: 'openforge',
  head_ref: 'openforge/KVG-4866',
  base_ref: 'main',
  head_sha: 'abc123',
  additions: 28,
  deletions: 9,
  changed_files: 4,
  ci_status: 'success',
  mergeable: true,
  mergeable_state: 'clean',
  merged_at: null,
  created_at: 1_725_000_000,
  updated_at: 1_725_003_600,
  viewed_at: null,
  viewed_head_sha: null,
  labels: [],
}

const comments: PrOverviewComment[] = [
  {
    id: 1,
    author: 'reviewer',
    avatar_url: null,
    body: 'The warning and status colors follow the contributed theme.',
    file_path: null,
    line_number: null,
    created_at: '2024-08-29T10:00:00Z',
    comment_type: 'review_body',
  },
  {
    id: 2,
    author: 'maintainer',
    avatar_url: null,
    body: 'Please keep the inline comment shortcut readable.',
    file_path: 'packages/pr-review-ui/src/InlineCommentForm.svelte',
    line_number: 89,
    created_at: '2024-08-29T10:05:00Z',
    comment_type: 'review_comment',
  },
]

const meta = {
  title: 'Components/PR Review/Overview',
  component: PrOverviewTab,
  decorators: [() => ({ Component: PrReviewPackageFrame })],
  args: {
    pr: pullRequest,
    comments,
    onCommentsChange: fn(),
    loadComments: fn().mockResolvedValue(comments),
    onOpenUrl: fn(),
  },
} satisfies Meta<typeof PrOverviewTab>

export default meta
type Story = StoryObj<typeof meta>

export const Populated: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.findByText('submitted a review')).resolves.toBeVisible()
    await expect(canvas.findByText('Please keep the inline comment shortcut readable.')).resolves.toBeVisible()
  },
}
