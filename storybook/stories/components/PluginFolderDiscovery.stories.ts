import type { Meta, StoryObj } from '@storybook/svelte-vite'
import { expect, within } from 'storybook/test'
import PluginFolderDiscovery from '../../../src/components/plugin/PluginFolderDiscovery.svelte'
import type { DiscoveredPlugin } from '../../../src/lib/ipc'

const catalogTools: DiscoveredPlugin = {
  path: '/workspace/plugins/catalog-tools', id: 'com.openforge.catalog-tools',
  name: 'Catalog Tools', version: '1.2.0', description: 'Adds local review utilities.',
  installable: true, needsBuild: false, problem: null,
}
const meta = {
  title: 'Components/Plugin Folder Discovery', component: PluginFolderDiscovery,
  args: { folderPath: '/workspace/plugins', activeProjectId: 'project-1' },
  parameters: { openforge: { desktop: { responses: { scan_plugin_folder: [catalogTools] } } } },
} satisfies Meta<typeof PluginFolderDiscovery>
export default meta
type Story = StoryObj<typeof meta>

export const Installable: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.findByText('Catalog Tools')).resolves.toBeVisible()
  },
}
