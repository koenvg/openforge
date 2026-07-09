import { defineBackendPlugin } from '@openforge-app/plugin-sdk/backend'
import type { BackendOpenForgeAPI } from '@openforge-app/plugin-sdk/backend'
import type {
  AgentReviewComment,
  AuthoredPullRequest,
  PollResult,
  PrFileDiff,
  PrOverviewComment,
  PrWalkthrough,
  ReviewComment,
  ReviewPullRequest,
} from '@openforge-app/plugin-sdk/domain'
import type { FileAtRefRequest, FileContentRequest, PullRequestRepositoryRequest, SubmitPullRequestReviewRequest } from './review/pr/githubSyncClient'
import { randomUUID } from 'node:crypto'
import {
  beginWalkthroughGeneration,
  readWalkthrough,
  removeWalkthrough,
  runWalkthroughGeneration,
} from './lib/walkthroughStore'

const HOST_COMMAND_NAMESPACE = ['open', 'forge'].join('')

// Model used for headless walkthrough generation (passed to `claude --model`).
// Sonnet balances quality and speed for the "split this PR into steps" task.
const WALKTHROUGH_MODEL = 'sonnet'

type HostCommandPayload = Record<string, unknown> | null

function hostCommandId(command: string): string {
  return `${HOST_COMMAND_NAMESPACE}.${command}`
}

function invokeHostCommand<TOutput>(openforge: BackendOpenForgeAPI, command: string, payload?: HostCommandPayload): Promise<TOutput> {
  return openforge.commands.invokeGlobal<TOutput>(hostCommandId(command), payload ?? null)
}

