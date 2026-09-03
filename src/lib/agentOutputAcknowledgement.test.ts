import { describe, expect, it, vi } from 'vitest'
import {
  createAgentOutputAcknowledgementController,
  type AgentOutputVisibility,
} from './agentOutputAcknowledgement'

const visibleStoppedOutput: AgentOutputVisibility = {
  visibleTaskId: 'T-42',
  agentPaneActive: true,
  terminalReady: true,
  windowFocusedAndDocumentVisible: true,
  session: {
    id: 'ses-1',
    taskId: 'T-42',
    status: 'completed',
    outputRevision: 1,
    viewedOutputRevision: 0,
  },
}

describe('Agent output acknowledgement controller', () => {
  it.each([
    ['a different Task is visible', { visibleTaskId: 'T-99' }],
    ['the Agent pane is hidden', { agentPaneActive: false }],
    ['the terminal is not ready', { terminalReady: false }],
    ['the app window or document is not visible', { windowFocusedAndDocumentVisible: false }],
    ['the session is still running', { session: { ...visibleStoppedOutput.session!, status: 'running' } }],
    ['the stopped revision is already viewed', { session: { ...visibleStoppedOutput.session!, viewedOutputRevision: 1 } }],
  ])('does not acknowledge when %s', async (_description, override) => {
    const markViewed = vi.fn(async () => true)
    const controller = createAgentOutputAcknowledgementController({ markViewed })

    await controller.update({ ...visibleStoppedOutput, ...override })

    expect(markViewed).not.toHaveBeenCalled()
  })

  it('acknowledges after terminal readiness arrives for an already stopped session', async () => {
    const markViewed = vi.fn(async () => true)
    const controller = createAgentOutputAcknowledgementController({ markViewed })

    await controller.update({ ...visibleStoppedOutput, terminalReady: false })
    await controller.update(visibleStoppedOutput)

    expect(markViewed).toHaveBeenCalledOnce()
    expect(markViewed).toHaveBeenCalledWith('T-42', 'ses-1', 1)
  })

  it('acknowledges after focus and visibility return for an already stopped session', async () => {
    const markViewed = vi.fn(async () => true)
    const controller = createAgentOutputAcknowledgementController({ markViewed })

    await controller.update({ ...visibleStoppedOutput, windowFocusedAndDocumentVisible: false })
    await controller.update(visibleStoppedOutput)

    expect(markViewed).toHaveBeenCalledOnce()
  })

  it('deduplicates a visible revision while its acknowledgement is in flight', async () => {
    let resolveMarkViewed!: (changed: boolean) => void
    const markViewed = vi.fn(() => new Promise<boolean>((resolve) => { resolveMarkViewed = resolve }))
    const controller = createAgentOutputAcknowledgementController({ markViewed })

    const first = controller.update(visibleStoppedOutput)
    const duplicate = controller.update(visibleStoppedOutput)
    expect(markViewed).toHaveBeenCalledOnce()

    resolveMarkViewed(true)
    await Promise.all([first, duplicate])
    await controller.update(visibleStoppedOutput)
    expect(markViewed).toHaveBeenCalledOnce()
  })

  it('acknowledges a newer revision without allowing an older request to stand in for it', async () => {
    const resolvers = new Map<number, (changed: boolean) => void>()
    const onViewed = vi.fn()
    const markViewed = vi.fn((_taskId: string, _sessionId: string, revision: number) => (
      new Promise<boolean>((resolve) => { resolvers.set(revision, resolve) })
    ))
    const controller = createAgentOutputAcknowledgementController({ markViewed, onViewed })

    const older = controller.update(visibleStoppedOutput)
    const newerOutput: AgentOutputVisibility = {
      ...visibleStoppedOutput,
      session: { ...visibleStoppedOutput.session!, outputRevision: 2 },
    }
    const newer = controller.update(newerOutput)

    expect(markViewed.mock.calls).toEqual([
      ['T-42', 'ses-1', 1],
      ['T-42', 'ses-1', 2],
    ])

    resolvers.get(1)?.(false)
    resolvers.get(2)?.(true)
    await Promise.all([older, newer])

    expect(onViewed).toHaveBeenCalledOnce()
    expect(onViewed).toHaveBeenCalledWith({ taskId: 'T-42', sessionId: 'ses-1', outputRevision: 2 })
  })

  it('allows a failed acknowledgement to be retried', async () => {
    const markViewed = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(true)
    const onError = vi.fn()
    const controller = createAgentOutputAcknowledgementController({ markViewed, onError })

    await controller.update(visibleStoppedOutput)
    await controller.update(visibleStoppedOutput)

    expect(markViewed).toHaveBeenCalledTimes(2)
    expect(onError).toHaveBeenCalledOnce()
  })
})
