import type { Meta, StoryObj } from '@storybook/svelte-vite'
import { expect, within } from 'storybook/test'
import RichMarkdownDiffVisualHarness from '../../../packages/pr-review-ui/src/visual/RichMarkdownDiffVisualHarness.svelte'

const meta = {
  title: 'Components/Rich Markdown Review', component: RichMarkdownDiffVisualHarness,
  args: {
    filename: 'docs/review.md', surface: 'rich-diff' as const,
    content: '# Review notes\n\nKeep the review checklist close to the code.\n\n- Verify the new behavior\n- Check accessible controls',
  },
} satisfies Meta<typeof RichMarkdownDiffVisualHarness>
export default meta
type Story = StoryObj<typeof meta>

export const RichDiff: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('region', { name: 'Rich diff for docs/review.md' })).toBeVisible()
    await expect(canvas.getByText('Review notes')).toBeVisible()
  },
}
