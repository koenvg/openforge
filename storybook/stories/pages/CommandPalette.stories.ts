import type { NavigationStory as Story } from '../../shared/navigationStories'
import { expect, userEvent } from 'storybook/test'
import { get } from 'svelte/store'
import { activeProjectId, selectedTaskId } from '../../../src/lib/stores'
import { getConfig } from '../../../src/lib/ipc'
import { getStoryScenario } from '../../shared/storyEnvironmentPreview'
import { navigationMeta, navigationState, dialogQueries, dismissAndReopen, reopenWorkflow, markNavigationReady } from '../../shared/navigationStories'

const meta = { ...navigationMeta('commands', 'Pages/Command palette'), title: 'Pages/Command palette' }
export default meta

export const Populated: Story = {}
export const ThemeOverride: Story = { args: { paletteTheme: true } }
export const Empty: Story = navigationState('commands', 'empty')
export const Loading: Story = navigationState('commands', 'loading')
export const Failure: Story = navigationState('commands', 'failure')
export const Narrow: Story = { globals: { viewport: { value: 'narrow', isRotated: false } } }
export const Overflow: Story = navigationState('commands', 'overflow')
export const SearchAndNavigate: Story = {
  play: async (context) => {
    const body = dialogQueries(context)
    await body.findByRole('option', { name: /Write contributor docs/ })
    await dismissAndReopen(context, 'Search tasks or commands...')
    await body.findByRole('option', { name: /Write contributor docs/ })
    await userEvent.type(body.getByPlaceholderText('Search tasks or commands...'), 'docs')
    await expect(body.getAllByRole('option')).toHaveLength(1)
    await userEvent.keyboard('{Enter}')
    await expect(get(activeProjectId)).toBe('project-2')
    await expect(get(selectedTaskId)).toBe('T-43')
    await reopenWorkflow(context)
    await body.findByRole('option', { name: /Write contributor docs/ })
    await expect(get(activeProjectId)).toBe('project-1')
    await expect(get(selectedTaskId)).toBeNull()
    markNavigationReady(context)
  },
}
export const RunCommand: Story = {
  play: async (context) => {
    const body = dialogQueries(context)
    await body.findByRole('option', { name: /Refresh catalog index/ })
    await userEvent.type(body.getByPlaceholderText('Search tasks or commands...'), 'catalog')
    await userEvent.keyboard('{Enter}')
    await body.findByRole('button', { name: 'Reopen workflow' })
    await expect(getStoryScenario(context).desktop.calls).toContainEqual({
      command: 'set_config', payload: { key: 'catalog.lastCommand', value: '{"id":"refresh-index"}' },
    })
    await reopenWorkflow(context)
    await body.findByRole('option', { name: /Refresh catalog index/ })
    await expect(getConfig('catalog.lastCommand')).resolves.toBeNull()
    markNavigationReady(context)
  },
}
export const FinishLoading: Story = {
  ...navigationState('commands', 'loading'),
  play: async (context) => {
    const body = dialogQueries(context)
    await body.findByText('Loading tasks...')
    getStoryScenario(context).desktop.release('get_latest_sessions')
    await body.findByRole('option', { name: /Write contributor docs/ })
    markNavigationReady(context)
  },
}
