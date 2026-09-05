import type { Meta, StoryObj } from '@storybook/svelte-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import TaskDetailPage from '../../shared/frames/TaskDetailPage.svelte'
import { taskDetailScenario, type TaskDetailScenario } from '../../shared/fixtures/taskDetailScenario'
import { getStoryScenario } from '../../shared/storyEnvironmentPreview'

const meta = {
  title: 'Pages/Task Detail',
  component: TaskDetailPage,
  args: { onRunAction: fn(), onOpenTask: fn() },
} satisfies Meta<typeof TaskDetailPage>
export default meta

type Story = StoryObj<typeof meta>
function scenario(kind: TaskDetailScenario): Story {
  const { task, hostLifecycle, environment } = taskDetailScenario(kind)
  return {
    args: { task, hostLifecycle },
    parameters: { openforge: environment },
    play: async (context) => {
      await waitFor(() => expect(context.canvasElement.querySelector('.xterm-screen')).not.toBeNull())
      await waitFor(() => expect(getStoryScenario(context).desktop.calls.some(call => call.command === 'get_pty_buffer')).toBe(true))
    },
  }
}

export const Backlog: Story = {
  ...scenario('backlog'),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).findByText('No active agent session')).resolves.toBeVisible()
  },
}
export const Active: Story = scenario('active')
export const Waiting: Story = {
  ...scenario('waiting'),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).findByText('Should an empty name return a default greeting or a validation error?')).resolves.toBeVisible()
  },
}
export const Failed: Story = scenario('failed')
export const Completed: Story = scenario('completed')
export const Dependency: Story = {
  ...scenario('dependency'),
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByText('Define the greeting API'))
    await expect(args.onOpenTask).toHaveBeenCalledWith('T-41', 'project-1')
  },
}
const terminalScenario = scenario('terminal')
export const Terminal: Story = {
  ...terminalScenario,
  play: async (context) => {
    await terminalScenario.play!(context)
    const input = context.canvasElement.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea')!
    await userEvent.type(input, 'pwd{Enter}')
    await waitFor(() => expect(getStoryScenario(context).desktop.calls
      .filter(call => call.command === 'pty_write')
      .map(call => (call.payload as { data: string }).data).join('')).toContain('pwd\r'))
  },
}
export const LongContent: Story = scenario('long-content')
export const Review: Story = {
  ...scenario('review'),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.findByText('greet.ts')).resolves.toBeVisible()
    const tabs = within(canvas.getByRole('navigation', { name: 'Task workbench tabs' }))
    await userEvent.click(tabs.getByRole('button', { name: /^agent$/i }))
    await expect(canvas.getByRole('main', { name: 'Agent terminal workbench' })).toBeVisible()
    await userEvent.click(tabs.getByRole('button', { name: /^review$/i }))
    await expect(canvas.getByText('greet.ts')).toBeVisible()
  },
}
