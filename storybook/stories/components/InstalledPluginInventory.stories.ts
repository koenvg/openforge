import type { Meta, StoryObj } from '@storybook/svelte-vite'
import { expect, within } from 'storybook/test'
import GlobalPluginInventory from '../../../src/components/plugin/GlobalPluginInventory.svelte'
import { appEnabledPluginIds, enabledPluginIds, installedPlugins } from '../../../src/lib/plugin/pluginStore'
import { createStoryStoreAdapter as seed } from '../../shared/environment/storyStoreAdapter'
import { catalogPlugin } from '../../shared/fixtures/pluginInventoryFixtures'

const meta = {
  title: 'Components/Installed Plugin Inventory', component: GlobalPluginInventory,
  args: { activeProjectId: 'project-1', pluginDefaults: new Map([[catalogPlugin.manifest.id, true]]) },
  parameters: { openforge: { desktop: { responses: { task_browser_surface_destroy_plugin: { ok: true, value: null } } }, adapters: () => [
    seed(installedPlugins, new Map([[catalogPlugin.manifest.id, catalogPlugin]])),
    seed(appEnabledPluginIds, new Set()),
    seed(enabledPluginIds, new Set()),
  ] } },
} satisfies Meta<typeof GlobalPluginInventory>
export default meta
type Story = StoryObj<typeof meta>

export const Installed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Catalog Integration')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Copy diagnostics: Catalog Integration' })).toBeVisible()
    await expect(canvas.getByRole('switch', { name: 'Enable by default: Catalog Integration' })).toBeChecked()
  },
}
