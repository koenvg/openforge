import type { Meta, StoryObj } from '@storybook/svelte-vite'
import { expect, fn, within } from 'storybook/test'
import TaskDependencyActions from '../../../src/components/shared/tasks/TaskDependencyActions.svelte'

const meta = {
  title: 'Components/Task Dependency Actions', component: TaskDependencyActions,
  args: {
    taskId: 'KVG-42', dependencyId: 'KVG-41', confirming: false, disabled: false, removing: false,
    onRequest: fn(), onConfirm: fn(), onCancel: fn(),
  },
} satisfies Meta<typeof TaskDependencyActions>
export default meta
type Story = StoryObj<typeof meta>

export const Confirming: Story = {
  args: { confirming: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: /Confirm removing KVG-41 from KVG-42/ })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Cancel removing dependency KVG-41' })).toBeVisible()
  },
}
