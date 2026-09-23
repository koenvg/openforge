import type { BackendMethodRegistration } from '@openforge-app/plugin-sdk/backend'
import type { WalkthroughRecordV1 } from '../../../plugins/github-sync/src/lib/walkthroughRecord'
import type { StoryScenarioDefinition } from '../storyEnvironmentPreview'
import { activeReviewRequest, authoredReviewRequest, reviewedReviewRequest, viewedReviewRequest } from './githubSyncReviewFixtures'
import { createReviewDiff, reviewFileContents } from './reviewFixtures'

const readyWalkthrough: WalkthroughRecordV1 = {
  version: 1, prId: activeReviewRequest.id,
  scope: { namespace: 'github', targetKey: 'gh:openforge/openforge#42', revision: activeReviewRequest.head_sha },
  attemptId: 'catalog-walkthrough', state: 'ready',
  steps: [{ id: 'step-1', title: 'Review greeting behavior', summary: 'Keep greetings consistent for each reviewer.',
    files: [{ filename: 'src/greet.ts', hunk_indexes: null }] }],
  error: null, createdAt: 1_767_344_000, updatedAt: 1_767_346_000,
}

export function githubSyncPrReviewScenario(scope: 'global' | 'project' = 'global', walkthrough = false): StoryScenarioDefinition {
  return {
    plugin: {
      pluginId: 'com.openforge.github-sync',
      projectId: scope === 'global' ? null : 'project-1',
      viewId: scope === 'global' ? 'pr_review_global' : 'pr_review',
      backendMethods: (): Record<string, BackendMethodRegistration> => ({
        resolveProjectIdsByRepo: { handler: async () => ({ 'openforge/openforge': 'project-1' }) },
        getReviewPrs: { handler: async () => [activeReviewRequest, viewedReviewRequest, reviewedReviewRequest] },
        fetchReviewPrs: { handler: async () => [activeReviewRequest, viewedReviewRequest, reviewedReviewRequest] },
        getAuthoredPrs: { handler: async () => [authoredReviewRequest] },
        fetchAuthoredPrs: { handler: async () => [authoredReviewRequest] },
        markReviewPrViewed: { handler: async () => undefined },
        getPrFileDiffs: { handler: async () => [createReviewDiff()] },
        getReviewComments: { handler: async () => [] },
        getPrOverviewComments: { handler: async () => [] },
        getPrWalkthrough: { handler: async (payload) => walkthrough &&
          (payload as { reviewPrId: number }).reviewPrId === activeReviewRequest.id ? readyWalkthrough : null },
        getPrTicket: { handler: async () => ({ snapshot: null, jiraConfigured: false }) },
        getFileContent: { handler: async () => reviewFileContents.newContent },
        getFileAtRef: { handler: async () => reviewFileContents.oldContent },
      }),
    },
  }
}
