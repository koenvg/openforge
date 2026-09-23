import type { Meta, StoryObj } from '@storybook/svelte-vite'
import { expect, within } from 'storybook/test'
import InteractionOverlayVisualHarness from '../../../src/components/shared/ui/visual/InteractionOverlayVisualHarness.svelte'

const meta = {
  title: 'Components/Interaction Overlay', component: InteractionOverlayVisualHarness,
} satisfies Meta<typeof InteractionOverlayVisualHarness>
export default meta
type Story = StoryObj<typeof meta>

export const ScrollableSettings: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await expect(body.getByRole('dialog', { name: 'Scrollable project settings' })).toBeVisible()
    await expect(body.getByRole('heading', { name: 'Project settings' })).toBeVisible()
  },
}
