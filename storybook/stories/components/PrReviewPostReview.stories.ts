import type { Meta, StoryObj } from '@storybook/svelte-vite'
import { expect, fn, within } from 'storybook/test'
import PostReviewDialog from '../../../plugins/github-sync/src/review/pr/PostReviewDialog.svelte'
import { activeReviewRequest } from '../../shared/fixtures/githubSyncReviewFixtures'

const meta = {
  title: 'Components/PR Review Post Review', component: PostReviewDialog,
  args: { pr: activeReviewRequest, onKeep: fn(), onRemove: fn() },
} satisfies Meta<typeof PostReviewDialog>
export default meta
type Story = StoryObj<typeof meta>

export const Submitted: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await expect(body.getByRole('dialog', { name: 'You reviewed this pull request' })).toBeVisible()
    await expect(body.getByRole('button', { name: 'Keep in my list' })).toBeVisible()
  },
}
