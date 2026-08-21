import { describe, expect, it, vi } from 'vitest'
import type { ProjectAttention } from './types'
import { useAppCloseController } from './appCloseController.svelte'

function projectAttention(runningAgents = 0, needsInput = 0): Map<string, ProjectAttention> {
  return new Map([[
    'proj-1',
    {
      project_id: 'proj-1',
      running_agents: runningAgents,
      needs_input: needsInput,
      ci_failures: 0,
      unaddressed_comments: 0,
      completed_agents: 0,
    },
  ]])
}

describe('App close controller', () => {
  it('prevents the close synchronously and asks for confirmation after refreshing active agents', async () => {
    let finishRefresh: () => void = () => {}
    const refreshAttention = vi.fn(() => new Promise<void>((resolve) => {
      finishRefresh = resolve
    }))
    const destroy = vi.fn(async () => undefined)
    const controller = useAppCloseController({
      refreshAttention,
      getAttention: () => projectAttention(1),
      getAppWindow: () => ({ onCloseRequested: vi.fn(), destroy }),
    })
    const preventDefault = vi.fn()

    const closeRequest = controller.handleCloseRequested({ preventDefault })

    expect(preventDefault).toHaveBeenCalledOnce()
    expect(controller.confirmationOpen).toBe(false)
    expect(destroy).not.toHaveBeenCalled()

    finishRefresh()
    await closeRequest

    expect(controller.confirmationOpen).toBe(true)
    expect(destroy).not.toHaveBeenCalled()
  })

  it('closes immediately when the refreshed attention snapshot has no active agents', async () => {
    const destroy = vi.fn(async () => undefined)
    const controller = useAppCloseController({
      refreshAttention: vi.fn(async () => undefined),
      getAttention: () => projectAttention(),
      getAppWindow: () => ({ onCloseRequested: vi.fn(), destroy }),
    })

    await controller.handleCloseRequested({ preventDefault: vi.fn() })

    expect(controller.confirmationOpen).toBe(false)
    expect(destroy).toHaveBeenCalledOnce()
  })

  it('keeps the confirmation open when closing the window fails', async () => {
    const closeError = new Error('close failed')
    const logError = vi.fn()
    const controller = useAppCloseController({
      refreshAttention: vi.fn(async () => undefined),
      getAttention: () => projectAttention(0, 1),
      getAppWindow: () => ({
        onCloseRequested: vi.fn(),
        destroy: vi.fn(async () => { throw closeError }),
      }),
      logError,
    })

    await controller.handleCloseRequested({ preventDefault: vi.fn() })
    await controller.confirmClose()

    expect(controller.confirmationOpen).toBe(true)
    expect(logError).toHaveBeenCalledWith('[App] Failed to close window:', closeError)
  })
})
