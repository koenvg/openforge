import type { Meta, StoryObj } from '@storybook/svelte-vite'
import { expect, userEvent, within } from 'storybook/test'
import Fixture from '../../shared/ThemeFixture.svelte'
import PageFrame from '../../shared/frames/PageFrame.svelte'

const meta = {
  title: 'Application/Shell',
  component: Fixture,
  decorators: [(_Story, context) => ({ Component: PageFrame, props: context.parameters.hostFrame ?? {} })],
} satisfies Meta<typeof Fixture>
export default meta

export const Expanded: StoryObj<typeof meta> = {}
export const Collapsed: StoryObj<typeof meta> = {
  parameters: { hostFrame: { initiallyCollapsed: true } },
}
export const Zen: StoryObj<typeof meta> = {
  parameters: { hostFrame: { zen: true } },
}
export const GlobalView: StoryObj<typeof meta> = {
  parameters: { hostFrame: { currentView: 'global_settings', showProjectNavigation: false } },
}
export const ToggleSidebar: StoryObj<typeof meta> = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Collapse sidebar' }))
    await expect(canvas.getByRole('button', { name: 'Expand sidebar' })).toBeVisible()
  },
}
