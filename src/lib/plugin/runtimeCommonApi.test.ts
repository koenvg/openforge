import { describe, expect, it, vi } from 'vitest'

const scopedSessionIpc = vi.hoisted(() => ({
  startScopedAgentSession: vi.fn(),
  getScopedAgentSessionStatus: vi.fn(),
  inputScopedAgentSession: vi.fn(),
  abortScopedAgentSession: vi.fn(),
  releaseScopedAgentSession: vi.fn(),
}))
const scopedTerminal = vi.hoisted(() => ({ acquire: vi.fn(), attach: vi.fn(), release: vi.fn() }))
const scopedEvents = vi.hoisted(() => ({ subscribe: vi.fn(), ready: vi.fn() }))

vi.mock('../ipc', () => scopedSessionIpc)
vi.mock('../terminalSessionService', () => ({ scopedAgentTerminalSessions: scopedTerminal }))
vi.mock('./pluginHostEvents', () => ({
  subscribeToPluginHostEvent: scopedEvents.subscribe,
  waitForPluginHostEventSubscription: scopedEvents.ready,
}))

import { RuntimeCommonApiRegistry } from './runtimeCommonApi'
import { RuntimeRegistryServices } from './runtimeContributionSupport'
import { createPluginAgentSessionHostCapabilities } from './pluginHostAgentSessions'

