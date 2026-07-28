import { describe, expect, it, vi } from 'vitest'

import { TaskBrowserPermissionPolicy } from './taskBrowserPermissionPolicy'
import type {
  TaskBrowserPermissionDecisionRecord,
  TaskBrowserPermissionPromptRequest,
  TaskBrowserPermissionStore,
} from './taskBrowserPermissionPolicy'

class MemoryPermissionStore implements TaskBrowserPermissionStore {
  records: TaskBrowserPermissionDecisionRecord[] = []
  replaceError: Error | null = null
  replaceGate: Promise<void> | null = null
  replaceCalls = 0

  async load(): Promise<TaskBrowserPermissionDecisionRecord[]> {
    return structuredClone(this.records)
  }

  async replace(records: TaskBrowserPermissionDecisionRecord[]): Promise<void> {
    this.replaceCalls += 1
    if (this.replaceGate) await this.replaceGate
    if (this.replaceError) throw this.replaceError
    this.records = structuredClone(records)
  }
}

describe('Task Browser Permission policy', () => {
  it('prompts for a recognized request with its normalized origin and permission', async () => {
    const prompt = vi.fn(async (_request: TaskBrowserPermissionPromptRequest) => ({
      decision: 'allow' as const,
      remember: false,
    }))
    const policy = new TaskBrowserPermissionPolicy({ store: new MemoryPermissionStore(), prompt })
    const handler = await policy.createSessionHandler('browser', 'T-1')

    await expect(handler.request({
      windowId: 10,
      permission: 'notifications',
      details: { requestingUrl: 'https://calendar.example/path?view=week', isMainFrame: true },
    })).resolves.toBe(true)
    await expect(handler.request({
      windowId: 10,
      permission: 'notifications',
      details: { requestingUrl: 'https://calendar.example/another', isMainFrame: true },
    })).resolves.toBe(true)

    expect(prompt).toHaveBeenCalledTimes(2)
    expect(prompt).toHaveBeenCalledWith({
      windowId: 10,
      origin: 'https://calendar.example',
      descriptor: { permission: 'notifications' },
      permissionLabel: 'Notifications',
    })
  })

  it('reuses remembered decisions only for the same plugin, Task, origin, and descriptor', async () => {
    const store = new MemoryPermissionStore()
    const prompt = vi.fn(async () => ({ decision: 'allow' as const, remember: true }))
    const policy = new TaskBrowserPermissionPolicy({ store, prompt })
    const taskHandler = await policy.createSessionHandler('browser', 'T-1')

    const request = {
      windowId: 10,
      permission: 'notifications',
      details: { requestingUrl: 'https://calendar.example/events', isMainFrame: true },
    }
    await expect(taskHandler.request(request)).resolves.toBe(true)
    expect(taskHandler.check({
      permission: 'notifications',
      requestingOrigin: 'https://calendar.example',
      details: { isMainFrame: true },
    })).toBe(true)
    await expect(taskHandler.request(request)).resolves.toBe(true)

    const otherTask = await policy.createSessionHandler('browser', 'T-2')
    const otherPlugin = await policy.createSessionHandler('notes', 'T-1')
    expect(otherTask.check({
      permission: 'notifications',
      requestingOrigin: 'https://calendar.example',
      details: { isMainFrame: true },
    })).toBe(false)
    expect(otherPlugin.check({
      permission: 'notifications',
      requestingOrigin: 'https://calendar.example',
      details: { isMainFrame: true },
    })).toBe(false)

    expect(prompt).toHaveBeenCalledTimes(1)
    expect(store.records).toEqual([{
      pluginId: 'browser',
      taskId: 'T-1',
      origin: 'https://calendar.example',
      descriptor: { permission: 'notifications' },
      decision: 'allow',
    }])
  })

  it('scopes media decisions to the exact normalized set of requested media types', async () => {
    const prompt = vi.fn()
      .mockResolvedValueOnce({ decision: 'allow' as const, remember: true })
      .mockResolvedValueOnce({ decision: 'allow' as const, remember: true })
      .mockResolvedValue({ decision: 'block' as const, remember: false })
    const policy = new TaskBrowserPermissionPolicy({ store: new MemoryPermissionStore(), prompt })
    const handler = await policy.createSessionHandler('browser', 'T-media')

    await expect(handler.request({
      windowId: 10,
      permission: 'media',
      details: {
        requestingUrl: 'https://meet.example/room',
        securityOrigin: 'https://meet.example',
        mediaTypes: ['audio'],
      },
    })).resolves.toBe(true)
    expect(handler.check({
      permission: 'media',
      requestingOrigin: 'https://meet.example',
      details: { securityOrigin: 'https://meet.example', mediaType: 'audio', isMainFrame: true },
    })).toBe(false)
    expect(handler.check({
      permission: 'media',
      requestingOrigin: 'https://meet.example',
      details: { securityOrigin: 'https://meet.example', mediaType: 'video', isMainFrame: true },
    })).toBe(false)

    await expect(handler.request({
      windowId: 10,
      permission: 'media',
      details: {
        requestingUrl: 'https://meet.example/room',
        securityOrigin: 'https://meet.example',
        mediaTypes: ['video'],
      },
    })).resolves.toBe(true)
    expect(handler.check({
      permission: 'media',
      requestingOrigin: 'https://meet.example',
      details: { securityOrigin: 'https://meet.example', mediaType: 'video', isMainFrame: true },
    })).toBe(false)

    await expect(handler.request({
      windowId: 10,
      permission: 'media',
      details: {
        requestingUrl: 'https://meet.example/room',
        securityOrigin: 'https://meet.example',
        mediaTypes: ['video', 'audio'],
      },
    })).resolves.toBe(false)

    expect(prompt).toHaveBeenNthCalledWith(1, {
      windowId: 10,
      origin: 'https://meet.example',
      descriptor: { permission: 'media', mediaTypes: ['audio'] },
      permissionLabel: 'Microphone',
    })
    expect(prompt).toHaveBeenNthCalledWith(2, {
      windowId: 10,
      origin: 'https://meet.example',
      descriptor: { permission: 'media', mediaTypes: ['video'] },
      permissionLabel: 'Camera',
    })
    expect(prompt).toHaveBeenNthCalledWith(3, {
      windowId: 10,
      origin: 'https://meet.example',
      descriptor: { permission: 'media', mediaTypes: ['audio', 'video'] },
      permissionLabel: 'Camera and microphone',
    })
  })

  it('prompts for recognized permissions and denies unknown or malformed descriptors without prompting', async () => {
    const prompt = vi.fn(async () => ({ decision: 'block' as const, remember: false }))
    const policy = new TaskBrowserPermissionPolicy({ store: new MemoryPermissionStore(), prompt })
    const handler = await policy.createSessionHandler('browser', 'T-policy')

    await expect(handler.request({
      windowId: 11,
      permission: 'geolocation',
      details: { requestingUrl: 'https://maps.example/route', isMainFrame: true },
    })).resolves.toBe(false)
    await expect(handler.request({
      windowId: 11,
      permission: 'future-powerful-feature',
      details: { requestingUrl: 'https://maps.example/route', isMainFrame: true },
    })).resolves.toBe(false)
    await expect(handler.request({
      windowId: 11,
      permission: 'media',
      details: { requestingUrl: 'https://maps.example/route', mediaTypes: [] },
    })).resolves.toBe(false)
    await expect(handler.request({
      windowId: 11,
      permission: 'notifications',
      details: { requestingUrl: 'not a valid origin', isMainFrame: true },
    })).resolves.toBe(false)

    expect(prompt).toHaveBeenCalledTimes(1)
    expect(prompt).toHaveBeenCalledWith({
      windowId: 11,
      origin: 'https://maps.example',
      descriptor: { permission: 'geolocation' },
      permissionLabel: 'Location',
    })
  })

  it('clears remembered decisions by session, Task, and plugin without widening the cleanup scope', async () => {
    const store = new MemoryPermissionStore()
    store.records = [
      {
        pluginId: 'browser',
        taskId: 'T-1',
        origin: 'https://one.example',
        descriptor: { permission: 'notifications' },
        decision: 'allow',
      },
      {
        pluginId: 'browser',
        taskId: 'T-2',
        origin: 'https://two.example',
        descriptor: { permission: 'geolocation' },
        decision: 'block',
      },
      {
        pluginId: 'notes',
        taskId: 'T-1',
        origin: 'https://three.example',
        descriptor: { permission: 'media', mediaTypes: ['audio'] },
        decision: 'allow',
      },
    ]
    const prompt = vi.fn(async () => ({ decision: 'block' as const, remember: false }))
    const policy = new TaskBrowserPermissionPolicy({ store, prompt })
    const browserTaskOne = await policy.createSessionHandler('browser', 'T-1')
    const browserTaskTwo = await policy.createSessionHandler('browser', 'T-2')
    const notesTaskOne = await policy.createSessionHandler('notes', 'T-1')

    expect(browserTaskOne.check({
      permission: 'notifications',
      requestingOrigin: 'https://one.example',
      details: { isMainFrame: true },
    })).toBe(true)
    await expect(browserTaskTwo.request({
      windowId: 10,
      permission: 'geolocation',
      details: { requestingUrl: 'https://two.example/place', isMainFrame: true },
    })).resolves.toBe(false)
    expect(prompt).not.toHaveBeenCalled()

    await policy.clearSession('browser', 'T-1')
    expect(browserTaskOne.check({
      permission: 'notifications',
      requestingOrigin: 'https://one.example',
      details: { isMainFrame: true },
    })).toBe(false)
    expect(store.records.map(record => `${record.pluginId}/${record.taskId}`)).toEqual([
      'browser/T-2',
      'notes/T-1',
    ])

    await policy.clearTask('T-1')
    expect(notesTaskOne.check({
      permission: 'media',
      requestingOrigin: 'https://three.example',
      details: { securityOrigin: 'https://three.example', mediaType: 'audio', isMainFrame: true },
    })).toBe(false)
    expect(store.records.map(record => `${record.pluginId}/${record.taskId}`)).toEqual(['browser/T-2'])

    await policy.clearPlugin('browser')
    expect(store.records).toEqual([])
  })

  it('does not silently retain a remembered allow when durable persistence fails', async () => {
    const store = new MemoryPermissionStore()
    store.replaceError = new Error('disk unavailable')
    const prompt = vi.fn(async () => ({ decision: 'allow' as const, remember: true }))
    const policy = new TaskBrowserPermissionPolicy({ store, prompt })
    const handler = await policy.createSessionHandler('browser', 'T-failure')
    const request = {
      windowId: 10,
      permission: 'notifications',
      details: { requestingUrl: 'https://calendar.example', isMainFrame: true },
    }

    await expect(handler.request(request)).rejects.toThrow('disk unavailable')
    store.replaceError = null
    await expect(handler.request(request)).resolves.toBe(true)

    expect(prompt).toHaveBeenCalledTimes(2)
    expect(store.records).toHaveLength(1)
  })

  it('publishes a remembered allow only after durable persistence succeeds', async () => {
    const store = new MemoryPermissionStore()
    let releasePersistence: (() => void) | null = null
    store.replaceGate = new Promise<void>(resolve => { releasePersistence = resolve })
    const prompt = vi.fn(async () => ({ decision: 'allow' as const, remember: true }))
    const policy = new TaskBrowserPermissionPolicy({ store, prompt })
    const handler = await policy.createSessionHandler('browser', 'T-pending')

    const decision = handler.request({
      windowId: 10,
      permission: 'notifications',
      details: { requestingUrl: 'https://calendar.example/events', isMainFrame: true },
    })
    await vi.waitFor(() => expect(store.replaceCalls).toBe(1))

    expect(handler.check({
      permission: 'notifications',
      requestingOrigin: 'https://calendar.example',
      details: { isMainFrame: true },
    })).toBe(false)

    releasePersistence!()
    await expect(decision).resolves.toBe(true)
    expect(handler.check({
      permission: 'notifications',
      requestingOrigin: 'https://calendar.example',
      details: { isMainFrame: true },
    })).toBe(true)
  })
})