export default defineBackendPlugin({
  activate(openforge, context) {
    context.subscriptions.add(openforge.backend.registerMethod<null, PollResult>('forceGithubSync', {
      handler: () => invokeHostCommand<PollResult>(openforge, 'forceGithubSync'),
    }))

    context.subscriptions.add(openforge.backend.registerMethod<null, ReviewPullRequest[]>('fetchReviewPrs', {
      handler: () => invokeHostCommand<ReviewPullRequest[]>(openforge, 'fetchReviewPrs'),
    }))

    context.subscriptions.add(openforge.backend.registerMethod<null, ReviewPullRequest[]>('getReviewPrs', {
      handler: () => invokeHostCommand<ReviewPullRequest[]>(openforge, 'getReviewPrs'),
    }))

    context.subscriptions.add(openforge.backend.registerMethod<null, AuthoredPullRequest[]>('fetchAuthoredPrs', {
      handler: () => invokeHostCommand<AuthoredPullRequest[]>(openforge, 'fetchAuthoredPrs'),
    }))

    context.subscriptions.add(openforge.backend.registerMethod<null, AuthoredPullRequest[]>('getAuthoredPrs', {
      handler: () => invokeHostCommand<AuthoredPullRequest[]>(openforge, 'getAuthoredPrs'),
    }))

    context.subscriptions.add(openforge.backend.registerMethod<{ prId: number; headSha: string }, void>('markReviewPrViewed', {
      handler: (request) => invokeHostCommand<void>(openforge, 'markReviewPrViewed', request),
    }))

    context.subscriptions.add(openforge.backend.registerMethod<{ prId: number }, void>('markReviewPrUnviewed', {
      handler: (request) => invokeHostCommand<void>(openforge, 'markReviewPrUnviewed', request),
    }))

    context.subscriptions.add(openforge.backend.registerMethod<PullRequestRepositoryRequest, PrFileDiff[]>('getPrFileDiffs', {
      handler: (request) => invokeHostCommand<PrFileDiff[]>(openforge, 'getPrFileDiffs', request),
    }))

    context.subscriptions.add(openforge.backend.registerMethod<FileContentRequest, string>('getFileContent', {
      handler: (request) => invokeHostCommand<string>(openforge, 'getFileContent', request),
    }))

    context.subscriptions.add(openforge.backend.registerMethod<FileContentRequest, string>('getFileContentBase64', {
      handler: (request) => invokeHostCommand<string>(openforge, 'getFileContentBase64', request),
    }))

    context.subscriptions.add(openforge.backend.registerMethod<FileAtRefRequest, string>('getFileAtRef', {
      handler: (request) => invokeHostCommand<string>(openforge, 'getFileAtRef', request),
    }))

    context.subscriptions.add(openforge.backend.registerMethod<FileAtRefRequest, string>('getFileAtRefBase64', {
      handler: (request) => invokeHostCommand<string>(openforge, 'getFileAtRefBase64', request),
    }))

    context.subscriptions.add(openforge.backend.registerMethod<PullRequestRepositoryRequest, ReviewComment[]>('getReviewComments', {
      handler: (request) => invokeHostCommand<ReviewComment[]>(openforge, 'getReviewComments', request),
    }))

    context.subscriptions.add(openforge.backend.registerMethod<PullRequestRepositoryRequest, PrOverviewComment[]>('getPrOverviewComments', {
      handler: (request) => invokeHostCommand<PrOverviewComment[]>(openforge, 'getPrOverviewComments', request),
    }))

    context.subscriptions.add(openforge.backend.registerMethod<SubmitPullRequestReviewRequest, void>('submitPrReview', {
      handler: (request) => invokeHostCommand<void>(openforge, 'submitPrReview', request),
    }))

    context.subscriptions.add(openforge.backend.registerMethod<{ reviewPrId: number }, AgentReviewComment[]>('getAgentReviewComments', {
      handler: (request) => invokeHostCommand<AgentReviewComment[]>(openforge, 'getAgentReviewComments', request),
    }))

    context.subscriptions.add(openforge.backend.registerMethod<{ commentId: number; status: string }, void>('updateAgentReviewCommentStatus', {
      handler: (request) => invokeHostCommand<void>(openforge, 'updateAgentReviewCommentStatus', request),
    }))

    // The walkthrough feature is owned entirely by this plugin: the cache lives
    // in plugin storage and generation runs via the generic core `agentGenerate`
    // primitive. No walkthrough-specific code exists in the core sidecar.
    context.subscriptions.add(openforge.backend.registerMethod<{ reviewPrId: number; headSha: string }, PrWalkthrough | null>('getPrWalkthrough', {
      handler: (request) => readWalkthrough(openforge, request.reviewPrId, request.headSha),
    }))

    context.subscriptions.add(openforge.backend.registerMethod<{ reviewPrId: number; headSha: string }, void>('deletePrWalkthrough', {
      handler: (request) => removeWalkthrough(openforge, request.reviewPrId, request.headSha),
    }))

    context.subscriptions.add(openforge.backend.registerMethod<{
      repoOwner: string
      repoName: string
      prNumber: number
      headRef: string
      baseRef: string
      prTitle: string
      prBody: string | null
      headSha: string
      reviewPrId: number
      prompt: string
      projectId: string | null
    }, { walkthrough_session_key: string }>('startAgentWalkthrough', {
      handler: async (request) => {
        const sessionKey = randomUUID()
        const params = { prId: request.reviewPrId, headSha: request.headSha, sessionKey, prompt: request.prompt }
        await beginWalkthroughGeneration(openforge, params)
        // Kick off generation in the background so the UI gets its session key
        // immediately and can render the optimistic "generating" state.
        // Forward the active project id so the sidecar resolves this project's
        // AI provider (not the global fallback) for the headless generation.
        void runWalkthroughGeneration(openforge, params, (key, prompt) =>
          invokeHostCommand<{ text: string }>(openforge, 'agentGenerate', {
            sessionKey: key,
            prompt,
            model: WALKTHROUGH_MODEL,
            projectId: request.projectId,
          }).then((result) => result?.text ?? ''),
        )
        return { walkthrough_session_key: sessionKey }
      },
    }))

    context.subscriptions.add(openforge.backend.registerMethod<{ walkthroughSessionKey: string }, void>('abortAgentWalkthrough', {
      handler: async (request) => {
        // Cancel the in-flight generation; the awaiting runWalkthroughGeneration
        // call then rejects and marks the cached row as errored/aborted.
        await invokeHostCommand<{ aborted: boolean }>(openforge, 'abortAgentGenerate', {
          sessionKey: request.walkthroughSessionKey,
        }).catch(() => undefined)
      },
    }))
  },
})
