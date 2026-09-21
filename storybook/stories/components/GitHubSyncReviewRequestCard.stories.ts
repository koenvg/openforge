import type { Meta, StoryObj } from '@storybook/svelte-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import ReviewPrCard from '@openforge-app/pr-review-ui/ReviewPrCard.svelte'
import GitHubSyncCardFrame from '../../shared/frames/GitHubSyncCardFrame.svelte'
import {
  activeReviewRequest,
  closedReviewRequest,
  mergedReviewRequest,
  reviewedReviewRequest,
  updatedSinceReviewRequest,
  viewedReviewRequest,
} from '../../shared/fixtures/githubSyncReviewFixtures'

const meta = {
  title: 'Components/GitHub Sync/Review Request Card',
  component: ReviewPrCard,
  decorators: [() => ({ Component: GitHubSyncCardFrame })],
  args: {
    pr: activeReviewRequest,
    selected: false,
    onClick: fn(),
    onMarkUnread: fn(),
    onMarkReviewed: fn(),
    onMarkNeedsReview: fn(),
    onRemove: fn(),
  },
} satisfies Meta<typeof ReviewPrCard>
export default meta

type Story = StoryObj<typeof meta>

export const Active: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByLabelText('Unread review request')).toBeVisible()
    await expect(canvas.getByText('CI Passed')).toBeVisible()
    await expect(canvas.getByText('Review needed')).toBeVisible()
    await expect(canvas.queryByText('Merged')).not.toBeInTheDocument()
    await userEvent.click(canvas.getByRole('button', { name: /Keep review requests easy to scan/ }))
    await expect(args.onClick).toHaveBeenCalledTimes(1)
  },
}

export const UpdatedSinceReview: Story = {
  args: { pr: updatedSinceReviewRequest },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Updated since review')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Mark reviewed' })).toBeVisible()
  },
}

export const Reviewed: Story = {
  args: { pr: reviewedReviewRequest },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Reviewed')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Mark as needs review' })).toBeVisible()
  },
}

export const Viewed: Story = {
  args: { pr: viewedReviewRequest },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: 'Mark as unread' })).toBeInTheDocument()
    await expect(canvas.queryByLabelText('Unread review request')).not.toBeInTheDocument()
    await expect(canvas.getByText(viewedReviewRequest.title)).toBeVisible()
  },
}

export const Merged: Story = {
  args: { pr: mergedReviewRequest },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Merged')).toBeVisible()
    await expect(canvas.queryByText('CI Failed')).not.toBeInTheDocument()
  },
}

export const Closed: Story = {
  args: { pr: closedReviewRequest },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Closed')).toBeVisible()
    await expect(canvas.queryByText('Merge Conflict')).not.toBeInTheDocument()
  },
}
