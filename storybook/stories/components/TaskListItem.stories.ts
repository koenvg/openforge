import type { Meta, StoryObj } from '@storybook/svelte-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
import TaskListItem from '../../../src/components/focus-board/TaskListItem.svelte'
import TaskListItemGallery from './TaskListItemGallery.svelte'
import { createPullRequest, createTask } from '../../shared/fixtures/appFixtures'

const meta = {
  title: 'Components/Board/Task List Item',
  component: TaskListItem,
  args: {
    task: createTask({ title: 'Normalize the greeting' }), state: 'idle', session: null,
    pullRequests: [], reasonText: 'Implementation is ready for review.',
    isSelected: false, isFocused: false, isMerging: false,
    onSelect: fn(), onContextMenu: fn(),
  },
} satisfies Meta<typeof TaskListItem>
export default meta
type Story = StoryObj<typeof meta>

function galleryPlay(expectedCount: number) {
  return async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement)
    const cases = canvas.getAllByRole('article')
    const viewport = canvasElement.ownerDocument.documentElement

    await expect(cases).toHaveLength(expectedCount)
    for (const item of cases) {
      await expect(item).toBeVisible()
      const bounds = item.getBoundingClientRect()
      expect(bounds.left).toBeGreaterThanOrEqual(0)
      expect(bounds.top).toBeGreaterThanOrEqual(0)
      expect(Math.ceil(bounds.right)).toBeLessThanOrEqual(viewport.clientWidth)
      expect(Math.ceil(bounds.bottom)).toBeLessThanOrEqual(viewport.clientHeight)
    }
  }
}

export const Idle: Story = {}
export const Backlog: Story = { args: { state: 'backlog', task: createTask({ status: 'backlog' }) } }
export const Active: Story = { args: { state: 'active' } }
export const NeedsInput: Story = { args: { state: 'needs-input', hasUnreadAgentOutput: true, reasonText: 'Choose how to handle an empty name.' } }
export const Paused: Story = { args: { state: 'paused' } }
export const AgentDone: Story = { args: { state: 'agent-done' } }
export const Failed: Story = { args: { state: 'failed' } }
export const Interrupted: Story = { args: { state: 'interrupted' } }
export const Done: Story = { args: { state: 'done', task: createTask({ status: 'done' }) } }
export const PrDraft: Story = { args: { state: 'pr-draft', pullRequests: [createPullRequest({ draft: true })] } }
export const PrOpen: Story = { args: { state: 'pr-open', pullRequests: [createPullRequest()] } }
export const CiFailed: Story = { args: { state: 'ci-failed', pullRequests: [createPullRequest()] } }
export const ChangesRequested: Story = { args: { state: 'changes-requested', pullRequests: [createPullRequest()] } }
export const ReadyToMerge: Story = { args: { state: 'ready-to-merge', pullRequests: [createPullRequest()] } }
export const ReadyToEnqueue: Story = { args: { state: 'ready-to-enqueue', pullRequests: [createPullRequest()] } }
export const PrQueued: Story = { args: { state: 'pr-queued', pullRequests: [createPullRequest()] } }
export const PrMerged: Story = { args: { state: 'pr-merged', pullRequests: [createPullRequest({ state: 'merged' })] } }
export const PrClosed: Story = { args: { state: 'pr-closed', pullRequests: [createPullRequest({ state: 'closed' })] } }
export const CiRunning: Story = { args: { state: 'ci-running', pullRequests: [createPullRequest()] } }
export const ReviewPending: Story = { args: { state: 'review-pending', pullRequests: [createPullRequest()] } }
export const UnaddressedComments: Story = { args: { state: 'unaddressed-comments', pullRequests: [createPullRequest({ unaddressed_comment_count: 3 })] } }
export const MergeConflict: Story = { args: { state: 'merge-conflict', pullRequests: [createPullRequest()] } }
export const Merging: Story = { args: { state: 'ready-to-merge', isMerging: true, pullRequests: [createPullRequest()] } }
export const AgentWorkflowGallery: Story = {
  render: () => ({ Component: TaskListItemGallery, props: { gallery: 'agent-workflow' } }),
  play: galleryPlay(9),
}
export const PullRequestProgressGallery: Story = {
  render: () => ({ Component: TaskListItemGallery, props: { gallery: 'pull-request-progress' } }),
  play: galleryPlay(9),
}
export const PullRequestAttentionGallery: Story = {
  render: () => ({ Component: TaskListItemGallery, props: { gallery: 'pull-request-attention' } }),
  play: galleryPlay(5),
}
export const Selected: Story = { args: { isSelected: true, isFocused: true } }
export const Dependency: Story = { args: { state: 'backlog', task: createTask({ status: 'backlog', dependsOn: ['T-41'] }), dependencyHint: 'Waiting for T-41: Define the greeting API' } }
export const LongContent: Story = { args: {
  task: createTask({ title: 'Preserve keyboard navigation and long task titles across all constrained project workspaces and task inspectors', labels: [{ id: 1, projectId: 'project-1', name: 'accessibility' }, { id: 2, projectId: 'project-1', name: 'release-blocker' }] }),
  showLabels: true, reasonText: 'The integration needs a decision before continuing. Review the failing test and choose whether to return a default greeting or report a validation error.',
} }
export const KeyboardSelection: Story = {
  play: async ({ canvasElement, args }) => {
    const row = within(canvasElement).getByRole('button', { name: /Normalize the greeting/ })
    row.focus()
    await userEvent.keyboard('{Enter}')
    await expect(args.onSelect).toHaveBeenCalledTimes(1)
  },
}
