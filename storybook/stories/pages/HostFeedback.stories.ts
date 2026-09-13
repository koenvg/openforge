import type { Meta, StoryObj } from '@storybook/svelte-vite'
import { expect, fn, within } from 'storybook/test'
import HostFeedback from '../../shared/fixtures/HostFeedback.svelte'
import { getStoryScenario } from '../../shared/storyEnvironmentPreview'

const meta = {
  title: 'Pages/Host Feedback', component: HostFeedback,
  args: { onactivate: fn(), ondismiss: fn() },
  parameters: { openforge: { desktop: { deferred: ['download_whisper_model'], responses: { download_whisper_model: undefined } } } },
} satisfies Meta<typeof HostFeedback>
export default meta
type Story = StoryObj<typeof meta>

export const Downloading: Story = {
  play: async context => {
    const canvas = within(context.canvasElement)
    await expect(canvas.findByRole('progressbar', { name: 'Downloading Whisper Small' })).resolves.toBeVisible()
    getStoryScenario(context).desktop.emit('whisper-download-progress', {
      model_size: 'small', percentage: 25, bytes_downloaded: 1048576, total_bytes: 4194304,
    })
    await expect(canvas.findByText('25% — 1 MB / 4 MB')).resolves.toBeVisible()
    await expect(canvas.getAllByRole('status')).toHaveLength(1)
  },
}
