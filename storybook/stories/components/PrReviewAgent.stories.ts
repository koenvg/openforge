import type { Meta, StoryObj } from '@storybook/svelte-vite'
import { expect, within } from 'storybook/test'
import AgentTab from '../../../plugins/github-sync/src/review/pr/AgentTab.svelte'

const meta = {
  title: 'Components/PR Review Agent', component: AgentTab,
  args: {
    scope: null, projectResolved: true, projectId: null, status: null,
    isLoading: false, error: null, availabilityError: null,
    mountTerminal: async () => ({ dispose() {} }),
  },
} satisfies Meta<typeof AgentTab>
export default meta
type Story = StoryObj<typeof meta>

export const ProjectRequired: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByLabelText('Pull request review agent')).toBeVisible()
    await expect(canvas.getByText(/A local OpenForge Project linked to this repository is required/)).toBeVisible()
  },
}
