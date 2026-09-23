import type { Meta, StoryObj } from '@storybook/svelte-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import App from '../../../src/App.svelte'
import { createProject } from '../../shared/fixtures/appFixtures'
import { creationScenario } from '../../shared/fixtures/creationScenario'

const taskCreationDesktop = creationScenario('task').desktop
const meta = {
  title: 'Pages/Application',
  component: App,
  parameters: {
    openforge: {
      desktop: {
        ...taskCreationDesktop,
        responses: {
          ...taskCreationDesktop?.responses,
          register_builtin_plugin: null,
          get_enabled_plugins: [],
          get_restart_workspace: null,
          set_poll_context: null,
          get_pull_requests: [],
          get_review_prs: [],
          list_plugins: [],
          get_enabled_app_plugins: [],
          get_projects: [createProject()],
          get_app_mode: 'production',
          get_project_attention: [],
          get_task_attention: [],
          tasks_active: { tasks: [], related: [] },
        },
      },
    },
  },
} satisfies Meta<typeof App>

export default meta
type Story = StoryObj<typeof meta>

export const Board: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getByText('All clear')).toBeVisible())
    await waitFor(() => expect(canvas.getByRole('navigation', { name: 'Project tools' })).toBeVisible())
  },
}

export const NewTask: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getByText('All clear')).toBeVisible())
    await userEvent.click(canvas.getByRole('button', { name: 'New task' }))
    const body = within(canvasElement.ownerDocument.body)
    await waitFor(() => expect(body.getByRole('dialog')).toBeVisible())
    await waitFor(() => expect(body.getByRole('button', { name: /Start Task/ })).toBeVisible())
  },
}
