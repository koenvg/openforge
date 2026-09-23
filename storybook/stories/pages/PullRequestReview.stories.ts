import type { Meta, StoryObj } from '@storybook/svelte-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import PrReviewStoryView from '../../shared/frames/PrReviewStoryView.svelte'
import { githubSyncPrReviewScenario } from '../../shared/fixtures/githubSyncPrReviewScenario'
import PrReviewPageFrame from '../../shared/frames/PrReviewPageFrame.svelte'
import { getStoryScenario } from '../../shared/storyEnvironmentPreview'

const meta = {
  title: 'Pages/Pull Request Review',
  component: PrReviewStoryView,
  decorators: [() => ({ Component: PrReviewPageFrame })],
  parameters: { openforge: githubSyncPrReviewScenario() },
  // The render function injects the installed scenario; these defaults satisfy Storybook's required-args typing.
  args: { api: undefined!, context: undefined!, projectId: null },
  render: (_args, context) => {
    const { plugin } = getStoryScenario(context)
    return { Component: PrReviewStoryView, props: {
      api: plugin.api,
      context: plugin.context,
      projectId: context.parameters.reviewProjectId ?? null,
    } }
  },
} satisfies Meta<typeof PrReviewStoryView>
export default meta
type Story = StoryObj<typeof meta>

export const ReviewQueue: Story = {
  args: meta.args,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getByText('Keep review requests easy to scan')).toBeVisible())
  },
}

export const ChangedFiles: Story = {
  args: meta.args,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const title = await canvas.findByText('Keep review requests easy to scan')
    await userEvent.click(title.closest('button')!)
    await userEvent.click(await canvas.findByRole('tab', { name: /Files changed/i }))
    await waitFor(() => expect(canvas.getByText(/Hello,.*name.trim/)).toBeVisible(), { timeout: 10_000 })
  },
}

export const RepositoryFilters: Story = {
  args: meta.args,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getByText('Keep review requests easy to scan')).toBeVisible())
    await userEvent.click(canvas.getByRole('button', { name: 'Filter repositories' }))
    await waitFor(() => expect(canvas.getByRole('dialog', { name: 'Excluded repositories filter' })).toBeVisible())
  },
}

export const ProjectReviewQueue: Story = {
  args: meta.args,
  parameters: { reviewProjectId: 'project-1', openforge: githubSyncPrReviewScenario('project') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getByText('Keep review requests easy to scan')).toBeVisible())
  },
}

export const Walkthrough: Story = {
  args: meta.args,
  parameters: { openforge: githubSyncPrReviewScenario('global', true) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const title = await canvas.findByText('Keep review requests easy to scan')
    await userEvent.click(title.closest('button')!)
    await userEvent.click(await canvas.findByRole('tab', { name: 'Walkthrough' }))
    await userEvent.click(await canvas.findByRole('button', { name: '2' }))
    await waitFor(() => expect(canvas.getByRole('heading', { name: 'Review greeting behavior' })).toBeVisible(), { timeout: 10_000 })
  },
}
