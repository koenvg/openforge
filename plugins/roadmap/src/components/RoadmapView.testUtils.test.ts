import { describe, expect, it, vi } from 'vitest'
import { createRoadmapViewApi } from './RoadmapView.testUtils'

describe('RoadmapView test API', () => {
  it('structured-clones backend payloads before dispatching them to handlers', async () => {
    let dispatchedPayload: unknown
    const handler = vi.fn(async (receivedPayload: unknown) => {
      dispatchedPayload = receivedPayload
      return null
    })
    const { invoke } = createRoadmapViewApi({ roadmap_test: handler })
    const payload = { projectId: 'proj-1', labels: ['alpha'] }

    await invoke('roadmap_test', payload)

    expect(handler).toHaveBeenCalledWith(payload)
    const clonedPayload = dispatchedPayload as typeof payload
    expect(clonedPayload).not.toBe(payload)
    expect(clonedPayload.labels).not.toBe(payload.labels)
  })

  it('rejects non-cloneable backend payloads before dispatch', async () => {
    const handler = vi.fn(async () => null)
    const { invoke } = createRoadmapViewApi({ roadmap_test: handler })

    await expect(invoke('roadmap_test', { callback: () => undefined })).rejects.toThrow()
    expect(handler).not.toHaveBeenCalled()
  })
})
