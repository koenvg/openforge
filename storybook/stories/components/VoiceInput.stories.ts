import type { Meta, StoryObj } from '@storybook/svelte-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import VoiceInput from '../../../src/components/shared/adapters/VoiceInput.svelte'

const meta = {
  title: 'Components/Voice Input', component: VoiceInput,
  args: { onTranscription: fn(), showLabel: true, showShortcut: false },
  parameters: { openforge: { desktop: { responses: { get_whisper_model_status: {
    size: 'small', display_name: 'Whisper Small', downloaded: false, model_path: null,
    model_size_bytes: null, model_name: 'small', disk_size_mb: 462, ram_usage_mb: 1000, is_active: true,
  } } } } },
} satisfies Meta<typeof VoiceInput>
export default meta
type Story = StoryObj<typeof meta>

export const ModelRequired: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Start voice input' }))
    await expect(canvas.findByText('Download model in Settings first')).resolves.toBeVisible()
  },
}
