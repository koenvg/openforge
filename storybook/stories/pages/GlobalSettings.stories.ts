import type { Meta, StoryObj } from '@storybook/svelte-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import SettingsPage from '../../shared/frames/SettingsPage.svelte'
import { settingsScenario } from '../../shared/fixtures/settingsScenario'
import { openSettingsSection, settingsReady } from '../../shared/fixtures/settingsInteractions'
import { getStoryScenario } from '../../shared/storyEnvironmentPreview'

const meta = {
  title: 'Pages/Global Settings', component: SettingsPage,
  parameters: { openforge: settingsScenario('global') },
  args: { mode: 'global', onClose: fn(), onProjectDeleted: fn() },
} satisfies Meta<typeof SettingsPage>
export default meta
type Story = StoryObj<typeof meta>

export const General: Story = { play: async ({ canvasElement }) => { await settingsReady(canvasElement) } }
export const Agents: Story = { play: async ({ canvasElement }) => { await openSettingsSection(canvasElement, 'Agents', 'Global defaults') } }
export const Credentials: Story = { play: async ({ canvasElement }) => {
  const canvas = await openSettingsSection(canvasElement, 'GitHub & Credentials', 'Credentials')
  await expect(canvas.getByText('GitHub credential not configured')).toBeVisible()
} }
export const GithubConnected: Story = {
  parameters: { openforge: settingsScenario('global', 'github-connected') },
  play: async ({ canvasElement }) => {
    const canvas = await openSettingsSection(canvasElement, 'GitHub & Credentials', 'Credentials')
    await expect(canvas.getByText('GitHub credential configured')).toBeVisible()
  },
}
export const Voice: Story = { play: async ({ canvasElement }) => { await openSettingsSection(canvasElement, 'Voice & Whisper', 'Voice & Whisper') } }
export const Plugins: Story = { play: async ({ canvasElement }) => { await openSettingsSection(canvasElement, 'Plugins', 'Default project dashboard') } }
export const Companion: Story = { play: async ({ canvasElement }) => {
  const canvas = await openSettingsSection(canvasElement, 'Companion', 'Companion')
  await expect(canvas.findByRole('button', { name: 'Enable Companion Gateway' })).resolves.toBeVisible()
} }
export const CompanionEnabled: Story = { play: async (context) => {
  const canvas = await openSettingsSection(context.canvasElement, 'Companion', 'Companion')
  await userEvent.click(await canvas.findByRole('button', { name: 'Enable Companion Gateway' }))
  await expect(canvas.findByRole('button', { name: 'Disable Companion Gateway' })).resolves.toBeVisible()
  await expect(getStoryScenario(context).desktop.bridge.invoke('get_companion_gateway_status')).resolves.toMatchObject({ enabled: true })
} }
export const Developer: Story = { play: async ({ canvasElement }) => {
  const canvas = await openSettingsSection(canvasElement, 'Developer logs', 'Developer')
  await expect(canvas.findByText(/Application ready/)).resolves.toBeVisible()
} }
export const Edited: Story = { play: async (context) => {
  const canvas = await settingsReady(context.canvasElement)
  const input = canvas.getByRole('textbox', { name: 'Task ID Prefix' })
  await userEvent.clear(input)
  await userEvent.type(input, 'TEAM')
  await expect(canvas.findByText('All changes saved')).resolves.toBeVisible()
  await expect(getStoryScenario(context).desktop.bridge.invoke('get_config', { key: 'task_id_prefix' })).resolves.toBe('TEAM')
  // Capture the persisted resting state, not the short-lived saved confirmation.
  await expect(canvas.findByText('Autosaves changes', {}, { timeout: 5000 })).resolves.toBeVisible()
} }
export const Loading: Story = {
  parameters: { openforge: settingsScenario('global', 'loading') },
  play: async ({ canvasElement }) => { await expect(within(canvasElement).findByText('Loading settings…')).resolves.toBeVisible() },
}
export const Failure: Story = {
  parameters: { openforge: settingsScenario('global', 'failure') },
  play: async ({ canvasElement }) => { await expect(within(canvasElement).findByText(/Failed to load settings: Settings unavailable/)).resolves.toBeVisible() },
}
export const SaveFailure: Story = {
  parameters: { openforge: settingsScenario('global', 'save-failure') },
  play: async ({ canvasElement }) => {
    const canvas = await settingsReady(canvasElement)
    await userEvent.type(canvas.getByRole('textbox', { name: 'Task ID Prefix' }), 'X')
    await expect(canvas.findByText(/Autosave failed: Settings are read-only/)).resolves.toBeVisible()
  },
}
export const Narrow: Story = { globals: { viewport: { value: 'narrow', isRotated: false } } }
export const LongContent: Story = {
  parameters: { openforge: settingsScenario('global', 'long') },
  play: async ({ canvasElement }) => {
    const canvas = await openSettingsSection(canvasElement, 'Agents', 'Global defaults')
    await userEvent.click(canvas.getByTestId('expand-pr_review_guidance'))
    await expect(canvas.getByTestId('pr_review_guidance')).toBeVisible()
  },
}
