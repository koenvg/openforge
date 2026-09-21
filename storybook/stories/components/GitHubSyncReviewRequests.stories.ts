import type { Meta, StoryObj } from '@storybook/svelte-vite'
import { expect, within } from 'storybook/test'
import WorkspaceComponentFrame from '../../shared/frames/WorkspaceComponentFrame.svelte'
import GitHubSyncReviewRequestsFrame from '../../shared/frames/GitHubSyncReviewRequestsFrame.svelte'
import {
  activeReviewRequest,
  closedReviewRequest,
  mergedReviewRequest,
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
    await expect(canvas.getByLabelText('2 active review requests')).toHaveTextContent('2')
    await expect(canvas.getAllByLabelText('Unread review request')).toHaveLength(1)
    await expect(canvas.getByText(activeReviewRequest.title)).toBeVisible()

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
    await expect(canvas.getByRole('button', { name: 'Finished (2)' })).toHaveAttribute('aria-expanded', 'true')
  },
}
