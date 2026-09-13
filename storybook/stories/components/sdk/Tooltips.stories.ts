import type { Meta, StoryObj } from '@storybook/svelte-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import Tooltips from './Tooltips.svelte'

const meta = {
  title: 'Components/Plugin SDK/Tooltips',
  component: Tooltips,
} satisfies Meta<typeof Tooltips>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.hover(canvas.getByRole('button', { name: 'top action' }))
    await waitFor(() => expect(within(canvasElement.ownerDocument.body).getByRole('tooltip', { name: 'top action' })).toBeVisible())
  },
}
export const Edge: Story = {
  args: { state: 'edge' },
  play: async ({ canvasElement }) => {
    await userEvent.hover(within(canvasElement).getByRole('button'))
    await waitFor(() => expect(within(canvasElement.ownerDocument.body).getByRole('tooltip')).toBeVisible())
  },
}
export const Unavailable: Story = { args: { state: 'unavailable' } }
export const OptOut: Story = {
  args: { state: 'opt-out' },
  play: async ({ canvasElement }) => {
    await userEvent.tab()
    within(canvasElement).getByRole('button').focus()
    await expect(within(canvasElement.ownerDocument.body).queryByRole('tooltip')).toBeNull()
  },
}
export const Dialog: Story = {
  args: { state: 'dialog' },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Open dialog' }))
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.hover(await body.findByRole('button', { name: 'Dialog action' }))
    await waitFor(() => expect(body.getByRole('tooltip', { name: 'Dialog action' })).toBeVisible())
  },
}
export const Menu: Story = {
  args: { state: 'menu' },
  play: async ({ canvasElement }) => {
    await userEvent.hover(within(canvasElement).getByRole('button', { name: 'More actions' }))
    await waitFor(() => expect(within(canvasElement.ownerDocument.body).getByRole('tooltip', { name: 'More actions' })).toBeVisible())
  },
}
