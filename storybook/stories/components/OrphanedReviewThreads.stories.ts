import type { Meta, StoryObj } from '@storybook/svelte-vite'
import { expect, fn, within } from 'storybook/test'
import OrphanedReviewThreads from '../../../packages/pr-review-ui/src/OrphanedReviewThreads.svelte'
import { orphanedReviewThreads } from '../../shared/fixtures/reviewThreadFixtures'

const meta = {
  title: 'Components/Orphaned Review Threads', component: OrphanedReviewThreads,
  args: { threads: orphanedReviewThreads, onReplyToThread: fn(), onSetThreadStatus: fn() },
} satisfies Meta<typeof OrphanedReviewThreads>
export default meta
type Story = StoryObj<typeof meta>

export const Detached: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('region', { name: 'Threads not in this diff' })).toBeVisible()
    await expect(canvas.getByText('Line is not in this diff')).toBeVisible()
  },
}
