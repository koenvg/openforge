import type { Meta, StoryObj } from '@storybook/svelte-vite'
import { expect, userEvent, within } from 'storybook/test'
import LegacyPaletteControls from '../../shared/frames/LegacyPaletteControls.svelte'

const meta = {
  title: 'Components/Legacy palette controls',
  component: LegacyPaletteControls,
  parameters: { docs: { description: { component: 'Retained for file quick-open and inline prompt completion until KVG-4988.' } } },
} satisfies Meta<typeof LegacyPaletteControls>
export default meta
type Story = StoryObj<typeof meta>

export const Populated: Story = {}
export const Filtered: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.type(await body.findByRole('combobox'), 'files')
    await expect(body.getAllByRole('option')).toHaveLength(1)
    await expect(body.getByRole('option')).toHaveTextContent('Files')
  },
}