describe('RuntimeCommonApiRegistry', () => {
  it('owns command and event contributions shared by frontend and backend APIs', async () => {
    const services = new RuntimeRegistryServices({ pluginId: 'github', projectId: 'project-1' })
    const registry = new RuntimeCommonApiRegistry(services)
    const api = registry.createApi()
    const listener = vi.fn()

    const command = api.commands.register({
      id: 'sync',
      title: 'Sync pull requests',
      handler: async (payload) => ({ payload }),
    })
    const event = api.events.on('sync.finished', listener)

    await expect(api.commands.invoke('sync', { force: true })).resolves.toEqual({ payload: { force: true } })
    await api.events.emit('sync.finished', { count: 2 })

    expect(listener).toHaveBeenCalledWith({ count: 2 })
    expect(registry.getSnapshot()).toMatchObject({
      commands: [{ qualifiedId: 'github.sync' }],
      eventListeners: [{ qualifiedId: 'github.sync.finished' }],
    })

    await event.dispose()
    await command.dispose()
  })
  it('forwards Task Agent Session history requests through the runtime host', async () => {
    const sessions = [{ id: 'S-1', ticket_id: 'T-1', provider: 'pi', created_at: 200 }] as never
    const listTaskSessions = vi.fn().mockResolvedValue(sessions)
    const registry = new RuntimeCommonApiRegistry(new RuntimeRegistryServices({
      pluginId: 'usage',
      projectId: null,
      host: { listTaskSessions },
    }))
    const api = registry.createApi()
    const request = { taskId: 'T-1', provider: 'pi', createdAtOrAfter: 150 }

    await expect(api.tasks.listSessions(request)).resolves.toEqual(sessions)
    expect(listTaskSessions).toHaveBeenCalledWith(request)
  })

  it('forwards typed project Task subscriptions through the runtime host', async () => {
    const dispose = vi.fn()
    let hostHandler: ((event: {
      projectId: string
      taskId: string | null
      reason: 'created' | 'updated' | 'completed' | 'attention' | 'execution'
    }) => void) | null = null
    const subscribeTaskChanges = vi.fn((_projectId, handler) => {
      hostHandler = handler
      return { dispose }
    })
    const registry = new RuntimeCommonApiRegistry(new RuntimeRegistryServices({
      pluginId: 'dashboard',
      projectId: 'P-1',
      host: { subscribeTaskChanges },
    }))
    const handler = vi.fn()

    const subscription = registry.createApi().tasks.onDidChange('P-1', handler)
    const observedHostHandler = hostHandler as ((event: {
      projectId: string
      taskId: string | null
      reason: 'created' | 'updated' | 'completed' | 'attention' | 'execution'
    }) => void) | null
    observedHostHandler?.({ projectId: 'P-1', taskId: 'T-1', reason: 'execution' })

    expect(subscribeTaskChanges).toHaveBeenCalledWith('P-1', expect.any(Function))
    expect(handler).toHaveBeenCalledWith({ projectId: 'P-1', taskId: 'T-1', reason: 'execution' })

    await subscription.dispose()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('forwards Review Thread reads and writes through the runtime host', async () => {
    const scope = { namespace: 'github', targetKey: 'gh:acme/web#1421', revision: 'sha-1' }
    const thread = { id: 'rt_1', ...scope }
    const listReviewThreads = vi.fn().mockResolvedValue([thread])
    const createReviewThread = vi.fn().mockResolvedValue(thread)
    const replyToReviewThread = vi.fn().mockResolvedValue(thread)
    const registry = new RuntimeCommonApiRegistry(new RuntimeRegistryServices({
      pluginId: 'reviewer',
      projectId: null,
      host: { listReviewThreads, createReviewThread, replyToReviewThread },
    }))
    const api = registry.createApi()
    const request = {
      ...scope,
      anchor: { kind: 'line' as const, filePath: 'src/main.ts', line: 12, side: 'RIGHT' as const },
      origin: 'plugin' as const,
      body: 'Needs a null check',
    }

    await expect(api.reviewThreads.list(scope)).resolves.toEqual([thread])
    await expect(api.reviewThreads.create(request)).resolves.toEqual(thread)
    await expect(api.reviewThreads.reply({ threadId: 'rt_1', role: 'human', body: 'Fixed' })).resolves.toEqual(thread)

    expect(listReviewThreads).toHaveBeenCalledWith(scope)
    expect(createReviewThread).toHaveBeenCalledWith(request)
    expect(replyToReviewThread).toHaveBeenCalledWith({ threadId: 'rt_1', role: 'human', body: 'Fixed' })
  })

  it('forwards Review Thread state writes through the runtime host', async () => {
    const thread = { id: 'rt_1', status: 'resolved', awaiting: 'error' }
    const setReviewThreadStatus = vi.fn().mockResolvedValue(thread)
    const setReviewThreadAwaiting = vi.fn().mockResolvedValue(thread)
    const markReviewThreadSeen = vi.fn().mockResolvedValue(thread)
    const registry = new RuntimeCommonApiRegistry(new RuntimeRegistryServices({
      pluginId: 'reviewer',
      projectId: null,
      host: { setReviewThreadStatus, setReviewThreadAwaiting, markReviewThreadSeen },
    }))
    const api = registry.createApi()

    await expect(api.reviewThreads.setStatus({ threadId: 'rt_1', status: 'resolved' })).resolves.toEqual(thread)
    await expect(api.reviewThreads.setAwaiting({ threadId: 'rt_1', awaiting: 'error' })).resolves.toEqual(thread)
    await expect(api.reviewThreads.markSeen({ threadId: 'rt_1' })).resolves.toEqual(thread)

    expect(setReviewThreadStatus).toHaveBeenCalledWith({ threadId: 'rt_1', status: 'resolved' })
    expect(setReviewThreadAwaiting).toHaveBeenCalledWith({ threadId: 'rt_1', awaiting: 'error' })
    expect(markReviewThreadSeen).toHaveBeenCalledWith({ threadId: 'rt_1' })
  })

  it.each(['setStatus', 'setAwaiting', 'markSeen'] as const)('reports %s as unavailable when the host cannot serve it', async (operation) => {
    const registry = new RuntimeCommonApiRegistry(new RuntimeRegistryServices({
      pluginId: 'reviewer',
      projectId: null,
      host: {},
    }))
    const api = registry.createApi()

    const call = {
      setStatus: () => api.reviewThreads.setStatus({ threadId: 'rt_1', status: 'resolved' as const }),
      setAwaiting: () => api.reviewThreads.setAwaiting({ threadId: 'rt_1', awaiting: 'error' as const }),
      markSeen: () => api.reviewThreads.markSeen({ threadId: 'rt_1' }),
    }[operation]

    await expect(call()).rejects.toThrow(`reviewThreads.${operation}`)
  })

  it('forwards scoped Review Thread subscriptions through the runtime host', async () => {
    const scope = { namespace: 'github', targetKey: 'gh:acme/web#1421', revision: 'sha-1' }
    const dispose = vi.fn()
    let hostHandler: ((event: typeof scope) => void) | null = null
    const subscribeReviewThreadChanges = vi.fn((_scope, handler) => {
      hostHandler = handler
      return { dispose }
    })
    const registry = new RuntimeCommonApiRegistry(new RuntimeRegistryServices({
      pluginId: 'reviewer',
      projectId: null,
      host: { subscribeReviewThreadChanges },
    }))
    const handler = vi.fn()

    const subscription = registry.createApi().reviewThreads.onDidChange(scope, handler)
    const observedHostHandler = hostHandler as ((event: typeof scope) => void) | null
    observedHostHandler?.(scope)

    expect(subscribeReviewThreadChanges).toHaveBeenCalledWith(scope, expect.any(Function))
    expect(handler).toHaveBeenCalledWith(scope)

    await subscription.dispose()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it.each([
    [{ namespace: '', targetKey: 'gh:acme/web#1421', revision: 'sha-1' }, "'namespace' must not be empty"],
    [{ namespace: 'github', targetKey: '  ', revision: 'sha-1' }, "'targetKey' must not be empty"],
    [{ namespace: 'github', targetKey: 'gh:acme/web#1421', revision: '' }, "'revision' must not be empty"],
  ])('rejects the Review Thread scope %o naming the offending field', async (scope, message) => {
    const listReviewThreads = vi.fn()
    const registry = new RuntimeCommonApiRegistry(new RuntimeRegistryServices({
      pluginId: 'reviewer',
      projectId: null,
      host: { listReviewThreads },
    }))

    await expect(registry.createApi().reviewThreads.list(scope)).rejects.toThrow(message)
    expect(listReviewThreads).not.toHaveBeenCalled()
  })

  it('forwards Agent Session page requests through the frontend runtime host', async () => {
    const page = {
      items: [{
        id: 'S-1', provider: 'pi', providerSessionId: 'pi-S-1', createdAt: 100, updatedAt: 200,
        task: { id: 'T-1', title: 'Import history', status: 'doing', createdAt: 50, updatedAt: 250 },
        workspace: { rootPath: '/repo', kind: 'project' },
      }],
      nextCursor: null,
    }
    const listAgentSessions = vi.fn().mockResolvedValue(page)
    const registry = new RuntimeCommonApiRegistry(new RuntimeRegistryServices({
      pluginId: 'usage',
      projectId: null,
      host: { listAgentSessions },
    }))
    const request = {
      provider: 'pi',
      overlaps: { startInclusive: 100, endExclusive: 300 },
      taskId: 'T-1',
      pageSize: 100,
    }

    await expect(registry.createApi().agentSessions.list(request)).resolves.toEqual(page)
    expect(listAgentSessions).toHaveBeenCalledWith(request)
  })

  it('binds scoped Agent Session lifecycle and invalidations to the plugin runtime host', async () => {
    const rawScope = { namespace: 'github-pr', targetKey: 'acme/openforge#42', revision: 'head-a' }
    const scope = new Proxy(rawScope, {})
    const state = {
      id: 'sas-1', status: 'running' as const, queuePosition: null, queueReason: null,
      acceptsInput: true, workspaceAvailable: true, errorCode: null, errorMessage: null,
      createdAt: 1, updatedAt: 2,
    }
    const startScopedAgentSession = vi.fn().mockResolvedValue(state)
    const getScopedAgentSessionStatus = vi.fn().mockResolvedValue(state)
    const inputScopedAgentSession = vi.fn().mockResolvedValue(state)
    const abortScopedAgentSession = vi.fn().mockResolvedValue({ ...state, status: 'aborted' })
    const releaseScopedAgentSession = vi.fn().mockResolvedValue(undefined)
    const unsubscribe = vi.fn()
    const subscribeScopedAgentSessionChanges = vi.fn((_scope, handler) => {
      handler(scope)
      return { dispose: unsubscribe }
    })
    const registry = new RuntimeCommonApiRegistry(new RuntimeRegistryServices({
      pluginId: 'github',
      projectId: 'P-1',
      host: {
        startScopedAgentSession,
        getScopedAgentSessionStatus,
        inputScopedAgentSession,
        abortScopedAgentSession,
        releaseScopedAgentSession,
        subscribeScopedAgentSessionChanges,
      },
    }))
    const api = registry.createApi().agentSessions
    const startRequest = {
      scope,
      projectId: 'P-1',
      checkoutRevision: 'head-a',
      initialInput: 'Review',
      toolPolicy: 'review-read-only',
    }

    await expect(api.start(startRequest)).resolves.toBe(state)
    await expect(api.status(scope)).resolves.toBe(state)
    await expect(api.input(scope, 'Follow up')).resolves.toBe(state)
    await expect(api.abort(scope)).resolves.toMatchObject({ status: 'aborted' })
    await expect(api.release(scope)).resolves.toBeUndefined()
    const handler = vi.fn()
    const subscription = api.onDidChange(scope, handler)
    expect(handler).toHaveBeenCalledWith(scope)
    await subscription.dispose()
    expect(unsubscribe).toHaveBeenCalledOnce()

    for (const forwarded of [
      startScopedAgentSession.mock.calls[0][0].scope,
      getScopedAgentSessionStatus.mock.calls[0][0],
      inputScopedAgentSession.mock.calls[0][0],
      abortScopedAgentSession.mock.calls[0][0],
      releaseScopedAgentSession.mock.calls[0][0],
      subscribeScopedAgentSessionChanges.mock.calls[0][0],
    ]) {
      expect(forwarded).toEqual(rawScope)
      expect(forwarded).not.toBe(scope)
      expect(() => structuredClone(forwarded)).not.toThrow()
    }
  })

  it('keeps terminal elements renderer-local while normalizing rune-derived scopes', async () => {
    vi.clearAllMocks()
    const rawScope = { namespace: 'github-pr', targetKey: 'acme/openforge#42', revision: 'head-a' }
    const scope = new Proxy(rawScope, {})
    const element = document.createElement('div')
    const detach = vi.fn()
    scopedEvents.subscribe.mockReturnValue(vi.fn())
    scopedEvents.ready.mockResolvedValue(undefined)
    scopedTerminal.acquire.mockResolvedValue({ key: 'scoped-terminal' })
    scopedTerminal.attach.mockResolvedValue({ detach })
    scopedSessionIpc.getScopedAgentSessionStatus.mockImplementation((_pluginId, forwardedScope) => {
      expect(forwardedScope).toEqual(rawScope)
      expect(forwardedScope).not.toBe(scope)
      expect(() => structuredClone(forwardedScope)).not.toThrow()
      return Promise.resolve({
        id: 'sas-1', turnId: null, status: 'running', queuePosition: null, queueReason: null,
        acceptsInput: true, workspaceAvailable: true, errorCode: null, errorMessage: null,
        createdAt: 1, updatedAt: 2,
      })
    })
    const host = createPluginAgentSessionHostCapabilities('github')
    const registry = new RuntimeCommonApiRegistry(new RuntimeRegistryServices({
      pluginId: 'github',
      projectId: 'P-1',
      host,
    }))

    const mounted = await registry.createFrontendApi().agentSessions.mountTerminal(scope, element)

    expect(scopedSessionIpc.getScopedAgentSessionStatus).toHaveBeenCalledWith('github', rawScope)
    expect(scopedSessionIpc.getScopedAgentSessionStatus.mock.calls.flat()).not.toContain(element)
    expect(scopedTerminal.attach).toHaveBeenCalledWith(
      { key: 'scoped-terminal' },
      expect.any(HTMLDivElement),
    )
    expect(element.contains(scopedTerminal.attach.mock.calls[0][1])).toBe(true)
    await mounted.dispose()
    expect(detach).toHaveBeenCalledOnce()
  })

  it('warns once per activation while preserving every legacy Task list result', async () => {
    const legacyTasks = [{ id: 'T-1' }, { id: 'T-2' }] as never
    const listTasks = vi.fn().mockResolvedValue(legacyTasks)
    const getTask = vi.fn().mockResolvedValue(legacyTasks[0])
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const registry = new RuntimeCommonApiRegistry(new RuntimeRegistryServices({
      pluginId: 'legacy-plugin',
      projectId: null,
      host: { listTasks, getTask },
    }))
    const api = registry.createApi()

    await expect(api.tasks.list()).resolves.toBe(legacyTasks)
    await expect(api.tasks.list({ projectId: 'P-1', includeDone: true })).resolves.toBe(legacyTasks)
    await expect(api.tasks.get('T-1')).resolves.toBe(legacyTasks[0])

    expect(listTasks).toHaveBeenCalledTimes(2)
    expect(warning).toHaveBeenCalledOnce()
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('tasks.list() and tasks.get() are deprecated'))
    warning.mockRestore()
  })


  it('creates isolated capability facades over shared registry state', () => {
    const registry = new RuntimeCommonApiRegistry(
      new RuntimeRegistryServices({ pluginId: 'github', projectId: 'project-1' }),
    )

    const frontendCommonApi = registry.createApi()
    const backendCommonApi = registry.createApi()

    expect(frontendCommonApi).not.toBe(backendCommonApi)
    expect(frontendCommonApi.commands).not.toBe(backendCommonApi.commands)
    expect(frontendCommonApi.events).not.toBe(backendCommonApi.events)
    expect(frontendCommonApi.tasks).not.toBe(backendCommonApi.tasks)
  })
})
