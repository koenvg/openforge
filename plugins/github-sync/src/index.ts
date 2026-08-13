import { defineFrontendPlugin } from '@openforge-app/plugin-sdk/frontend'
import type { ReviewPullRequest } from '@openforge-app/plugin-sdk/domain'
import PrReviewView from './review/pr/PrReviewView.svelte'
import { createGithubSyncPrReviewClient } from './review/pr/githubSyncClient'
import { pendingReviewPrOpen } from './lib/stores'
import TaskPullRequestStatus from './task/TaskPullRequestStatus.svelte'

export const PrReviewViewComponent = PrReviewView
export const TaskPullRequestStatusComponent = TaskPullRequestStatus

export default defineFrontendPlugin({
  activate(openforge, context) {
    context.subscriptions.add(openforge.taskUI.registerSection({
      id: 'task_pull_request_status',
      order: 10,
      component: TaskPullRequestStatus,
    }))
    context.subscriptions.add(openforge.views.register({
      id: 'pr_review',
      title: 'Pull Requests',
      icon: 'git-pull-request',
      placement: 'rail',
      order: 20,
      shortcut: 'Cmd+G',
      component: PrReviewView,
    }))

    // A second, all-repos view rendered by the same component (it derives its
    // scope from the active view). Placed in the left projects sidebar rather
    // than the icon rail; the host surfaces it there with the PR count badges.
    // Cmd+Shift+G is the logical sibling of the project view's Cmd+G, with Shift
    // signalling the broader "all repos" scope.
    context.subscriptions.add(openforge.views.register({
      id: 'pr_review_global',
      title: 'All Pull Requests',
      icon: 'boxes',
      placement: 'sidebar',
      shortcut: 'Cmd+Shift+G',
      component: PrReviewView,
    }))

    const githubSync = createGithubSyncPrReviewClient(openforge)

    context.subscriptions.add(openforge.commands.register({
      id: 'refresh',
      title: 'Refresh Pull Requests',
      shortcut: 'Cmd+Shift+R',
      handler: async () => {
        await githubSync.syncPullRequests()
      },
    }))

    // Host entry point for opening a specific review-requested PR straight in the
    // detail view (used by the cross-project "Needs your attention" dialog). A PR
    // nested under a project opens that project's per-repo view; one with no local
    // project (`projectId` null) opens the all-repos view without switching project.
    // The active PrReviewView consumes `pendingReviewPrOpen` and loads the detail.
    context.subscriptions.add(openforge.commands.register({
      id: 'open_review_pr',
      title: 'Open Pull Request Review',
      handler: async (payload: unknown) => {
        const { pr, projectId } = payload as { pr: ReviewPullRequest; projectId: string | null }
        const viewId = projectId
          ? `plugin:${context.pluginId}:pr_review`
          : `plugin:${context.pluginId}:pr_review_global`
        await openforge.navigation.navigate({ viewId, projectId: projectId ?? undefined })
        pendingReviewPrOpen.set(pr)
      },
    }))

    const navigation = openforge.navigation.get()
    if (navigation.activeProjectId) {
      void githubSync.syncPullRequests()
    }
  },
})
