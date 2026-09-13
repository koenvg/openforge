import type { Meta, StoryObj } from '@storybook/svelte-vite'
import { expect, userEvent, within } from 'storybook/test'
import InlinePaletteControls from '../../shared/frames/InlinePaletteControls.svelte'

const meta = {
  title: 'Components/Inline palette controls',
  component: InlinePaletteControls,
  parameters: { docs: { description: { component: 'SDK-owned nonmodal listbox. PromptInput owns the production completion workflow stories.' } } },
} satisfies Meta<typeof InlinePaletteControls>
export default meta
type Story = StoryObj<typeof meta>

export const Populated: Story = {}
export const Empty: Story = { args: { mode: 'empty' } }
export const Loading: Story = { args: { mode: 'loading' } }
export const Overflow: Story = { args: { mode: 'overflow' } }
export const Narrow: Story = { globals: { viewport: { value: 'narrow', isRotated: false } } }
export const Filtered: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByRole('combobox'), 'tests')
    await expect(canvas.getAllByRole('option')).toHaveLength(1)
    await expect(canvas.getByRole('option')).toHaveTextContent('Run tests')
  },
}
export const KeyboardSelection: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const input = canvas.getByRole('combobox')
    await userEvent.click(input)
    await userEvent.keyboard('{ArrowDown}{Enter}')
    await expect(canvas.getByLabelText('Accepted suggestion')).toHaveTextContent('Run tests')
    await expect(canvas.queryByRole('listbox')).not.toBeInTheDocument()
    await expect(input).toHaveFocus()
    await userEvent.tab()
    await expect(canvas.getByRole('button', { name: 'Show suggestions' })).toHaveFocus()
  },
}
