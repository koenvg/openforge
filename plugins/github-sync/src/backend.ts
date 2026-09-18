import { defineBackendPlugin } from '@openforge-app/plugin-sdk/backend'
import type { BackendOpenForgeAPI } from '@openforge-app/plugin-sdk/backend'
import type { AuthoredPullRequest, PollResult, PullRequestMergeMethod, PrFileDiff, PrOverviewComment, ReviewComment, ReviewPullRequest } from '@openforge-app/plugin-sdk/domain'
import type { ResolvedMarkdownMedia } from '@openforge-app/plugin-sdk/markdown'
import type { Base64FileContentResult, CreateReviewCommentRequest, FileAtRefRequest, FileContentRequest, GithubAssetRequest, PullRequestRepositoryRequest, ReplyToReviewCommentRequest, SubmitPullRequestReviewRequest } from './review/pr/githubSyncClient'

type TaskPullRequestActionRequest = {
  taskId: string
  prId: number
  expectedHeadSha: string
  mergeMethod?: PullRequestMergeMethod
}
import { randomUUID } from 'node:crypto'
import {
  readWalkthrough,
  removeWalkthrough,
} from './lib/walkthroughStore'
import { compileWalkthroughPrompt } from './lib/walkthroughPrompt'
import {
  EMPTY_JIRA_CONFIG,
  isJiraConfigured,
  readJiraConfig,
  readJiraKeyOverride,
  readTicketSnapshot,
  writeJiraConfig,
  writeJiraKeyOverride,
  writeTicketSnapshot,
  type JiraConfig,
} from './lib/jiraStore'
import { resolveTicketSnapshot } from './lib/jiraTicket'
import type { JiraWorkItem, TicketSnapshot } from './lib/ticketCoverage'
import {
  buildWalkthroughValidationSnapshot,
  submitWalkthroughStep,
  type SubmitWalkthroughStepInput,
  type WalkthroughRecordV1,
  type WalkthroughSubmissionResult,
} from './lib/walkthroughRecord'
import { reviewScopeForPullRequest } from './review/pr/reviewScope'
import { WalkthroughGenerationCoordinator } from './lib/walkthroughGeneration'

const HOST_COMMAND_NAMESPACE = ['open', 'forge'].join('')

type HostCommandPayload = Record<string, unknown> | null

function hostCommandId(command: string): string {
  return `${HOST_COMMAND_NAMESPACE}.${command}`
}

function invokeHostCommand<TOutput>(openforge: BackendOpenForgeAPI, command: string, payload?: HostCommandPayload): Promise<TOutput> {
  return openforge.commands.invokeGlobal<TOutput>(hostCommandId(command), payload ?? null)
}

async function resolveProjectIdsByRepo(openforge: BackendOpenForgeAPI): Promise<Record<string, string>> {
  const projects = await openforge.projects.list()
  const resolved = await Promise.all(projects.map(async project => ({
    projectId: project.id,
    repo: await invokeHostCommand<{ owner: string; name: string } | null>(
      openforge,
      'getProjectRepo',
      { projectId: project.id },
    ),
  })))

  const projectIdsByRepo: Record<string, string> = {}
  for (const candidate of resolved) {
    if (!candidate.repo) continue
    const key = `${candidate.repo.owner}/${candidate.repo.name}`.toLowerCase()
    projectIdsByRepo[key] ??= candidate.projectId
  }
  return projectIdsByRepo
}

/** Whether the Jira API token is present in the keychain. Never returns the token. */
async function jiraTokenConfigured(openforge: BackendOpenForgeAPI): Promise<boolean> {
  const status = await invokeHostCommand<{ configured: boolean }>(
    openforge,
    'getJiraApiTokenStatus',
  ).catch(() => ({ configured: false }))
  return status?.configured === true
}

