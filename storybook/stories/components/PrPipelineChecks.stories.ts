import type { Meta, StoryObj } from '@storybook/svelte-vite'
import { expect, within } from 'storybook/test'
import PrPipelineChecks from '../../../src/components/shared/pr/PrPipelineChecks.svelte'

const checks = JSON.stringify([
  { id: 1, name: 'Linux typecheck', status: 'completed', conclusion: 'failure', html_url: '' },
  { id: 2, name: 'Unit tests', status: 'completed', conclusion: 'success', html_url: '' },
  { id: 3, name: 'Visual screenshots', status: 'in_progress', conclusion: null, html_url: '' },
])
const meta = {
  title: 'Components/PR Pipeline Checks', component: PrPipelineChecks,
  args: { ciCheckRuns: checks, variant: 'detail' as const },
} satisfies Meta<typeof PrPipelineChecks>
export default meta
type Story = StoryObj<typeof meta>

export const Failed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByLabelText('Pipeline checks')).toBeVisible()
    await expect(canvas.getByText('Linux typecheck')).toBeVisible()
  },
}
