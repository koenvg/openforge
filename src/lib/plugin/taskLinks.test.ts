import { describe, expect, it, vi } from 'vitest'
import { TaskLinkRouter } from './taskLinks'

describe('TaskLinkRouter', () => {
  const request = { taskId: 'T-1', url: 'https://openforge.dev/docs' }

  it('falls back to the external browser when no Task link handler is registered', async () => {
    const openExternal = vi.fn(async () => undefined)
    const router = new TaskLinkRouter(openExternal)

    await router.open(request)

    expect(openExternal).toHaveBeenCalledWith(request.url)
  })

  it('lets the registered handler own a Task link without opening it externally', async () => {
    const openExternal = vi.fn(async () => undefined)
    const handler = vi.fn(async () => 'handled' as const)
    const router = new TaskLinkRouter(openExternal)
    router.registerHandler('com.openforge.task-browser', handler)

    await router.open(request)

    expect(handler).toHaveBeenCalledWith(request)
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('falls back externally when the registered handler declines', async () => {
    const openExternal = vi.fn(async () => undefined)
    const router = new TaskLinkRouter(openExternal)
    router.registerHandler('com.openforge.task-browser', async () => 'declined')

    await router.open(request)

    expect(openExternal).toHaveBeenCalledWith(request.url)
  })

  it('does not open externally when a handler fails after beginning its work', async () => {
    const openExternal = vi.fn(async () => undefined)
    const router = new TaskLinkRouter(openExternal)
    router.registerHandler('com.openforge.task-browser', async () => {
      throw new Error('navigation failed')
    })

    await expect(router.open(request)).rejects.toThrow('navigation failed')
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('rejects invalid handler results without also opening externally', async () => {
    const openExternal = vi.fn(async () => undefined)
    const router = new TaskLinkRouter(openExternal)
    router.registerHandler('com.openforge.task-browser', async () => undefined as never)

    await expect(router.open(request)).rejects.toThrow(/invalid result/i)
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('rejects duplicate handlers until the active registration is disposed', async () => {
    const router = new TaskLinkRouter(async () => undefined)
    const first = router.registerHandler('com.openforge.task-browser', async () => 'handled')

    expect(() => router.registerHandler('acme.other-browser', async () => 'handled')).toThrow(/already registered/i)

    await first.dispose()
    expect(() => router.registerHandler('acme.other-browser', async () => 'handled')).not.toThrow()
  })

  it.each(['file:///tmp/secret', 'javascript:alert(1)', 'not a url'])(
    'rejects unsupported Task link URL %s',
    async (url) => {
      const openExternal = vi.fn(async () => undefined)
      const router = new TaskLinkRouter(openExternal)

      await expect(router.open({ taskId: 'T-1', url })).rejects.toThrow(/HTTP\(S\)/)
      expect(openExternal).not.toHaveBeenCalled()
    },
  )
})
