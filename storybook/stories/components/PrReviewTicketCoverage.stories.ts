import type { Meta, StoryObj } from '@storybook/svelte-vite'
import { expect, fn, within } from 'storybook/test'
import TicketCoveragePanel from '../../../plugins/github-sync/src/review/pr/TicketCoveragePanel.svelte'

const meta = {
  title: 'Components/PR Review Ticket Coverage', component: TicketCoveragePanel,
  args: {
    snapshot: null, coverage: null, jiraConfigured: false,
    includedFindingIds: new Set<string>(), onOpenUrl: fn(), onSetIssueKey: fn(),
    onRegenerate: fn(), onToggleFinding: fn(),
  },
} satisfies Meta<typeof TicketCoveragePanel>
export default meta
type Story = StoryObj<typeof meta>

export const JiraDisconnected: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/Jira is not connected/)).toBeVisible()
  },
}
