import type { Meta, StoryObj } from '@storybook/svelte-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import InlineCommentThread from '../../../packages/pr-review-ui/src/InlineCommentThread.svelte'
import { reviewCommentThread } from '../../shared/fixtures/reviewThreadFixtures'

const meta = {
  title: 'Components/Review Comment Thread', component: InlineCommentThread,
  args: {
    data: reviewCommentThread,
    pendingComments: [{ path: 'src/greet.ts', line: 12, side: 'RIGHT' as const, body: 'Pending reviewer note' }],
    onPendingCommentsChange: fn(),
    onReplyToThread: fn(),
    onSetThreadStatus: fn(),
    onReplyToExistingComment: fn(async () => undefined),
    onAddReplyToReview: fn(),
  },
} satisfies Meta<typeof InlineCommentThread>
export default meta
type Story = StoryObj<typeof meta>

export const Conversation: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Check the empty name before trimming.')).toBeVisible()
    await expect(canvas.getByRole('textbox', { name: 'Reply to the review thread' })).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Reply to this comment on GitHub' }))
    await expect(canvas.getByRole('textbox', { name: 'Reply to this comment' })).toBeVisible()
  },
}
