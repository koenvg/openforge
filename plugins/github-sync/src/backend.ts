import { defineBackendPlugin } from '@openforge/plugin-sdk/backend'
import type { BackendOpenForgeAPI } from '@openforge/plugin-sdk/backend'
import type {
  AgentReviewComment,
  AuthoredPullRequest,
  PollResult,
  PrFileDiff,
  PrOverviewComment,
  ReviewComment,
  ReviewPullRequest,
} from '@openforge/plugin-sdk/domain'
import type { FileAtRefRequest, FileContentRequest, PullRequestRepositoryRequest, SubmitPullRequestReviewRequest } from './review/pr/githubSyncClient'

const HOST_COMMAND_NAMESPACE = ['open', 'forge'].join('')

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
  },
})
