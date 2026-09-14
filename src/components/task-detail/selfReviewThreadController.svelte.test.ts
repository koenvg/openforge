import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReviewThread } from '@openforge-app/plugin-sdk'
import { createSelfReviewThreadController } from './selfReviewThreadController.svelte'
import { listReviewThreads, replyToReviewThread, setReviewThreadStatus } from '../../lib/ipc'

vi.mock('../../lib/ipc', () => ({
  listReviewThreads: vi.fn(),
  replyToReviewThread: vi.fn(),
  setReviewThreadStatus: vi.fn(),
}))

const listMock = vi.mocked(listReviewThreads)
const replyMock = vi.mocked(replyToReviewThread)
const setStatusMock = vi.mocked(setReviewThreadStatus)

function makeThread(overrides: Partial<ReviewThread> = {}): ReviewThread {
  return {
    id: 'rt_1',
    namespace: 'task',
    targetKey: 'task-1',
    revision: 'working-tree',
    anchor: { kind: 'line', filePath: 'src/main.ts', line: 12, side: 'RIGHT' },
    origin: 'agent',
    status: 'open',
    awaiting: 'none',
    runId: null,
    idempotencyKey: null,
    seenAt: null,
    hasUnreadAgentMessage: false,
    createdAt: 1,
    updatedAt: 1,
    messages: [{ id: 'rtm_1', role: 'agent', body: 'Needs a null check', createdAt: 1 }],
    ...overrides,
  }
}

const rootCleanups: Array<() => void> = []

function createController(getTaskId: () => string) {
  let controller!: ReturnType<typeof createSelfReviewThreadController>
  const cleanup = $effect.root(() => {
    controller = createSelfReviewThreadController({ getTaskId })
  })
  rootCleanups.push(cleanup)
  return controller
}

beforeEach(() => {
  vi.clearAllMocks()
  listMock.mockResolvedValue([])
})

afterEach(() => {
  while (rootCleanups.length > 0) rootCleanups.pop()?.()
})

describe('createSelfReviewThreadController', () => {
  it('reads the task scope at a fixed revision', async () => {
    listMock.mockResolvedValue([makeThread()])
    const controller = createController(() => 'task-1')

    await controller.synchronize()

    expect(listMock).toHaveBeenCalledWith({ namespace: 'task', targetKey: 'task-1', revision: 'working-tree' })
    expect(controller.threads.map(thread => thread.id)).toEqual(['rt_1'])
  })

  it('reloads and drops the previous task threads when the task changes', async () => {
    let taskId = 'task-1'
    listMock.mockResolvedValue([makeThread()])
    const controller = createController(() => taskId)
    await controller.synchronize()

    taskId = 'task-2'
    listMock.mockResolvedValue([makeThread({ id: 'rt_2', targetKey: 'task-2' })])
    await controller.synchronize()

    expect(controller.threads.map(thread => thread.id)).toEqual(['rt_2'])
  })

  it('loads once while the task is unchanged', async () => {
    const controller = createController(() => 'task-1')

    await controller.synchronize()
    await controller.synchronize()

    expect(listMock).toHaveBeenCalledOnce()
  })

  it('leaves the threads empty when the read fails', async () => {
    listMock.mockRejectedValue(new Error('sidecar down'))
    const controller = createController(() => 'task-1')

    await controller.synchronize()

    expect(controller.threads).toEqual([])
  })

  it('replies as the reviewer and keeps the returned thread', async () => {
    listMock.mockResolvedValue([makeThread()])
    const replied = makeThread({
      messages: [
        { id: 'rtm_1', role: 'agent', body: 'Needs a null check', createdAt: 1 },
        { id: 'rtm_2', role: 'human', body: 'Fixed', createdAt: 2 },
      ],
    })
    replyMock.mockResolvedValue(replied)
    const controller = createController(() => 'task-1')
    await controller.synchronize()

    await controller.replyToThread('rt_1', 'Fixed')

    expect(replyMock).toHaveBeenCalledWith({ threadId: 'rt_1', role: 'human', body: 'Fixed' })
    expect(controller.threads[0].messages).toHaveLength(2)
  })

  it('keeps a resolved thread in the list so the reviewer can reopen it', async () => {
    listMock.mockResolvedValue([makeThread()])
    setStatusMock.mockResolvedValue(makeThread({ status: 'resolved' }))
    const controller = createController(() => 'task-1')
    await controller.synchronize()

    await controller.setThreadStatus('rt_1', 'resolved')

    expect(setStatusMock).toHaveBeenCalledWith({ threadId: 'rt_1', status: 'resolved' })
    expect(controller.threads.map(thread => thread.status)).toEqual(['resolved'])
  })

  it('ignores a read that resolves after the reviewer returned to the same task', async () => {
    let taskId = 'task-1'
    let resolveFirst!: (threads: ReviewThread[]) => void
    listMock.mockReturnValueOnce(new Promise<ReviewThread[]>((resolve) => { resolveFirst = resolve }))
    const controller = createController(() => taskId)
    const first = controller.synchronize()

    taskId = 'task-2'
    await controller.synchronize()
    taskId = 'task-1'
    listMock.mockResolvedValue([makeThread({ id: 'rt_current' })])
    await controller.synchronize()

    resolveFirst([makeThread({ id: 'rt_stale' })])
    await first

    expect(controller.threads.map(thread => thread.id)).toEqual(['rt_current'])
  })

  it('ignores a write that resolves after the reviewer moved to another task', async () => {
    let taskId = 'task-1'
    listMock.mockResolvedValue([makeThread()])
    const controller = createController(() => taskId)
    await controller.synchronize()

    let resolveStatus!: (thread: ReviewThread) => void
    setStatusMock.mockReturnValue(new Promise<ReviewThread>((resolve) => { resolveStatus = resolve }))
    const pending = controller.setThreadStatus('rt_1', 'resolved')

    taskId = 'task-2'
    listMock.mockResolvedValue([])
    await controller.synchronize()
    resolveStatus(makeThread({ status: 'resolved' }))
    await pending

    expect(controller.threads).toEqual([])
  })
})
