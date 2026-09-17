import type { Meta, StoryObj } from '@storybook/svelte-vite'
import { expect, fn, within } from 'storybook/test'
import PrReviewListSection from '../../../plugins/github-sync/src/review/pr/PrReviewListSection.svelte'
import WorkspaceComponentFrame from '../../shared/frames/WorkspaceComponentFrame.svelte'
import {
  activeReviewRequest,
  closedReviewRequest,
  mergedReviewRequest,
  viewedReviewRequest,
} from '../../shared/fixtures/githubSyncReviewFixtures'

const activeRequests = [activeReviewRequest, viewedReviewRequest]
const finishedRequests = [mergedReviewRequest, closedReviewRequest]
const allReviewRequests = [...activeRequests, ...finishedRequests]
const repository = 'openforge/openforge'

const meta = {
  title: 'Components/GitHub Sync/Review Requests',
  component: PrReviewListSection,
  decorators: [() => ({ Component: WorkspaceComponentFrame })],
  args: {
    headerTitle: 'Pull Requests',
    headerSubtitle: 'Review requests and pull requests you authored',
    projectName: 'OpenForge',
    showFilters: false,
    projectHasNoRepo: false,
    excludedRepos: new Set<string>(),
    showFilterDropdown: false,
    newRepoInput: '',
    suggestedRepos: [],
    isLoading: false,
    isLoadingAuthored: false,
    error: null,
    authoredError: null,
    githubTokenConfigured: true,
    reviewRequests: {
      activeCount: activeRequests.length,
      filtered: allReviewRequests,
      finishedCount: finishedRequests.length,
      groupedActive: new Map([[repository, activeRequests]]),
      groupedFinished: new Map([[repository, finishedRequests]]),
      keyboardNavigable: activeRequests,
    },
    filteredAuthoredPrs: [],
    allReviewPrs: allReviewRequests,
    allAuthoredPrs: [],
    hiddenReviewRepos: [],
    hiddenAuthoredRepos: [],
    groupedAuthoredPrs: new Map(),
    focusedIndex: -1,
    onToggleFilterDropdown: fn(),
    onCloseFilterDropdown: fn(),
    onNewRepoInputChange: fn(),
    onAddExcludedRepo: fn(),
    onRemoveExcludedRepo: fn(),
    onRefreshPrs: fn(),
    onRefreshAuthoredPrs: fn(),
    onOpenGithubSettings: fn(),
    onOpenRepositoryFilters: fn(),
    onSelectPr: fn(),
    onMarkUnread: fn(),
    onRemove: fn(),
    onOpenAuthoredPr: fn(),
    pluralize: (count: number, singular: string, plural = `${singular}s`) => count === 1 ? singular : plural,
    walkthroughByPr: new Map(),
    canGenerateWalkthrough: () => true,
    onGenerateWalkthrough: fn(),
    onStopWalkthrough: fn(),
  },
} satisfies Meta<typeof PrReviewListSection>
export default meta

type Story = StoryObj<typeof meta>

export const ActiveAndFinished: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByLabelText('2 active review requests')).toHaveTextContent('2')
    await expect(canvas.getAllByLabelText('Unread review request')).toHaveLength(1)
    await expect(canvas.getByText(activeReviewRequest.title)).toBeVisible()

    const finishedToggle = canvas.getByRole('button', { name: 'Finished (2)' })
    await expect(finishedToggle).toHaveAttribute('aria-expanded', 'true')
    const mergedTitle = canvas.getByText(mergedReviewRequest.title)
    const closedTitle = canvas.getByText(closedReviewRequest.title)
    await expect(mergedTitle).toBeVisible()
    await expect(closedTitle).toBeVisible()
    await expect(mergedTitle.closest('.vim-focus')).toBeNull()
    await expect(closedTitle.closest('.vim-focus')).toBeNull()
    await expect(canvas.getAllByRole('button', { name: 'Generate walkthrough and AI review' })).toHaveLength(2)
  },
}
