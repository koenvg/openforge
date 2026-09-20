import type { Meta, StoryObj } from '@storybook/svelte-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import PrReviewRowAction from '../../../plugins/github-sync/src/review/pr/PrReviewRowAction.svelte'
import { activeReviewRequest } from '../../shared/fixtures/githubSyncReviewFixtures'
import { githubSyncScenario } from '../../shared/fixtures/githubSyncScenario'
import GitHubSyncContributionFrame from '../../shared/frames/GitHubSyncContributionFrame.svelte'
import { getStoryScenario } from '../../shared/storyEnvironmentPreview'

const meta = {
  title: 'Pages/GitHub Sync/Review Row Action',
  component: PrReviewRowAction,
  parameters: { openforge: githubSyncScenario('connected') },
  decorators: [() => ({
    Component: GitHubSyncContributionFrame,
    props: { host: 'review-row', pr: activeReviewRequest },
  })],
  render: (_args, context) => {
    const plugin = getStoryScenario(context).plugin
    return {
      Component: PrReviewRowAction,
      props: { api: plugin.api, context: plugin.context, pr: activeReviewRequest, projectId: 'project-1' },
    }
  },
} satisfies Meta<typeof PrReviewRowAction>

export default meta
type Story = StoryObj<typeof meta>

export const Available: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).findByRole('button', { name: 'Generate walkthrough and AI review' }))
      .resolves.toBeVisible()
  },
}

export const UnavailableWithoutLocalProject: Story = {
  parameters: { openforge: githubSyncScenario('row-unavailable') },
  play: async (context) => {
    await waitFor(() => expect(getStoryScenario(context).plugin.calls.backendInvocations.map(call => call.method))
      .toContain('resolveProjectIdsByRepo'))
    await expect(within(context.canvasElement).queryByRole('button', { name: 'Generate walkthrough and AI review' }))
      .not.toBeInTheDocument()
  },
}

export const Generating: Story = {
  parameters: { openforge: githubSyncScenario('row-generating') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.findByLabelText('Generating walkthrough')).resolves.toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Stop walkthrough generation' })).toBeVisible()
  },
}

export const GenerateWithLocalResponse: Story = {
  play: async (context) => {
    const canvas = within(context.canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Generate walkthrough and AI review' }))
    await expect(canvas.findByLabelText('Generating walkthrough')).resolves.toBeVisible()
    const plugin = getStoryScenario(context).plugin
    await expect(plugin.calls.backendInvocations.map(call => call.method)).toContain('startAgentWalkthrough')
    await expect(plugin.calls.openUrl).toEqual([])
  },
}

export const StopGeneration: Story = {
  parameters: { openforge: githubSyncScenario('row-generating') },
  play: async (context) => {
    const canvas = within(context.canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Stop walkthrough generation' }))
    await expect(canvas.findByRole('button', { name: 'Generate walkthrough and AI review' })).resolves.toBeVisible()
    await expect(getStoryScenario(context).plugin.calls.backendInvocations.map(call => call.method))
      .toContain('abortAgentWalkthrough')
  },
}
