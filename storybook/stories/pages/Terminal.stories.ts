import type { Meta, StoryObj } from '@storybook/svelte-vite'
import { expect, userEvent, within, waitFor } from 'storybook/test'
import TerminalProjectView from '../../../plugins/terminal/src/TerminalProjectView.svelte'
import PluginErrorBoundary from '../../../src/components/plugin/PluginErrorBoundary.svelte'
import PageFrame from '../../shared/frames/PageFrame.svelte'
import { terminalScenario } from '../../shared/fixtures/terminalScenario'
import { getStoryScenario } from '../../shared/storyEnvironmentPreview'
import { terminalReady } from '../../shared/fixtures/terminalReadiness'

const meta = {
  title: 'Pages/Terminal',
  component: TerminalProjectView,
  decorators: [() => ({ Component: PageFrame })],
  args: { projectId: 'P-1', projectName: 'OpenForge', projectPath: '/projects/openforge' },
  parameters: { openforge: terminalScenario() },
} satisfies Meta<typeof TerminalProjectView>
export default meta
type Story = StoryObj<typeof meta>

export const Ready: Story = { play: context => terminalReady(context) }
export const NoProject: Story = { args: { projectId: null } }
export const NoPath: Story = { args: { projectPath: '' } }
export const RuntimeUnavailable: Story = {
  render: () => ({ Component: PluginErrorBoundary, props: {
    pluginId: 'com.openforge.terminal', pluginName: 'Terminal', errorMessage: 'Terminal runtime unavailable',
  } }),
}
export const Empty: Story = { parameters: { openforge: terminalScenario({ state: 'empty' }) } }
export const Overflow: Story = { parameters: { openforge: terminalScenario({ state: 'overflow' }) } }
export const ShellTabsAndInput: Story = {
  play: async context => {
    const canvas = within(context.canvasElement)
    const terminal = getStoryScenario(context).terminal!
    await waitFor(() => expect(context.canvasElement.querySelector('.xterm-helper-textarea')).not.toBeNull())
    await userEvent.click(canvas.getByRole('button', { name: 'Open new shell' }))
    await waitFor(() => expect(canvas.getAllByRole('tab')).toHaveLength(2))
    await waitFor(() => expect(context.canvasElement.querySelectorAll('.xterm-helper-textarea')).toHaveLength(2))
    await terminalReady(context)
    const activeTab = canvas.getByRole('tab', { name: /Shell 2, active/ })
    const panel = context.canvasElement.ownerDocument.getElementById(activeTab.getAttribute('aria-controls')!)!
    const input = panel.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea')!
    input.focus()
    await expect(input).toHaveFocus()
    await userEvent.keyboard('pwd{Enter}')
    await waitFor(() => expect(terminal.transport.inputs.map(input => input.data).join('')).toContain('pwd'))
    expect([...new Set(terminal.transport.inputs.map(input => input.shellSessionKey))]).toEqual(['project-P-1-shell-1'])
    await userEvent.click(canvas.getAllByRole('tab')[0])
    await expect(canvas.getAllByRole('tab')[0]).toHaveAttribute('aria-selected', 'true')
    await userEvent.click(canvas.getByRole('button', { name: 'Close Shell 2' }))
    await waitFor(() => expect(canvas.getAllByRole('tab')).toHaveLength(1))
  },
}
