import type { Meta, StoryObj } from '@storybook/svelte-vite'
import { expect, fn, within } from 'storybook/test'
import TaskContextMenu from '../../../src/components/shared/tasks/TaskContextMenu.svelte'
import { clearActiveTasks, installActiveTasks } from '../../../src/lib/tasksState'
import { activeProjectId, completingTasks } from '../../../src/lib/stores'
import { enabledPluginIds } from '../../../src/lib/plugin/pluginStore'
import { createStoryStoreAdapter as seed } from '../../shared/environment/storyStoreAdapter'
import { createTask } from '../../shared/fixtures/appFixtures'

const meta = {
  title: 'Components/Task Context Menu', component: TaskContextMenu,
  args: { visible: true, x: 80, y: 80, taskId: 'T-42', onClose: fn(), onStart: fn(), onEdit: fn() },
  parameters: { openforge: { adapters: () => [
    {
      install: () => installActiveTasks('project-1', { tasks: [createTask({ status: 'backlog' })], related: [] }),
      reset: () => installActiveTasks('project-1', { tasks: [createTask({ status: 'backlog' })], related: [] }),
      dispose: () => clearActiveTasks('project-1'),
    },
    seed(activeProjectId, 'project-1'),
    seed(completingTasks, new Set()),
    seed(enabledPluginIds, new Set()),
  ] } },
} satisfies Meta<typeof TaskContextMenu>
export default meta
type Story = StoryObj<typeof meta>

export const Backlog: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await expect(body.getByRole('menuitem', { name: 'Start Task' })).toBeVisible()
    await expect(body.getByRole('menuitem', { name: 'Edit Task' })).toBeVisible()
  },
}
