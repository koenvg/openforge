import type { NavigationStory as Story } from '../../shared/navigationStories'
import { expect, userEvent } from 'storybook/test'
import { get } from 'svelte/store'
import { activeProjectId } from '../../../src/lib/stores'
import { navigationMeta, navigationState, dialogQueries, dismissAndReopen, reopenWorkflow, markNavigationReady } from '../../shared/navigationStories'

const meta = { ...navigationMeta('projects', 'Pages/Project switching'), title: 'Pages/Project switching' }
export default meta

export const Populated: Story = {}
export const ThemeOverride: Story = { args: { paletteTheme: true } }
export const Empty: Story = navigationState('projects', 'empty')
export const Attention: Story = navigationState('projects', 'attention')
export const Narrow: Story = { globals: { viewport: { value: 'narrow', isRotated: false } } }
export const Overflow: Story = {
  ...navigationState('projects', 'overflow'),
  play: async (context) => {
    const body = dialogQueries(context)
    await userEvent.click(await body.findByPlaceholderText('Switch project...'))
    await userEvent.keyboard('{ArrowUp}')
    await expect(body.getByRole('option', { selected: true })).toHaveTextContent('Integration 24')
    markNavigationReady(context)
  },
}
export const Filtered: Story = {
  play: async (context) => {
    const body = dialogQueries(context)
    await userEvent.type(await body.findByPlaceholderText('Switch project...'), 'docs')
    await expect(body.getAllByRole('option')).toHaveLength(1)
    markNavigationReady(context)
  },
}
export const SwitchAndReopen: Story = {
  play: async (context) => {
    const body = dialogQueries(context)
    await dismissAndReopen(context, 'Switch project...')
    await userEvent.click(body.getByPlaceholderText('Switch project...'))
    await userEvent.keyboard('{ArrowDown}{Enter}')
    await expect(context.args.onSelectProject).toHaveBeenCalledWith('project-2')
    await expect(get(activeProjectId)).toBe('project-2')
    await reopenWorkflow(context)
    await expect(await body.findByPlaceholderText('Switch project...')).toHaveValue('')
    await expect(get(activeProjectId)).toBe('project-1')
    markNavigationReady(context)
  },
}