export default defineBackendPlugin({
  activate(openforge, context) {
    const walkthroughGeneration = new WalkthroughGenerationCoordinator(openforge, randomUUID)
    context.subscriptions.add(walkthroughGeneration)
    context.subscriptions.add(openforge.commands.register<SubmitWalkthroughStepInput, WalkthroughSubmissionResult>({
      id: 'submit-walkthrough-step',
      title: 'Submit walkthrough step',
      discoverable: false,
      agent: {
        description: 'Submit one complete pull request walkthrough step for the active review attempt. Correct the reported field and retry the same step id when rejected.',
        discoverable: false,
        examples: [{
          attemptId: 'attempt-id-from-the-review-prompt',
          step: {
            id: 'setup',
            title: 'Set up the new flow',
            summary: 'Introduces the entry point and supporting state.',
            files: [{ filename: 'src/feature.ts', hunk_indexes: [0] }],
          },
        }],
      },
      input: {
        type: 'object',
        required: ['attemptId', 'step'],
        additionalProperties: false,
        properties: {
          attemptId: { type: 'string' },
          step: {
            type: 'object',
            required: ['id', 'title', 'summary', 'files'],
            additionalProperties: false,
            properties: {
              id: { type: 'string' },
              title: { type: 'string' },
              summary: { type: 'string' },
              files: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['filename', 'hunk_indexes'],
                  additionalProperties: false,
                  properties: {
                    filename: { type: 'string' },
                    hunk_indexes: {
                      oneOf: [
                        { type: 'null' },
                        { type: 'array', items: { type: 'integer' } },
                      ],
                    },
                  },
                },
              },
            },
          },
        },
      },
      output: {
        oneOf: [
          {
            type: 'object',
            required: ['accepted', 'attemptId', 'stepId', 'scopeRevision', 'position', 'replaced'],
            additionalProperties: false,
            properties: {
              accepted: { const: true },
              attemptId: { type: 'string' },
              stepId: { type: 'string' },
              scopeRevision: { type: 'string' },
              position: { type: 'integer' },
              replaced: { type: 'boolean' },
            },
          },
          {
            type: 'object',
            required: ['accepted', 'rejection'],
            additionalProperties: false,
            properties: {
              accepted: { const: false },
              rejection: {
                type: 'object',
                required: ['code', 'attemptId', 'stepId', 'scopeRevision', 'field', 'rejectedValue', 'constraint'],
                additionalProperties: false,
                properties: {
                  code: { type: 'string' },
                  attemptId: { oneOf: [{ type: 'string' }, { type: 'null' }] },
                  stepId: { oneOf: [{ type: 'string' }, { type: 'null' }] },
                  scopeRevision: { oneOf: [{ type: 'string' }, { type: 'null' }] },
                  field: { type: 'string' },
                  constraint: { type: 'string' },
                  rejectedValue: {},
                  file: { type: 'string' },
                  hunkCount: { type: 'integer' },
                  validHunkRange: {
                    oneOf: [
                      { type: 'null' },
                      {
                        type: 'object',
                        required: ['min', 'max'],
                        additionalProperties: false,
                        properties: { min: { type: 'integer' }, max: { type: 'integer' } },
                      },
                    ],
                  },
                },
              },
            },
          },
        ],
      },
      handler: (input, invocation) => submitWalkthroughStep(openforge, input, invocation),
    }))

    context.subscriptions.add(openforge.backend.registerMethod<null, Record<string, string>>('resolveProjectIdsByRepo', {
      handler: () => resolveProjectIdsByRepo(openforge),
    }))

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

    context.subscriptions.add(openforge.backend.registerMethod<{ prId: number }, void>('dismissReviewPr', {
      handler: (request) => invokeHostCommand<void>(openforge, 'dismissReviewPr', request),
    }))

    context.subscriptions.add(openforge.backend.registerMethod<PullRequestRepositoryRequest, PrFileDiff[]>('getPrFileDiffs', {
      handler: (request) => invokeHostCommand<PrFileDiff[]>(openforge, 'getPrFileDiffs', request),
    }))

    context.subscriptions.add(openforge.backend.registerMethod<FileContentRequest, string>('getFileContent', {
      handler: (request) => invokeHostCommand<string>(openforge, 'getFileContent', request),
    }))

    context.subscriptions.add(openforge.backend.registerMethod<FileContentRequest, Base64FileContentResult>('getFileContentBase64', {
      handler: (request) => invokeHostCommand<Base64FileContentResult>(openforge, 'getFileContentBase64', request),
    }))

    context.subscriptions.add(openforge.backend.registerMethod<FileAtRefRequest, string>('getFileAtRef', {
      handler: (request) => invokeHostCommand<string>(openforge, 'getFileAtRef', request),
    }))

    context.subscriptions.add(openforge.backend.registerMethod<FileAtRefRequest, Base64FileContentResult>('getFileAtRefBase64', {
      handler: (request) => invokeHostCommand<Base64FileContentResult>(openforge, 'getFileAtRefBase64', request),
    }))

    context.subscriptions.add(openforge.backend.registerMethod<GithubAssetRequest, ResolvedMarkdownMedia | null>('resolveGithubAsset', {
      handler: (request) => invokeHostCommand<ResolvedMarkdownMedia | null>(openforge, 'resolveGithubAsset', request),
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

    context.subscriptions.add(openforge.backend.registerMethod<ReplyToReviewCommentRequest, ReviewComment>('replyToReviewComment', {
      handler: (request) => invokeHostCommand<ReviewComment>(openforge, 'replyToReviewComment', request),
    }))

    context.subscriptions.add(openforge.backend.registerMethod<CreateReviewCommentRequest, void>('createReviewComment', {
      handler: (request) => invokeHostCommand<void>(openforge, 'createReviewComment', request),
    }))

    // The walkthrough feature is owned entirely by this plugin. Its cache lives
    // in plugin storage and generation runs in the scope-bound Agent Session.
    context.subscriptions.add(openforge.backend.registerMethod<{ reviewPrId: number; headSha: string }, WalkthroughRecordV1 | null>('getPrWalkthrough', {
      handler: (request) => readWalkthrough(openforge, request.reviewPrId, request.headSha, {
        scope: async () => {
          const pullRequest = (await invokeHostCommand<ReviewPullRequest[]>(openforge, 'getReviewPrs'))
            .find(candidate => candidate.id === request.reviewPrId)
          if (!pullRequest) throw new Error('Walkthrough scope unavailable: pull request not found')
          return { ...reviewScopeForPullRequest(pullRequest), revision: request.headSha }
        },
        snapshot: async () => {
          const loadPullRequest = async (): Promise<ReviewPullRequest> => {
            const pullRequest = (await invokeHostCommand<ReviewPullRequest[]>(openforge, 'fetchReviewPrs'))
              .find(candidate => candidate.id === request.reviewPrId)
            if (!pullRequest) throw new Error('Walkthrough snapshot unavailable: pull request not found')
            return pullRequest
          }
          const pullRequest = await loadPullRequest()
          const scope = { ...reviewScopeForPullRequest(pullRequest), revision: request.headSha }
          return buildWalkthroughValidationSnapshot(
            scope,
            async () => (await loadPullRequest()).head_sha,
            () => invokeHostCommand<PrFileDiff[]>(openforge, 'getPrFileDiffs', {
              owner: pullRequest.repo_owner,
              repo: pullRequest.repo_name,
              prNumber: pullRequest.number,
            }),
          )
        },
      }),
    }))

    context.subscriptions.add(openforge.backend.registerMethod<{ reviewPrId: number; headSha: string }, void>('deletePrWalkthrough', {
      handler: request => removeWalkthrough(openforge, request.reviewPrId, request.headSha),
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
      projectId: string
      reviewGuidance: string
      walkthroughGuidance: string
    }, { attemptId: string }>('startAgentWalkthrough', {
      handler: async (request) => {
        const scope = reviewScopeForPullRequest({
          repo_owner: request.repoOwner,
          repo_name: request.repoName,
          number: request.prNumber,
          head_sha: request.headSha,
        })
        const loadHeadRevision = async (): Promise<string> => {
          const pullRequest = (await invokeHostCommand<ReviewPullRequest[]>(openforge, 'fetchReviewPrs'))
            .find(candidate => candidate.id === request.reviewPrId)
          if (!pullRequest) throw new Error('Walkthrough snapshot unavailable: pull request not found')
          return pullRequest.head_sha
        }
        let files: PrFileDiff[] = []
        const snapshot = await buildWalkthroughValidationSnapshot(
          scope,
          loadHeadRevision,
          async () => {
            files = await invokeHostCommand<PrFileDiff[]>(openforge, 'getPrFileDiffs', {
              owner: request.repoOwner, repo: request.repoName, prNumber: request.prNumber,
            })
            return files
          },
        )
        const existingComments = await invokeHostCommand<ReviewComment[]>(openforge, 'getReviewComments', {
          owner: request.repoOwner, repo: request.repoName, prNumber: request.prNumber,
        }).catch(() => [] as ReviewComment[])
        const ticketSnapshot = await resolveTicketSnapshot({
          config: await readJiraConfig(openforge),
          tokenConfigured: await jiraTokenConfigured(openforge),
          override: await readJiraKeyOverride(openforge, request.reviewPrId),
          pr: { head_ref: request.headRef, title: request.prTitle, body: request.prBody },
          fetchWorkItem: payload => invokeHostCommand<JiraWorkItem>(openforge, 'fetchJiraWorkItem', payload),
        })
        if (ticketSnapshot) {
          await writeTicketSnapshot(openforge, request.reviewPrId, request.headSha, ticketSnapshot)
        }
        const attemptId = await walkthroughGeneration.start({
          prId: request.reviewPrId,
          projectId: request.projectId,
          scope,
          snapshot,
          prompt: attemptId => compileWalkthroughPrompt({
            title: request.prTitle,
            body: request.prBody,
            files,
            existingComments,
            ticket: ticketSnapshot?.item ?? null,
            reviewGuidance: request.reviewGuidance,
            walkthroughGuidance: request.walkthroughGuidance,
            attemptId,
            scope,
          }),
        })
        return { attemptId }
      },
    }))

    // ---- Jira settings + ticket state -------------------------------------
    // The token is never read back out of the keychain; the UI only learns
    // whether one is stored.

    context.subscriptions.add(openforge.backend.registerMethod<
      null,
      { config: JiraConfig; tokenConfigured: boolean }
    >('getJiraSettings', {
      handler: async () => ({
        config: await readJiraConfig(openforge),
        tokenConfigured: await jiraTokenConfigured(openforge),
      }),
    }))

    context.subscriptions.add(openforge.backend.registerMethod<
      { config: JiraConfig; token?: string | null; clearToken?: boolean },
      { config: JiraConfig; tokenConfigured: boolean }
    >('saveJiraSettings', {
      handler: async (request) => {
        await writeJiraConfig(openforge, request.config ?? EMPTY_JIRA_CONFIG)

        if (request.clearToken) {
          await invokeHostCommand(openforge, 'clearJiraApiToken')
        } else if (request.token && request.token.trim().length > 0) {
          // Blank means "leave the stored token alone", so a user editing the
          // site URL doesn't have to retype their token.
          await invokeHostCommand(openforge, 'setJiraApiToken', { token: request.token.trim() })
        }

        return {
          config: await readJiraConfig(openforge),
          tokenConfigured: await jiraTokenConfigured(openforge),
        }
      },
    }))

    context.subscriptions.add(openforge.backend.registerMethod<
      null,
      { ok: boolean; displayName?: string; error?: string }
    >('testJiraConnection', {
      handler: async () => {
        const config = await readJiraConfig(openforge)
        if (config.baseUrl.trim().length === 0 || config.email.trim().length === 0) {
          return { ok: false, error: 'Add the Jira site URL and email first.' }
        }
        return invokeHostCommand<{ ok: boolean; displayName?: string; error?: string }>(
          openforge,
          'testJiraConnection',
          { baseUrl: config.baseUrl.trim(), email: config.email.trim() },
        ).catch((error: unknown) => ({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }))
      },
    }))

    context.subscriptions.add(openforge.backend.registerMethod<
      { reviewPrId: number; headSha: string },
      { snapshot: TicketSnapshot | null; jiraConfigured: boolean }
    >('getPrTicket', {
      handler: async (request) => ({
        snapshot: await readTicketSnapshot(openforge, request.reviewPrId, request.headSha),
        // Must match the condition generation uses, or the UI would offer a
        // ticket step for a PR whose generation silently skipped the ticket.
        jiraConfigured: isJiraConfigured(
          await readJiraConfig(openforge),
          await jiraTokenConfigured(openforge),
        ),
      }),
    }))

    context.subscriptions.add(openforge.backend.registerMethod<
      { reviewPrId: number; issueKey: string | null },
      void
    >('setPrJiraKey', {
      // Stored per PR, not per commit. The caller regenerates the walkthrough to
      // pick the new ticket up.
      handler: request => writeJiraKeyOverride(openforge, request.reviewPrId, request.issueKey),
    }))

    context.subscriptions.add(openforge.backend.registerMethod<{ attemptId: string }, void>('abortAgentWalkthrough', {
      handler: request => walkthroughGeneration.stopAttempt(request.attemptId),
    }))
    context.subscriptions.add(openforge.backend.registerMethod<{ taskId: string }, import('@openforge-app/plugin-sdk/domain').PullRequestInfo[]>('listTaskPullRequests', {
      handler: (request) => invokeHostCommand<import('@openforge-app/plugin-sdk/domain').PullRequestInfo[]>(openforge, 'getPullRequests', request),
    }))

    context.subscriptions.add(openforge.backend.registerMethod<{ taskId: string }, PollResult>('refreshTaskGithubStatus', {
      handler: (request) => invokeHostCommand<PollResult>(openforge, 'refreshTaskGithubStatus', request),
    }))

    context.subscriptions.add(openforge.backend.registerMethod<{ taskId: string; prUrl: string }, import('@openforge-app/plugin-sdk/domain').PullRequestInfo>('linkTaskPullRequest', {
      handler: (request) => invokeHostCommand<import('@openforge-app/plugin-sdk/domain').PullRequestInfo>(openforge, 'linkPullRequest', request),
    }))

    context.subscriptions.add(openforge.backend.registerMethod<{ prId: number }, import('@openforge-app/plugin-sdk/domain').PrComment[]>('getTaskPrComments', {
      handler: (request) => invokeHostCommand<import('@openforge-app/plugin-sdk/domain').PrComment[]>(openforge, 'getPrComments', request),
    }))

    context.subscriptions.add(openforge.backend.registerMethod<{ commentId: number }, void>('markTaskPrCommentAddressed', {
      handler: (request) => invokeHostCommand<void>(openforge, 'markCommentAddressed', request),
    }))

    context.subscriptions.add(openforge.backend.registerMethod<TaskPullRequestActionRequest, void>('mergeTaskPullRequest', {
      handler: (request) => invokeHostCommand<void>(openforge, 'mergeTaskPullRequest', request),
    }))

    context.subscriptions.add(openforge.backend.registerMethod<TaskPullRequestActionRequest, void>('enqueueTaskPullRequest', {
      handler: (request) => invokeHostCommand<void>(openforge, 'enqueueTaskPullRequest', request),
    }))
  },
})
