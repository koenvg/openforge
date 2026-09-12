import type { Meta, StoryObj } from '@storybook/svelte-vite'
import { expect, fn, userEvent, within, waitFor } from 'storybook/test'
import PaletteControls from '../../shared/frames/PaletteControls.svelte'

const meta = {
  title: 'Components/Palette controls', component: PaletteControls,
  args: { onSelect: fn(), onClose: fn() },
  beforeEach: (context) => {
    delete context.canvasElement.ownerDocument.body.dataset.navigationReady
    return () => { delete context.canvasElement.ownerDocument.body.dataset.navigationReady }
  },
  play: async ({ canvasElement, id }) => {
    await within(canvasElement.ownerDocument.body).findByRole('dialog', { name: 'Catalog palette controls' })
    canvasElement.ownerDocument.body.dataset.navigationReady = id
  },
} satisfies Meta<typeof PaletteControls>
export default meta
type Story = StoryObj<typeof meta>

export const Populated: Story = {}
export const Empty: Story = { args: { variant: 'empty' } }
export const Loading: Story = { args: { variant: 'loading' } }
export const Overflow: Story = { args: { variant: 'overflow' } }
export const Grouped: Story = { args: { variant: 'grouped' } }
export const Confirmation: Story = { args: { variant: 'confirmation' } }
export const ThemeOverride: Story = { args: { variant: 'themed' } }
export const Narrow: Story = { globals: { viewport: { value: 'component', isRotated: false } } }
export const KeyboardSelection: Story = {
  play: async ({ canvasElement, args, id }) => {
    const body = within(canvasElement.ownerDocument.body)
    for (let attempt = 0; attempt < 2; attempt++) {
      const input = await body.findByPlaceholderText('Filter catalog entries...')
      await userEvent.click(input)
      await userEvent.keyboard('{ArrowUp}')
      await expect(body.getByRole('option', { selected: true })).toHaveTextContent('Files')
      await userEvent.type(input, 'files')
      await expect(body.getAllByRole('option')).toHaveLength(1)
      await userEvent.keyboard('{Enter}')
      await expect(args.onSelect).toHaveBeenCalledWith('Files')
      await waitFor(() => expect(getComputedStyle(body.getByRole('button', { name: 'Reopen controls' })).pointerEvents).not.toBe('none'))
      await userEvent.click(body.getByRole('button', { name: 'Reopen controls' }))
      await expect(await body.findByPlaceholderText('Filter catalog entries...')).toHaveValue('')
      await expect(body.getAllByRole('option')).toHaveLength(3)
    }
    canvasElement.ownerDocument.body.dataset.navigationReady = id
  },
}
