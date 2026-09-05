import type { Meta, StoryObj } from '@storybook/svelte-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import PluginViewState from '../../../packages/plugin-sdk/src/ui/PluginViewState.svelte'
import FocusBoard from '../../../src/components/focus-board/FocusBoard.svelte'
import ContextMenuItem from '../../../src/components/shared/ui/ContextMenuItem.svelte'
import PageFrame from '../../shared/frames/PageFrame.svelte'
import TaskPaneFrame from '../../shared/frames/TaskPaneFrame.svelte'
import SettingsFrame from '../../shared/frames/SettingsFrame.svelte'
import RowActionFrame from '../../shared/frames/RowActionFrame.svelte'
import StatusFrame from '../../shared/frames/StatusFrame.svelte'
import { createTask } from '../../shared/fixtures/appFixtures'

const task = createTask({ status: 'backlog' })
const meta = {
  title: 'Infrastructure/Host frames',
  component: PluginViewState,
  args: { empty: true, emptyTitle: 'No items' },
  decorators: [() => ({ Component: PageFrame })],
} satisfies Meta<typeof PluginViewState>
export default meta

export const HostPage: StoryObj<typeof meta> = {
  render: () => ({ Component: FocusBoard, props: {
    projectId: null,
    projectName: 'OpenForge',
    tasks: [], activeSessions: new Map(), ticketPrs: new Map(),
    onOpenTask: fn(), onRunAction: fn(), onNewTask: fn(),
  } }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.findByRole('button', { name: /backlog/i })).resolves.toBeVisible()
  },
}
export const PluginPage: StoryObj<typeof meta> = {
  args: { empty: false, error: 'Plugin content unavailable', onRetry: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Retry' }))
    await expect(args.onRetry).toHaveBeenCalledOnce()
  },
}
export const TaskPane: StoryObj<typeof meta> = {
  decorators: [() => ({ Component: TaskPaneFrame, props: { tab: {
    pluginId: 'com.openforge.storybook', contributionId: 'example-tab',
    namespacedId: 'com.openforge.storybook:example-tab', title: 'Example',
    icon: 'sparkles', order: 50, requiresWorkspace: false,
  } } })],
}
export const Settings: StoryObj<typeof meta> = {
  decorators: [() => ({ Component: SettingsFrame, props: { title: 'Example settings' } })],
}
export const RowAction: StoryObj<typeof meta> = {
  render: () => ({ Component: ContextMenuItem, props: { label: 'Example row action', onclick: fn() } }),
  decorators: [() => ({ Component: RowActionFrame, props: { task } })],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.findByRole('menuitem', { name: 'Example row action' })).resolves.toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect(canvas.queryByRole('menuitem')).not.toBeInTheDocument()
    await userEvent.click(canvas.getByRole('button', { name: /Implement Storybook coverage/ }))
    await expect(canvas.findByRole('menuitem', { name: 'Example row action' })).resolves.toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect(canvas.queryByRole('menuitem')).not.toBeInTheDocument()
  },
}
export const Status: StoryObj<typeof meta> = {
  decorators: [() => ({ Component: StatusFrame, props: { task } })],
}
