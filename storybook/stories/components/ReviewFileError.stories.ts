import type { Meta, StoryObj } from '@storybook/svelte-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import FileContentsError from '../../../packages/pr-review-ui/src/FileContentsError.svelte'

const onRetry = fn()
const meta = {
  title: 'Components/Review File Error', component: FileContentsError,
  args: { filename: 'src/greet.ts', error: 'The GitHub file content request timed out.', onRetry },
} satisfies Meta<typeof FileContentsError>
export default meta
type Story = StoryObj<typeof meta>

export const Failed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Retry loading src/greet.ts' }))
    await expect(onRetry).toHaveBeenCalled()
  },
}
