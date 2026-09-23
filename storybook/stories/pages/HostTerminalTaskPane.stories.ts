import type { Meta, StoryObj } from '@storybook/svelte-vite'
import { expect, waitFor } from 'storybook/test'
import TerminalTaskPane from '../../../src/components/task-detail/TerminalTaskPane.svelte'
import { regularTerminalSessions, terminalDiagnostics } from '../../../src/lib/terminalSessionService'
import TaskPaneFrame from '../../shared/frames/TaskPaneFrame.svelte'
import { taskDetailScenario } from '../../shared/fixtures/taskDetailScenario'
import { getStoryScenario } from '../../shared/storyEnvironmentPreview'

const { environment } = taskDetailScenario('terminal')
const meta = {
  title: 'Pages/Host Terminal Task Pane', component: TerminalTaskPane,
  decorators: [() => ({ Component: TaskPaneFrame, props: { tab: {
    pluginId: 'com.openforge.terminal', contributionId: 'terminal',
    namespacedId: 'com.openforge.terminal:terminal', title: 'Terminal',
    icon: 'terminal', order: 10, requiresWorkspace: false,
  } } })],
  args: { taskId: 'T-42' },
  parameters: { openforge: { ...environment, desktop: { ...environment.desktop, responses: {
    ...environment.desktop?.responses,
    get_task_workspace: { repo_path: '/workspace/openforge', workspace_path: '/workspace/openforge/.openforge/worktrees/T-42',
      branch_name: 'task/T-42', provider_name: 'pi', created_at: 1_767_344_000, updated_at: 1_767_346_000 },
    pty_spawn_shell: 42, pty_kill: undefined,
  } }, adapters: () => [...(environment.adapters?.() ?? []), {
    install: () => regularTerminalSessions.releaseAllForTask('T-42'),
    reset: () => regularTerminalSessions.releaseAllForTask('T-42'),
    dispose: () => regularTerminalSessions.releaseAllForTask('T-42'),
  }] } },
} satisfies Meta<typeof TerminalTaskPane>
export default meta
type Story = StoryObj<typeof meta>

export const Ready: Story = {
  play: async context => {
    await waitFor(() => expect(context.canvasElement.querySelector('.xterm-screen')).not.toBeNull(), { timeout: 15_000 })
    await waitFor(() => expect(getStoryScenario(context).desktop.calls.some(call => call.command === 'get_pty_buffer')).toBe(true), { timeout: 15_000 })
    await context.canvasElement.ownerDocument.fonts.ready
    await waitFor(async () => {
      const key = terminalDiagnostics.list().find(key => terminalDiagnostics.observe(key).view.visible)
      expect(key).toBeTruthy()
      const state = terminalDiagnostics.observe(key!)
      expect(state.lifecycle.ptyActive).toBe(true)
      expect(state.view.authorityReadPending).toBe(false)
    }, { timeout: 15_000 })
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    context.canvasElement.setAttribute('data-terminal-ready', 'true')
  },
}
