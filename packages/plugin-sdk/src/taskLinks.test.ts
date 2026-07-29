import { describe, expect, it, vi } from 'vitest'
import { createMockBackendOpenForgeApi, createMockFrontendOpenForgeApi } from './testing'

describe('Task links SDK capability', () => {
  const request = { taskId: 'T-1', url: 'https://openforge.dev/docs' }

  it('lets frontend plugins register and exercise the Task link handler through the testing interface', async () => {
    const api = createMockFrontendOpenForgeApi({ pluginId: 'com.openforge.task-browser' })
    const handler = vi.fn(async () => 'handled' as const)
    const registration = api.taskLinks.registerHandler(handler)

    await api.taskLinks.open(request)

    expect(handler).toHaveBeenCalledWith(request)
    expect(api.__testing.calls.taskLinkOpenRequests).toEqual([request])

    await registration.dispose()
    await expect(api.taskLinks.open(request)).resolves.toBeUndefined()
    expect(handler).toHaveBeenCalledTimes(1)
    expect(api.__testing.calls.openUrl).toEqual([request.url])
  })

  it('models declined handlers with the production external fallback', async () => {
    const api = createMockFrontendOpenForgeApi()
    api.taskLinks.registerHandler(async () => 'declined')

    await api.taskLinks.open(request)

    expect(api.__testing.calls.openUrl).toEqual([request.url])
  })

  it('rejects duplicate frontend handler registrations', () => {
    const api = createMockFrontendOpenForgeApi()
    api.taskLinks.registerHandler(async () => 'handled')

    expect(() => api.taskLinks.registerHandler(async () => 'handled')).toThrow(/already registered/i)
  })

  it('does not expose the frontend-only capability to backend plugins', () => {
    const api = createMockBackendOpenForgeApi()

    expect(api).not.toHaveProperty('taskLinks')
  })
})
