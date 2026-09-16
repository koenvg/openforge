import { onDestroy } from 'svelte'
import { fromStore } from 'svelte/store'
import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
import type { ReviewPullRequest } from '@openforge-app/plugin-sdk/domain'
import type { AiThread, AiThreadReviewerStatus } from '../../../lib/prReviewRecords'
import { aiThreads, selectedReviewPr } from '../../../lib/stores'
import { resolveProjectIdForRepo } from '../../../lib/projectRepoResolution'
import { markThreadSeen as markThreadSeenInList } from '../../../lib/questionsIndex'
import { editLastUserMessage } from '../../../lib/aiThreadStore'
import type { GithubSyncPrReviewClient } from '../githubSyncClient'

export function useAiThreadState(api: FrontendOpenForgeAPI, githubSync: GithubSyncPrReviewClient) {
  const threadStore = fromStore(aiThreads)
  const selectedPr = fromStore(selectedReviewPr)
  const pollTimers = new Map<number, ReturnType<typeof setInterval>>()
  let loadSequence = 0
  let localProjectIds = $state<Map<string, string>>(new Map())

  let pendingCount = $derived(
    threadStore.current.filter(thread => (
      thread.status !== 'pending'
      && thread.messages.at(-1)?.role === 'user'
    )).length,
  )

  function prKey(pr: ReviewPullRequest): string {
    return `${pr.repo_owner}/${pr.repo_name}`.toLowerCase()
  }

  function canSendQuestions(pr: ReviewPullRequest | null): boolean {
    return !!pr && localProjectIds.has(prKey(pr))
  }

  function newThreadId(): string {
    return `thread-${crypto.randomUUID()}`
  }

  async function createThread(anchor: AiThread['anchor'], body: string): Promise<void> {
    const pr = selectedPr.current
    if (!pr) return

    const now = Math.floor(Date.now() / 1000)
    const thread: AiThread = {
      id: newThreadId(),
      anchor,
      status: 'draft',
      messages: [{ role: 'user', body, created_at: now }],
      created_at: now,
      updated_at: now,
    }
    threadStore.current = [...threadStore.current, thread]
    await githubSync.saveAiThread({ reviewPrId: pr.id, headSha: pr.head_sha, thread })
  }

  function askAgent(filename: string, line: number, side: 'LEFT' | 'RIGHT', body: string): void {
    void createThread({ type: 'line', filename, line, side }, body)
  }

  function askAgentStep(stepId: string, body: string): void {
    void createThread({ type: 'step', step_id: stepId }, body)
  }

  function askAboutComment(args: {
    commentId: number
    filename: string
    line: number
    side: 'LEFT' | 'RIGHT'
    body: string
  }): void {
    void createThread(
      {
        type: 'comment',
        comment_id: args.commentId,
        filename: args.filename,
        line: args.line,
        side: args.side,
      },
      args.body,
    )
  }

  async function replyToThread(threadId: string, body: string): Promise<void> {
    const pr = selectedPr.current
    if (!pr) return

    const now = Math.floor(Date.now() / 1000)
    const updated = threadStore.current.map(thread => thread.id === threadId
      ? {
          ...thread,
          status: 'draft' as const,
          updated_at: now,
          messages: [...thread.messages, { role: 'user' as const, body, created_at: now }],
        }
      : thread)
    threadStore.current = updated

    const thread = updated.find(candidate => candidate.id === threadId)
    if (thread) {
      await githubSync.saveAiThread({ reviewPrId: pr.id, headSha: pr.head_sha, thread })
    }
  }

  // Edit an unsent question in place (before it's sent to the AI), then persist.
  async function editThread(threadId: string, body: string): Promise<void> {
    const pr = selectedPr.current
    if (!pr) return

    const now = Math.floor(Date.now() / 1000)
    const updated = threadStore.current.map(thread => (
      thread.id === threadId ? editLastUserMessage(thread, body, now) : thread
    ))
    threadStore.current = updated

    const thread = updated.find(candidate => candidate.id === threadId)
    if (thread) {
      await githubSync.saveAiThread({ reviewPrId: pr.id, headSha: pr.head_sha, thread })
    }
  }

  // Drop a thread entirely (used to remove an unsent question).
  async function deleteThread(threadId: string): Promise<void> {
    const pr = selectedPr.current
    if (!pr) return

    threadStore.current = threadStore.current.filter(thread => thread.id !== threadId)
    await githubSync.deleteAiThread({ reviewPrId: pr.id, headSha: pr.head_sha, threadId })
  }

  async function setReviewerStatus(threadId: string, status: AiThreadReviewerStatus): Promise<void> {
    const pr = selectedPr.current
    if (!pr) return

    const now = Math.floor(Date.now() / 1000)
    const updated = threadStore.current.map(thread => (
      thread.id === threadId ? { ...thread, reviewer_status: status, updated_at: now } : thread
    ))
    threadStore.current = updated

    const thread = updated.find(candidate => candidate.id === threadId)
    if (thread) {
      await githubSync.saveAiThread({ reviewPrId: pr.id, headSha: pr.head_sha, thread })
    }
  }

  // Mark an answered thread as read so it leaves the "answers to read" group.
  // Persisted (via saveAiThread) so the state survives leaving and returning.
  async function markThreadSeen(threadId: string): Promise<void> {
    const pr = selectedPr.current
    if (!pr) return

    const now = Math.floor(Date.now() / 1000)
    const updated = markThreadSeenInList(threadStore.current, threadId, now)
    threadStore.current = updated

    const thread = updated.find(candidate => candidate.id === threadId)
    if (thread) {
      await githubSync.saveAiThread({ reviewPrId: pr.id, headSha: pr.head_sha, thread })
    }
  }

  async function load(pr: ReviewPullRequest): Promise<void> {
    const sequence = ++loadSequence
    const [threads, projectId] = await Promise.all([
      githubSync.getAiThreads({ reviewPrId: pr.id, headSha: pr.head_sha }),
      resolveProjectIdForRepo(api, pr.repo_owner, pr.repo_name).catch((error) => {
        console.error('Failed to resolve a local project for AI review questions:', error)
        return null
      }),
    ])
    if (sequence !== loadSequence) return
    if (selectedPr.current?.id === pr.id && selectedPr.current?.head_sha === pr.head_sha) {
      threadStore.current = threads
      const next = new Map(localProjectIds)
      if (projectId) next.set(prKey(pr), projectId)
      else next.delete(prKey(pr))
      localProjectIds = next
    }
  }

  async function refresh(pr: ReviewPullRequest): Promise<void> {
    try {
      await load(pr)
    } catch (error) {
      console.error('Failed to load AI threads:', error)
    }
  }

  function startPolling(pr: ReviewPullRequest): void {
    if (pollTimers.has(pr.id)) return

    const timer = setInterval(async () => {
      if (selectedPr.current?.id !== pr.id || selectedPr.current?.head_sha !== pr.head_sha) {
        clearInterval(timer)
        pollTimers.delete(pr.id)
        return
      }

      await refresh(pr)
      if (!threadStore.current.some(thread => thread.status === 'pending')) {
        clearInterval(timer)
        pollTimers.delete(pr.id)
      }
    }, 2500)

    pollTimers.set(pr.id, timer)
  }

  async function sendQuestionsToAgent(): Promise<void> {
    const pr = selectedPr.current
    if (!pr) return
    const projectId = await resolveProjectIdForRepo(api, pr.repo_owner, pr.repo_name).catch((error) => {
      console.error('Failed to resolve a local project for AI review questions:', error)
      return null
    })
    if (!projectId) return

    await githubSync.askAgentQuestions({
      reviewPrId: pr.id,
      headSha: pr.head_sha,
      repoOwner: pr.repo_owner,
      repoName: pr.repo_name,
      prNumber: pr.number,
      projectId,
    })
    await refresh(pr)
    startPolling(pr)
  }

  function clear(): void {
    loadSequence += 1
    threadStore.current = []
    localProjectIds = new Map()
  }

  onDestroy(() => {
    for (const timer of pollTimers.values()) clearInterval(timer)
    pollTimers.clear()
  })

  return {
    get threads() { return threadStore.current },
    get pendingCount() { return pendingCount },
    get canSendQuestions() { return canSendQuestions(selectedPr.current) },
    load,
    clear,
    askAgent,
    askAgentStep,
    askAboutComment,
    replyToThread,
    setReviewerStatus,
    editThread,
    deleteThread,
    markThreadSeen,
    sendQuestionsToAgent,
  }
}
