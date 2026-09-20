import type { Meta, StoryObj } from '@storybook/svelte-vite'
import { SplitSide } from '@git-diff-view/svelte'
import { expect, fn, userEvent, within } from 'storybook/test'
import InlineCommentForm from '../../../packages/pr-review-ui/src/InlineCommentForm.svelte'
import PrReviewPackageFrame from '../../shared/frames/PrReviewPackageFrame.svelte'

const meta = {
  title: 'Components/PR Review/Inline Comment Form',
  component: InlineCommentForm,
  decorators: [() => ({ Component: PrReviewPackageFrame })],
  args: {
    filename: 'src/greet.ts',
    lineNumber: 12,
    side: SplitSide.new,
    text: 'Please cover the empty-name case.',
    onTextChange: fn(),
    onSubmit: fn(),
    onCancel: fn(),
    onCreateThread: fn(),
    onCommentNow: fn(),
  },
} satisfies Meta<typeof InlineCommentForm>

export default meta
type Story = StoryObj<typeof meta>

export const Populated: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const textbox = canvas.getByRole('textbox', { name: 'Inline review comment for src/greet.ts line 12' })
    const hints = canvasElement.querySelectorAll('kbd')
    await expect(hints).toHaveLength(2)
    await expect([...hints].every(hint => hint.classList.contains('key-hint'))).toBe(true)
    await userEvent.click(textbox)
    await userEvent.keyboard('{Control>}{Enter}{/Control}')
    await expect(args.onSubmit).toHaveBeenCalledTimes(1)
  },
}
