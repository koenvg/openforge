import type { Meta, StoryObj } from '@storybook/svelte-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import TaskStartFeedback from '../../../src/components/task-detail/TaskStartFeedback.svelte'
import { activeSessions, startingTasks, taskStartErrors } from '../../../src/lib/stores'
import { createStoryStoreAdapter as seed } from '../../shared/environment/storyStoreAdapter'

const onRunAction = fn()
const meta = {
  title: 'Components/Task Start Feedback', component: TaskStartFeedback,
  args: { taskId: 'T-42', onRunAction },
  parameters: { openforge: { adapters: () => [
    seed(activeSessions, new Map()),
    seed(startingTasks, new Set()),
    seed(taskStartErrors, new Map([['T-42', 'The task could not start because the agent is unavailable.']])),
  ] } },
} satisfies Meta<typeof TaskStartFeedback>
export default meta
type Story = StoryObj<typeof meta>

export const Failed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('alert')).toHaveTextContent('The task could not start')
    await userEvent.click(canvas.getByRole('button', { name: 'Retry start' }))
    await expect(onRunAction).toHaveBeenCalledWith({ taskId: 'T-42', actionPrompt: '' })
  },
}
