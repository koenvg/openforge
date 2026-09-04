import { onDestroy } from 'svelte'
import { fromStore } from 'svelte/store'
import type { AiThread, ReviewPullRequest } from '@openforge-app/plugin-sdk/domain'
import { activeProjectId, aiThreads, selectedReviewPr } from '../../lib/stores'
import { markThreadSeen as markThreadSeenInList } from '../../lib/questionsIndex'
import { editLastUserMessage } from '../../lib/aiThreadStore'
import type { GithubSyncPrReviewClient } from './githubSyncClient'

export function useAiThreadState(githubSync: GithubSyncPrReviewClient) {
  const activeProject = fromStore(activeProjectId)
  const threadStore = fromStore(aiThreads)
  const selectedPr = fromStore(selectedReviewPr)
  const pollTimers = new Map<number, ReturnType<typeof setInterval>>()
  let loadSequence = 0

  let pendingCount = $derived(
    threadStore.current.filter(thread => (
      thread.status !== 'pending'
      && thread.messages.at(-1)?.role === 'user'
    )).length,
  )

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
    const threads = await githubSync.getAiThreads({ reviewPrId: pr.id, headSha: pr.head_sha })
    if (sequence !== loadSequence) return
    if (selectedPr.current?.id === pr.id && selectedPr.current?.head_sha === pr.head_sha) {
      threadStore.current = threads
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

    await githubSync.askAgentQuestions({
      reviewPrId: pr.id,
      headSha: pr.head_sha,
      repoOwner: pr.repo_owner,
      repoName: pr.repo_name,
      prNumber: pr.number,
      projectId: activeProject.current,
    })
    await refresh(pr)
    startPolling(pr)
  }

  function clear(): void {
    loadSequence += 1
    threadStore.current = []
  }

  onDestroy(() => {
    for (const timer of pollTimers.values()) clearInterval(timer)
    pollTimers.clear()
  })

  return {
    get threads() { return threadStore.current },
    get pendingCount() { return pendingCount },
    load,
    clear,
    askAgent,
    askAgentStep,
    askAboutComment,
    replyToThread,
    editThread,
    deleteThread,
    markThreadSeen,
    sendQuestionsToAgent,
  }
}
