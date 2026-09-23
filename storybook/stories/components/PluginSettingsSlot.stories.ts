import type { Meta, StoryObj } from '@storybook/svelte-vite'
import type { Component } from 'svelte'
import { expect, within } from 'storybook/test'
import GlobalPluginSettingsSections from '../../../src/components/plugin/GlobalPluginSettingsSections.svelte'
import { runtimeContributionSources } from '../../../src/lib/plugin/pluginStore'
import type { RuntimeContributionSource } from '../../../src/lib/plugin/contributionResolver'
import { registerRenderableContributionComponent, unregisterRenderableContributionComponent } from '../../../src/lib/plugin/componentRegistry'
import { createStoryStoreAdapter as seed } from '../../shared/environment/storyStoreAdapter'
import CatalogPluginSection from '../../shared/fixtures/CatalogPluginSection.svelte'

const pluginId = 'com.openforge.catalog-integration'
const contributionKey = `${pluginId}:catalog-settings`
const source: RuntimeContributionSource = {
  pluginId, settingsSections: [{ id: 'catalog-settings', title: 'Catalog settings', order: 10, scope: 'global' }],
}
const registry = {
  install: () => registerRenderableContributionComponent('settingsSections', contributionKey, CatalogPluginSection as unknown as Component<Record<string, unknown>>),
  reset: () => registerRenderableContributionComponent('settingsSections', contributionKey, CatalogPluginSection as unknown as Component<Record<string, unknown>>),
  dispose: () => unregisterRenderableContributionComponent('settingsSections', contributionKey),
}
const meta = {
  title: 'Components/Plugin Settings Slot', component: GlobalPluginSettingsSections,
  args: { pluginId },
  parameters: { openforge: { adapters: () => [
    seed(runtimeContributionSources, new Map([[pluginId, source]])), registry,
  ] } },
} satisfies Meta<typeof GlobalPluginSettingsSections>
export default meta
type Story = StoryObj<typeof meta>

export const Global: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.findByRole('heading', { name: 'Catalog settings contribution' })).resolves.toBeVisible()
    await expect(canvas.getByLabelText('Catalog plugin settings')).toBeVisible()
  },
}
