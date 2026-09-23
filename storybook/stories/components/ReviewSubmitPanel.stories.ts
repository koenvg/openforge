import type { Meta, StoryObj } from '@storybook/svelte-vite'
import { expect, fn, within } from 'storybook/test'
import ReviewSubmitPanel from '../../../packages/pr-review-ui/src/ReviewSubmitPanel.svelte'

const meta = {
  title: 'Components/Review Submit Panel',
  component: ReviewSubmitPanel,
  args: {
    repoOwner: 'openforge', repoName: 'openforge', prNumber: 42, commitId: 'abc123',
    onPendingCommentsChange: fn(), onSubmitReview: fn(async () => undefined),
  },
} satisfies Meta<typeof ReviewSubmitPanel>
export default meta
type Story = StoryObj<typeof meta>

export const Ready: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.findByRole('heading', { name: 'Submit Review' })).resolves.toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Approve' })).toBeEnabled()
  },
}
