import type { Meta, StoryObj } from '@storybook/svelte-vite'
import { expect, fn, within } from 'storybook/test'
import TaskDetailProviderPage from '../../shared/frames/TaskDetailProviderPage.svelte'
import { createProject } from '../../shared/fixtures/appFixtures'
import { taskDetailScenario } from '../../shared/fixtures/taskDetailScenario'

const { task, environment } = taskDetailScenario('active')
const meta = {
  title: 'Pages/Task Detail Provider', component: TaskDetailProviderPage,
  args: { task, project: createProject(), onRunAction: fn() },
  parameters: { openforge: { ...environment, desktop: { ...environment.desktop, responses: {
    ...environment.desktop?.responses,
    get_task_workspace: { repo_path: '/workspace/openforge', workspace_path: '/workspace/openforge/.openforge/worktrees/T-42',
      branch_name: 'task/T-42', provider_name: 'pi', created_at: 1_767_344_000, updated_at: 1_767_346_000 },
  } } } },
} satisfies Meta<typeof TaskDetailProviderPage>
export default meta
type Story = StoryObj<typeof meta>

export const Active: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.findByRole('navigation', { name: 'Task workbench tabs' })).resolves.toBeVisible()
  },
}
