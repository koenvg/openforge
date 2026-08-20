import { defineBackendPlugin } from '@openforge-app/plugin-sdk/backend'
import type { BackendOpenForgeAPI } from '@openforge-app/plugin-sdk/backend'
import type {
  AgentReviewComment,
  AiThread,
  AuthoredPullRequest,
  PollResult,
  PrFileDiff,
  PrOverviewComment,
  PrWalkthrough,
  ReviewComment,
  ReviewPullRequest,
} from '@openforge-app/plugin-sdk/domain'
import type { FileAtRefRequest, FileContentRequest, PullRequestRepositoryRequest, SubmitPullRequestReviewRequest } from './review/pr/githubSyncClient'

type TaskPullRequestActionRequest = {
  taskId: string
  prId: number
  expectedHeadSha: string
}
import { randomUUID } from 'node:crypto'
import {
  beginWalkthroughGeneration,
  readWalkthrough,
  removeWalkthrough,
  runWalkthroughAndReviewGeneration,
} from './lib/walkthroughStore'
import {
  readAiReviewComments,
  removeAiReviewComments,
  updateAiReviewCommentStatus,
} from './lib/reviewCommentsStore'
import {
  readAiThreads,
  removeAiThreads,
  threadsNeedingAnswer,
  upsertThread,
  writeAiThreads,
} from './lib/aiThreadStore'
import { AI_ANSWERS_JSON_SCHEMA, buildQuestionsPrompt, mapAnswersToThreads } from './lib/aiThreadPrompt'
import { parseAndValidateWalkthroughSteps } from './lib/walkthroughParse'
import { compileWalkthroughPrompt } from './lib/walkthroughPrompt'
import { WALKTHROUGH_REVIEW_JSON_SCHEMA } from './lib/walkthroughSchema'

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
      handler: async (request) => {
        // Clear the walkthrough, its AI review comments, and any Q&A threads so a
        // regenerate for the same commit starts from a clean slate.
        await removeWalkthrough(openforge, request.reviewPrId, request.headSha)
        await removeAiReviewComments(openforge, request.reviewPrId, request.headSha)
        await removeAiThreads(openforge, request.reviewPrId, request.headSha)
      },
    }))

    // AI review comments produced by the combined pass live in local plugin
    // storage keyed per commit (never pushed to GitHub).
    context.subscriptions.add(openforge.backend.registerMethod<{ reviewPrId: number; headSha: string }, AgentReviewComment[]>('getPrAiReviewComments', {
      handler: (request) => readAiReviewComments(openforge, request.reviewPrId, request.headSha),
    }))

    context.subscriptions.add(openforge.backend.registerMethod<{ reviewPrId: number; headSha: string; commentId: number; status: string }, void>('updatePrAiReviewCommentStatus', {
      handler: (request) => updateAiReviewCommentStatus(openforge, request.reviewPrId, request.headSha, request.commentId, request.status),
    }))

    // Local, per-commit "Ask the AI author" Q&A threads. Never pushed to GitHub.
    context.subscriptions.add(openforge.backend.registerMethod<{ reviewPrId: number; headSha: string }, AiThread[]>('getAiThreads', {
      handler: (request) => readAiThreads(openforge, request.reviewPrId, request.headSha),
    }))

    context.subscriptions.add(openforge.backend.registerMethod<{ reviewPrId: number; headSha: string; thread: AiThread }, void>('saveAiThread', {
      handler: async (request) => {
        const threads = await readAiThreads(openforge, request.reviewPrId, request.headSha)
        await writeAiThreads(openforge, request.reviewPrId, request.headSha, upsertThread(threads, request.thread))
      },
    }))

    context.subscriptions.add(openforge.backend.registerMethod<{ reviewPrId: number; headSha: string; threadId: string }, void>('deleteAiThread', {
      handler: async (request) => {
        const threads = await readAiThreads(openforge, request.reviewPrId, request.headSha)
        await writeAiThreads(openforge, request.reviewPrId, request.headSha, threads.filter(t => t.id !== request.threadId))
      },
    }))

    // Answer every unanswered thread in one repo-aware agent pass. Fire-and-forget:
    // mark the pending threads immediately (so the UI shows "thinking"), then run
    // the agent in the background and merge its answers back (poll from the UI).
    context.subscriptions.add(openforge.backend.registerMethod<{
      reviewPrId: number
      headSha: string
      repoOwner: string
      repoName: string
      prNumber: number
      projectId: string | null
    }, void>('askAgentQuestions', {
      handler: async (request) => {
        const threads = await readAiThreads(openforge, request.reviewPrId, request.headSha)
        const pending = threadsNeedingAnswer(threads)
        if (pending.length === 0) return

        const pendingIds = new Set(pending.map(t => t.id))
        const marked = threads.map(t => (pendingIds.has(t.id) ? { ...t, status: 'pending' as const } : t))
        await writeAiThreads(openforge, request.reviewPrId, request.headSha, marked)

        // Fetch diffs + the walkthrough steps server-side to anchor each question.
        const files = await invokeHostCommand<PrFileDiff[]>(openforge, 'getPrFileDiffs', {
          owner: request.repoOwner, repo: request.repoName, prNumber: request.prNumber,
        })
        const walkthrough = await readWalkthrough(openforge, request.reviewPrId, request.headSha)
        const steps = parseAndValidateWalkthroughSteps(walkthrough?.steps_json ?? null, files) ?? []
        // Include the AI review comments so a "comment"-anchored follow-up thread can
        // quote the exact suggestion it's asking about.
        const agentComments = await readAiReviewComments(openforge, request.reviewPrId, request.headSha)
        const prompt = buildQuestionsPrompt(pending, files, steps, agentComments)

        void (async () => {
          const sessionKey = randomUUID()
          try {
            const result = await invokeHostCommand<{ text: string }>(openforge, 'agentGenerateInRepo', {
              sessionKey,
              prompt,
              model: WALKTHROUGH_MODEL,
              projectId: request.projectId,
              owner: request.repoOwner,
              repo: request.repoName,
              prNumber: request.prNumber,
              headSha: request.headSha,
              outputSchema: AI_ANSWERS_JSON_SCHEMA,
            })
            const answered = mapAnswersToThreads(result?.text ?? '', pending)
            // Re-read (guard against a concurrent change) and merge the answers back.
            const latest = await readAiThreads(openforge, request.reviewPrId, request.headSha)
            let merged = latest
            for (const t of answered) merged = upsertThread(merged, t)
            await writeAiThreads(openforge, request.reviewPrId, request.headSha, merged)
          } catch {
            const latest = await readAiThreads(openforge, request.reviewPrId, request.headSha)
            const errored = latest.map(t => (pendingIds.has(t.id) ? { ...t, status: 'error' as const } : t))
            await writeAiThreads(openforge, request.reviewPrId, request.headSha, errored)
          }
        })()
      },
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
      projectId: string | null
      promptTemplate: string
    }, { walkthrough_session_key: string }>('startAgentWalkthrough', {
      handler: async (request) => {
        const sessionKey = randomUUID()
        const params = { prId: request.reviewPrId, headSha: request.headSha, sessionKey, prompt: '' }
        await beginWalkthroughGeneration(openforge, params)

        // Fetch diffs server-side so the trigger works without the UI having loaded files,
        // then compile the combined steps+review prompt here. The template is the
        // resolved `pr_walkthrough_prompt` setting (global/project), passed from the UI;
        // only the {{…}} placeholders are filled in with this PR's title/body/diffs.
        const files = await invokeHostCommand<PrFileDiff[]>(openforge, 'getPrFileDiffs', {
          owner: request.repoOwner, repo: request.repoName, prNumber: request.prNumber,
        })
        const prompt = compileWalkthroughPrompt({ title: request.prTitle, body: request.prBody, files }, request.promptTemplate)

        // Kick off generation in the background so the UI gets its session key
        // immediately and can render the optimistic "generating" state. The
        // repo-aware agent runs inside a checkout of the PR head (Plan 1) and
        // returns a schema-validated { steps, review_comments } object.
        void runWalkthroughAndReviewGeneration(
          openforge,
          { ...params, prompt },
          (key, p) =>
            invokeHostCommand<{ text: string }>(openforge, 'agentGenerateInRepo', {
              sessionKey: key,
              prompt: p,
              model: WALKTHROUGH_MODEL,
              projectId: request.projectId,
              owner: request.repoOwner,
              repo: request.repoName,
              prNumber: request.prNumber,
              headSha: request.headSha,
              outputSchema: WALKTHROUGH_REVIEW_JSON_SCHEMA,
            }).then((result) => result?.text ?? ''),
          files,
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
