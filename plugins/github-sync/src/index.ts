import { defineFrontendPlugin } from '@openforge-app/plugin-sdk/frontend'
import type { ReviewPullRequest } from '@openforge-app/plugin-sdk/domain'
import PrReviewView from './review/pr/PrReviewView.svelte'
import PrReviewRowAction from './review/pr/PrReviewRowAction.svelte'
import { createGithubSyncPrReviewClient } from './review/pr/githubSyncClient'
import { pendingReviewPrOpen } from './lib/stores'
import TaskPullRequestStatus from './task/TaskPullRequestStatus.svelte'
import JiraSettingsSection from './settings/JiraSettingsSection.svelte'

export const PrReviewViewComponent = PrReviewView
export const PrReviewRowActionComponent = PrReviewRowAction
export const TaskPullRequestStatusComponent = TaskPullRequestStatus
export const JiraSettingsSectionComponent = JiraSettingsSection

export default defineFrontendPlugin({
  activate(openforge, context) {
    // Above the host's Changes card (order 50) on purpose: a pull request is what the
    // local changes turned into, so it reads after them rather than before.
    context.subscriptions.add(openforge.taskUI.registerSection({
      id: 'task_pull_request_status',
      order: 60,
      component: TaskPullRequestStatus,
    }))
    // The walkthrough control the plugin's own PR list shows, on every review row a host
    // surface renders (today the attention overview). It fetches its own state per pull
    // request, so the host hands it nothing but the row's `pr`.
    context.subscriptions.add(openforge.reviewUI.registerRowAction({
      id: 'pr_walkthrough',
      order: 10,
      component: PrReviewRowAction,
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

    // Global scope renders this inside the plugin's own card on the settings
    // page, so the Jira credentials disappear when GitHub Sync is turned off.
    context.subscriptions.add(openforge.settings.registerSection({
      id: 'jira',
      title: 'Jira',
      scope: 'global',
      order: 20,
      component: JiraSettingsSection,
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
