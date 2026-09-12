import type { NavigationStory as Story } from '../../shared/navigationStories'
import { expect, userEvent } from 'storybook/test'
import { navigationMeta, navigationState, dialogQueries, dismissAndReopen, reopenWorkflow, markNavigationReady } from '../../shared/navigationStories'

const meta = { ...navigationMeta('actions', 'Pages/Action palette'), title: 'Pages/Action palette' }
export default meta

export const Populated: Story = {}
export const ThemeOverride: Story = { args: { paletteTheme: true } }
export const Backlog: Story = navigationState('actions', 'backlog')
export const Unavailable: Story = {
  ...navigationState('actions', 'unavailable'),
  play: async (context) => {
    const body = dialogQueries(context)
    await body.findByRole('listbox')
    await expect(body.queryByRole('option', { name: /Start Task|Run app|Complete Task|merge PR/i })).not.toBeInTheDocument()
    markNavigationReady(context)
  },
}
export const EmptyResults: Story = {
  play: async (context) => {
    const body = dialogQueries(context)
    await userEvent.type(await body.findByPlaceholderText('Type an action...'), 'no-such-action')
    await expect(body.getByRole('status')).toHaveTextContent('No actions match your search')
    markNavigationReady(context)
  },
}
export const Narrow: Story = { globals: { viewport: { value: 'narrow', isRotated: false } } }
export const MergeMethods: Story = navigationState('actions', 'merge')
export const Confirmation: Story = {
  ...navigationState('actions', 'merge'),
  play: async (context) => {
    const body = dialogQueries(context)
    await userEvent.click(await body.findByRole('option', { name: /Squash and merge PR #42/ }))
    await expect(body.getByRole('button', { name: 'Confirm' })).toHaveFocus()
    await expect(context.args.onExecute).not.toHaveBeenCalled()
    markNavigationReady(context)
  },
}
export const ExecuteAndReopen: Story = {
  ...navigationState('actions', 'backlog'),
  play: async (context) => {
    const body = dialogQueries(context)
    await dismissAndReopen(context, 'Type an action...')
    await userEvent.type(body.getByPlaceholderText('Type an action...'), 'start')
    await userEvent.keyboard('{Enter}')
    await expect(context.args.onExecute).toHaveBeenCalledWith('start-task', undefined)
    await reopenWorkflow(context)
    await expect(await body.findByPlaceholderText('Type an action...')).toHaveValue('')
    markNavigationReady(context)
  },
}
export const ConfirmAndReopen: Story = {
  ...navigationState('actions', 'merge'),
  play: async (context) => {
    const body = dialogQueries(context)
    await userEvent.click(await body.findByRole('option', { name: /Squash and merge PR #42/ }))
    await userEvent.keyboard('{Escape}')
    await expect(body.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument()
    await userEvent.click(body.getByRole('option', { name: /Rebase and merge PR #42/ }))
    await userEvent.keyboard('{Enter}')
    await expect(context.args.onExecute).toHaveBeenCalledWith('merge-pr:rebase', 'rebase')
    await reopenWorkflow(context)
    await body.findByPlaceholderText('Type an action...')
    await expect(body.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument()
    markNavigationReady(context)
  },
}
