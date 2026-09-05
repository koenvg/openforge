import type { Meta, StoryObj } from '@storybook/svelte-vite'
import { expect, userEvent, within } from 'storybook/test'
import Fixture from '../../shared/StoryEnvironmentFixture.svelte'

const meta = {
  title: 'Infrastructure/Story environment',
  component: Fixture,
  parameters: { openforge: { desktop: { config: { 'storybook-draft': 'original' } } } },
} satisfies Meta<typeof Fixture>
export default meta

export const Editable: StoryObj<typeof meta> = {}
export const Edited: StoryObj<typeof meta> = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.findByText('original')).resolves.toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Edit fixture' }))
    await expect(canvas.findByText('edited')).resolves.toBeVisible()
  },
}
