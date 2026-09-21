import type { Meta, StoryObj } from '@storybook/svelte-vite'
import { expect, userEvent, within } from 'storybook/test'
import WorkspaceComponentFrame from '../../shared/frames/WorkspaceComponentFrame.svelte'
import GitHubSyncReviewRequestsFrame from '../../shared/frames/GitHubSyncReviewRequestsFrame.svelte'
import {
  activeReviewRequest,
  closedReviewRequest,
  mergedReviewRequest,
  reviewedReviewRequest,
  updatedSinceReviewRequest,
} from '../../shared/fixtures/githubSyncReviewFixtures'

const meta = {
  title: 'Components/GitHub Sync/Review Requests',
  component: GitHubSyncReviewRequestsFrame,
  decorators: [() => ({ Component: WorkspaceComponentFrame })],
} satisfies Meta<typeof GitHubSyncReviewRequestsFrame>
export default meta

type Story = StoryObj<typeof meta>

export const ActiveAndFinished: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByLabelText('2 review requests needing review')).toHaveTextContent('2')
    await expect(canvas.getAllByLabelText('Unread review request')).toHaveLength(1)
    await expect(canvas.getByText(activeReviewRequest.title)).toBeVisible()
    await expect(canvas.getByText(updatedSinceReviewRequest.title)).toBeVisible()
    await expect(canvas.getByText('Review needed')).toBeVisible()
    await expect(canvas.getByText('Updated since review')).toBeVisible()

    const reviewedToggle = canvas.getByRole('button', { name: 'Reviewed (1)' })
    await expect(reviewedToggle).toHaveAttribute('aria-expanded', 'false')
    await expect(canvas.queryByText(reviewedReviewRequest.title)).not.toBeInTheDocument()
    await userEvent.click(reviewedToggle)
    await expect(canvas.getByText(reviewedReviewRequest.title)).toBeVisible()
    await expect(canvas.getByText('Reviewed')).toBeVisible()

    const finishedToggle = canvas.getByRole('button', { name: 'Finished (2)' })
    await expect(finishedToggle).toHaveAttribute('aria-expanded', 'true')
    const mergedTitle = canvas.getByText(mergedReviewRequest.title)
    const closedTitle = canvas.getByText(closedReviewRequest.title)
    await expect(mergedTitle).toBeVisible()
    await expect(closedTitle).toBeVisible()
    await expect(mergedTitle.closest('.vim-focus')).toBeNull()
    await expect(closedTitle.closest('.vim-focus')).toBeNull()
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    await expect(canvas.getByText(activeReviewRequest.title)).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Reviewed (1)' })).toHaveAttribute('aria-expanded', 'true')
    await expect(canvas.getByRole('button', { name: 'Finished (2)' })).toHaveAttribute('aria-expanded', 'true')
  },
}
