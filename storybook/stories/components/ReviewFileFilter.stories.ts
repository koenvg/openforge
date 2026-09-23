import type { Meta, StoryObj } from '@storybook/svelte-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import NonApplicationFilesToggle from '../../../packages/pr-review-ui/src/NonApplicationFilesToggle.svelte'

const onToggle = fn()
const meta = {
  title: 'Components/Review File Filter', component: NonApplicationFilesToggle,
  args: { checked: false, hiddenCount: 3, onToggle },
} satisfies Meta<typeof NonApplicationFilesToggle>
export default meta
type Story = StoryObj<typeof meta>

export const HiddenFiles: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByText(/Also include non-application files/))
    await expect(onToggle).toHaveBeenCalledWith(true)
  },
}
