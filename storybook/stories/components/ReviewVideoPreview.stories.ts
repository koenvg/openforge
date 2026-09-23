import type { Meta, StoryObj } from '@storybook/svelte-vite'
import { expect, within } from 'storybook/test'
import ReviewVideoPreview from '../../../packages/pr-review-ui/src/ReviewVideoPreview.svelte'

const meta = {
  title: 'Components/Review Video Preview', component: ReviewVideoPreview,
  args: { item: {
    kind: 'video' as const, filename: 'review-demo.webm', label: 'Demo recording',
    alt: 'Review demo video', src: 'data:video/webm;base64,',
  } },
} satisfies Meta<typeof ReviewVideoPreview>
export default meta
type Story = StoryObj<typeof meta>

export const Unavailable: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByLabelText('Review demo video')).toBeVisible()
    await expect(canvas.findByRole('alert')).resolves.toHaveTextContent('This video cannot be played by this browser.')
  },
}
