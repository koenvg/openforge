import type { Meta, StoryObj } from '@storybook/svelte-vite'
import { expect, userEvent, within } from 'storybook/test'
import JiraSettingsSection from '../../../plugins/github-sync/src/settings/JiraSettingsSection.svelte'
import { githubSyncScenario } from '../../shared/fixtures/githubSyncScenario'
import GitHubSyncContributionFrame from '../../shared/frames/GitHubSyncContributionFrame.svelte'
import { getStoryScenario } from '../../shared/storyEnvironmentPreview'

const meta = {
  title: 'Pages/GitHub Sync/Settings/Jira',
  component: JiraSettingsSection,
  parameters: { openforge: githubSyncScenario('connected') },
  decorators: [() => ({ Component: GitHubSyncContributionFrame, props: { host: 'settings' } })],
  render: (_args, context) => ({
    Component: JiraSettingsSection,
    props: { api: getStoryScenario(context).plugin.api },
  }),
} satisfies Meta<typeof JiraSettingsSection>

export default meta
type Story = StoryObj

export const Connected: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.findByDisplayValue('https://openforge.atlassian.net')).resolves.toBeVisible()
    await expect(canvas.getByText('A token is stored in your keychain.')).toBeVisible()
  },
}

export const Disconnected: Story = {
  parameters: { openforge: githubSyncScenario('disconnected') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const token = await canvas.findByLabelText('Jira API token')
    await expect(token).toHaveAttribute('placeholder', 'Paste your API token')
    await expect(canvas.queryByText('A token is stored in your keychain.')).not.toBeInTheDocument()
  },
}

export const SaveConfiguration: Story = {
  play: async (context) => {
    const canvas = within(context.canvasElement)
    const field = await canvas.findByLabelText('Acceptance criteria field id')
    await userEvent.clear(field)
    await userEvent.type(field, 'customfield_14900')
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }))
    await expect(canvas.findByText('Saved.')).resolves.toBeVisible()
    await expect(getStoryScenario(context).plugin.calls.backendInvocations).toContainEqual(expect.objectContaining({
      method: 'saveJiraSettings',
      payload: expect.objectContaining({ config: expect.objectContaining({ acFieldId: 'customfield_14900' }) }),
    }))
  },
}

export const ConnectionFailure: Story = {
  parameters: { openforge: githubSyncScenario('test-failure') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByDisplayValue('https://openforge.atlassian.net')
    await userEvent.click(canvas.getByRole('button', { name: 'Test connection' }))
    await expect(canvas.findByText(/rejected the catalog credentials/)).resolves.toBeVisible()
  },
}

export const SaveFailure: Story = {
  parameters: { openforge: githubSyncScenario('save-failure') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByDisplayValue('https://openforge.atlassian.net')
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }))
    await expect(canvas.findByText('Jira settings could not be saved.')).resolves.toBeVisible()
  },
}

export const Loading: Story = {
  parameters: { openforge: githubSyncScenario('loading') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.findByLabelText('Jira site URL')).resolves.toHaveValue('')
  },
}

export const Failure: Story = {
  parameters: { openforge: githubSyncScenario('failure') },
  play: async (context) => {
    const canvas = within(context.canvasElement)
    await expect(canvas.findByLabelText('Jira site URL')).resolves.toHaveValue('')
    await expect(getStoryScenario(context).plugin.calls.backendInvocations.map(call => call.method))
      .toContain('getJiraSettings')
  },
}
