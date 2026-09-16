import type { Meta, StoryObj } from '@storybook/svelte-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import TaskDetailPage from '../../shared/frames/TaskDetailPage.svelte'
import { taskDetailScenario, type SelfReviewScenario } from '../../shared/fixtures/taskDetailScenario'
import { getStoryScenario } from '../../shared/storyEnvironmentPreview'

const meta = {
  title: 'Pages/Self Review',
  component: TaskDetailPage,
  args: { onRunAction: fn(), onOpenTask: fn() },
} satisfies Meta<typeof TaskDetailPage>
export default meta

type Story = StoryObj<typeof meta>
function scenario(state: SelfReviewScenario): Story {
  const { task, hostLifecycle, environment } = taskDetailScenario('review', state)
  return { args: { task, hostLifecycle }, parameters: { openforge: environment } }
}

export const Populated: Story = {
  ...scenario('populated'),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).findByText('greet.ts')).resolves.toBeVisible()
  },
}
export const LinkedPullRequest: Story = scenario('github-comments')
export const GithubComments: Story = {
  ...scenario('github-comments'),
  name: 'GitHub comments',
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('tab', { name: /^GitHub comments/ }))
    const feedback = within(canvas.getByRole('region', { name: 'Feedback panel' }))
    await expect(feedback.findByText('Please handle whitespace-only names.')).resolves.toBeVisible()
  },
}
export const Empty: Story = scenario('empty')
export const Loading: Story = scenario('loading')
export const Failure: Story = {
  ...scenario('failure'),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).findByText('Failed to load diff. Please try again.')).resolves.toBeVisible()
  },
}
export const LongContent: Story = scenario('long-content')
export const Narrow: Story = {
  ...scenario('populated'),
  globals: { viewport: { value: 'narrow', isRotated: false } },
}
export const SendFeedback: Story = {
  ...scenario('populated'),
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const diff = within(await canvas.findByRole('region', { name: 'Code diff panel' }))
    await expect(diff.findByText('Please cover the empty-name case too.')).resolves.toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: /Send feedback/ }))
    const dialog = within(await within(canvasElement.ownerDocument.body).findByRole('dialog', { name: 'Review the prompt before sending to the agent' }))
    await userEvent.click(dialog.getByRole('button', { name: 'Send to agent' }))
    await expect(args.onRunAction).toHaveBeenCalledWith({
      taskId: 'T-42', actionPrompt: expect.stringContaining('Please cover the empty-name case too.'),
    })
    await expect(canvas.findByText('Feedback sent to agent!', {}, { timeout: 15000 })).resolves.toBeVisible()
  },
}
export const FinishLoading: Story = {
  ...scenario('loading'),
  play: async (context) => {
    const canvas = within(context.canvasElement)
    getStoryScenario(context).desktop.release('get_task_diff')
    await expect(canvas.findByText('No changes for current selection')).resolves.toBeVisible()
  },
}
