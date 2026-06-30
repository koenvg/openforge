import { defineFrontendPlugin } from '@openforge/plugin-sdk/frontend'
import PrReviewView from './review/pr/PrReviewView.svelte'
import { createGithubSyncPrReviewClient } from './review/pr/githubSyncClient'

export const PrReviewViewComponent = PrReviewView

export default defineFrontendPlugin({
  activate(openforge, context) {
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

    const navigation = openforge.navigation.get()
    if (navigation.activeProjectId) {
      void githubSync.syncPullRequests()
    }
  },
})
