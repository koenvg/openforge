import { describe, expect, it, vi } from 'vitest'
import type { PluginStorageScope, ScopedAgentSessionState, ScopedAgentSessionStatus, SessionScope } from '@openforge-app/plugin-sdk'
import { createOpenForgeRegistryFake } from '@openforge-app/plugin-sdk/testing'
import {
  createPrReviewAgentAttentionController,
  prReviewAgentAttentionStorageKey,
} from './usePrReviewAgentAttention.svelte'

const scope: SessionScope = {
  namespace: 'github',
  targetKey: 'gh:acme/web#42',
  revision: 'head-a',
}

function session(status: ScopedAgentSessionStatus, turnId: string | null): ScopedAgentSessionState {
  return {
    id: 'sas-1', turnId, status, queuePosition: null, queueReason: null,
    acceptsInput: true, workspaceAvailable: true, errorCode: null, errorMessage: null,
    createdAt: 1, updatedAt: 2,
  }
}

function setup() {
  const registry = createOpenForgeRegistryFake({
    pluginId: 'com.openforge.github-sync',
    projectId: 'P-1',
  })
  const controller = createPrReviewAgentAttentionController(registry.frontendApi.storage.global)
  return { registry, controller }
}

describe('pull request review agent attention', () => {
  it.each([
    ['queued', null, true],
    ['starting', null, true],
    ['running', 'turn-1', true],
    ['running', null, false],
    ['paused', 'turn-1', false],
    ['completed', 'turn-1', false],
    ['failed', 'turn-1', false],
    ['aborted', 'turn-1', false],
    ['interrupted', 'turn-1', false],
  ] satisfies [ScopedAgentSessionStatus, string | null, boolean][])('%s with turn %s derives running=%s', async (status, turnId, expected) => {
    const { controller } = setup()

    await controller.observe(scope, session(status, turnId))

    expect(controller.isRunning).toBe(expected)
  })

  it.each([
    'paused',
    'completed',
    'failed',
    'aborted',
    'interrupted',
  ] satisfies ScopedAgentSessionStatus[])('marks retained %s output unread while it is not presented', async (status) => {
    const { controller } = setup()

    await controller.observe(scope, session(status, 'turn-1'))

    expect(controller.hasUnreadOutput).toBe(true)
  })

  it('acknowledges a stopped turn only after all presentation gates are true', async () => {
    const { controller } = setup()
    await controller.observe(scope, session('completed', 'turn-1'))

    controller.setAgentTabActive(true)
    controller.setTerminalReady(true)
    controller.setDocumentVisible(true)
    expect(controller.hasUnreadOutput).toBe(true)

    controller.setWindowFocused(true)

    await vi.waitFor(() => expect(controller.hasUnreadOutput).toBe(false))
  })

  it('keeps older unread output while a newer turn runs', async () => {
    const { controller } = setup()
    await controller.observe(scope, session('completed', 'turn-1'))

    await controller.observe(scope, session('running', 'turn-2'))

    expect(controller.isRunning).toBe(true)
    expect(controller.hasUnreadOutput).toBe(true)
  })

  it('isolates exact heads and restores persisted unread state', async () => {
    const { registry, controller } = setup()
    const nextHead = { ...scope, revision: 'head-b' }
    await controller.observe(scope, session('completed', 'turn-a'))

    await controller.observe(nextHead, session('running', null))
    expect(controller.hasUnreadOutput).toBe(false)

    const restored = createPrReviewAgentAttentionController(registry.frontendApi.storage.global)
    await restored.observe(scope, session('completed', 'turn-a'))
    expect(restored.hasUnreadOutput).toBe(true)
  })

  it('requires terminal readiness from the newly observed scope before acknowledging it', async () => {
    const { registry, controller } = setup()
    const nextHead = { ...scope, revision: 'head-b' }
    await controller.observe(scope, session('running', null))
    controller.setAgentTabActive(true)
    controller.setTerminalReady(true)
    controller.setDocumentVisible(true)
    controller.setWindowFocused(true)
    await registry.frontendApi.storage.global.set(prReviewAgentAttentionStorageKey(nextHead), {
      version: 1,
      viewedTurnId: null,
      unreadTurnId: 'turn-b',
    })

    await controller.observe(nextHead, session('completed', 'turn-b'))

    expect(controller.hasUnreadOutput).toBe(true)
    controller.setTerminalReady(true)
    await vi.waitFor(() => expect(controller.hasUnreadOutput).toBe(false))
  })

  it('restores a persisted acknowledgement without marking the same turn unread again', async () => {
    const { registry, controller } = setup()
    await controller.observe(scope, session('running', null))
    controller.setAgentTabActive(true)
    controller.setTerminalReady(true)
    controller.setDocumentVisible(true)
    controller.setWindowFocused(true)
    await controller.observe(scope, session('completed', 'turn-1'))
    expect(controller.hasUnreadOutput).toBe(false)

    const restored = createPrReviewAgentAttentionController(registry.frontendApi.storage.global)
    await restored.observe(scope, session('completed', 'turn-1'))

    expect(restored.hasUnreadOutput).toBe(false)
  })

  it('keeps conservative in-memory unread state when storage fails', async () => {
    const failure = new Error('storage unavailable')
    const storage: PluginStorageScope = {
      get: vi.fn(async () => { throw failure }),
      set: vi.fn(async () => { throw failure }),
      delete: vi.fn(async () => { throw failure }),
    }
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const controller = createPrReviewAgentAttentionController(storage)

    await controller.observe(scope, session('failed', 'turn-1'))

    expect(controller.hasUnreadOutput).toBe(true)
    expect(log).toHaveBeenCalled()
  })

  it('does not let a delayed acknowledgement clear a newer stopped turn', async () => {
    const { registry, controller } = setup()
    await controller.observe(scope, session('completed', 'turn-1'))
    const realSet = registry.frontendApi.storage.global.set.bind(registry.frontendApi.storage.global)
    let releaseAcknowledgement!: () => void
    const acknowledgementGate = new Promise<void>(resolve => { releaseAcknowledgement = resolve })
    let writes = 0
    registry.frontendApi.storage.global.set = vi.fn(async (key, value) => {
      writes += 1
      if (writes === 1) await acknowledgementGate
      await realSet(key, value)
    })

    controller.setAgentTabActive(true)
    controller.setTerminalReady(true)
    controller.setDocumentVisible(true)
    controller.setWindowFocused(true)
    await vi.waitFor(() => expect(registry.frontendApi.storage.global.set).toHaveBeenCalledOnce())
    controller.setTerminalReady(false)
    const newerStop = controller.observe(scope, session('completed', 'turn-2'))

    expect(controller.hasUnreadOutput).toBe(true)
    releaseAcknowledgement()
    await newerStop
    expect(controller.hasUnreadOutput).toBe(true)
    await expect(registry.frontendApi.storage.global.get(prReviewAgentAttentionStorageKey(scope)))
      .resolves.toMatchObject({ unreadTurnId: 'turn-2' })
  })

  it('deletes an explicitly released scope receipt and treats a later stopped session as new', async () => {
    const { registry, controller } = setup()
    const key = prReviewAgentAttentionStorageKey(scope)
    await controller.observe(scope, session('completed', 'turn-1'))
    await expect(registry.frontendApi.storage.global.get(key)).resolves.toMatchObject({ unreadTurnId: 'turn-1' })

    await controller.deleteReceipt(scope)

    expect(controller.hasUnreadOutput).toBe(false)
    await expect(registry.frontendApi.storage.global.get(key)).resolves.toBeNull()
    await controller.observe(scope, session('completed', 'turn-2'))
    expect(controller.hasUnreadOutput).toBe(true)
    await expect(registry.frontendApi.storage.global.get(key)).resolves.toMatchObject({ unreadTurnId: 'turn-2' })
  })
})
