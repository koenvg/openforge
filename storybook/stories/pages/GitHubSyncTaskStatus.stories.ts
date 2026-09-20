import type { Meta, StoryObj } from '@storybook/svelte-vite'
import { expect, userEvent, within } from 'storybook/test'
import TaskPullRequestStatus from '../../../plugins/github-sync/src/task/TaskPullRequestStatus.svelte'
import { createTask } from '../../shared/fixtures/appFixtures'
import { githubSyncScenario } from '../../shared/fixtures/githubSyncScenario'
import GitHubSyncContributionFrame from '../../shared/frames/GitHubSyncContributionFrame.svelte'
import { getStoryScenario } from '../../shared/storyEnvironmentPreview'

const task = createTask({
  id: 'T-42',
  title: 'Catalog integration settings and contributions',
  prompt: 'Let contributors inspect GitHub and Jira integration states in their production host contexts.',
  promptPreview: 'Let contributors inspect GitHub and Jira integration states.',
})

const meta = {
  title: 'Pages/GitHub Sync/Task Status',
  component: TaskPullRequestStatus,
  args: { taskActionPending: false },
  parameters: { openforge: githubSyncScenario('populated') },
  decorators: [() => ({ Component: GitHubSyncContributionFrame, props: { host: 'task-status', task } })],
  render: (args, context) => {
    const plugin = getStoryScenario(context).plugin
    return {
      Component: TaskPullRequestStatus,
      props: {
        api: plugin.api,
        context: plugin.context,
        taskId: task.id,
        task,
        projectId: task.projectId,
        taskActionPending: args.taskActionPending,
      },
    }
  },
} satisfies Meta<typeof TaskPullRequestStatus>

export default meta
type Story = StoryObj<typeof meta>

export const Populated: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.findByText('Add deterministic UI catalogs')).resolves.toBeVisible()
    await expect(canvas.getByText(/overflows the Task status panel/)).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Squash and merge' })).toBeEnabled()
  },
}

export const Empty: Story = {
  parameters: { openforge: githubSyncScenario('empty') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.findByTestId('task-pull-requests-empty')).resolves.toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Add PR' })).toBeVisible()
  },
}

export const Loading: Story = {
  parameters: { openforge: githubSyncScenario('loading') },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).findByText('Loading pull requests…', {}, { timeout: 2000 }))
      .resolves.toBeVisible()
  },
}

export const Failure: Story = {
  parameters: { openforge: githubSyncScenario('failure') },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).findByRole('alert')).resolves.toHaveTextContent(
      'Could not load pull requests: GitHub status is unavailable.',
    )
  },
}

export const DisabledActions: Story = {
  args: { taskActionPending: true },
  play: async ({ canvasElement }) => {
    const button = await within(canvasElement).findByRole('button', { name: 'Merging…' })
    await expect(button).toBeDisabled()
  },
}

export const LinkPullRequest: Story = {
  parameters: { openforge: githubSyncScenario('empty') },
  play: async (context) => {
    const canvas = within(context.canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Add PR' }))
    const field = canvas.getByLabelText('GitHub pull request URL')
    await userEvent.type(field, 'not-a-pull-request')
    await userEvent.click(canvas.getByRole('button', { name: 'Link PR' }))
    await expect(canvas.findByText('Enter a valid GitHub pull request URL.')).resolves.toBeVisible()
    await userEvent.clear(field)
    await userEvent.type(field, 'https://github.com/openforge/openforge/pull/99')
    await userEvent.click(canvas.getByRole('button', { name: 'Link PR' }))
    await expect(canvas.findByText('Newly linked catalog pull request')).resolves.toBeVisible()
    await expect(getStoryScenario(context).plugin.calls.backendInvocations.map(call => call.method))
      .toContain('linkTaskPullRequest')
  },
}

export const RefreshWithLocalResponse: Story = {
  play: async (context) => {
    const canvas = within(context.canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Refresh GitHub status' }))
    await expect(getStoryScenario(context).plugin.calls.backendInvocations.map(call => call.method))
      .toContain('refreshTaskGithubStatus')
    await expect(getStoryScenario(context).plugin.calls.openUrl).toEqual([])
  },
}
