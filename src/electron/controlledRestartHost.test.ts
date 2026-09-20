import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { createControlledRestartHost } from './controlledRestartHost'

it('aborts replacement when a legacy process appeared during workspace capture', async () => {
  const root = await mkdtemp(join(tmpdir(), 'openforge-controlled-restart-'))
  try {
    const controller = { installation: 'daemon-installation', lifetime: 'daemon', generation: 1 }
    const inventory = vi.fn().mockResolvedValueOnce({ controller, sessions: [], hasLegacySessions: false }).mockResolvedValue({ controller, sessions: [], hasLegacySessions: true })
    const replace = vi.fn(async () => undefined)
    const host = await createControlledRestartHost({ root, operationId: null, inventory, replace })
    const send = vi.fn()
    host.register(10, 'stable', send)
    const rejected = expect(host.handle(10, 'controlled_restart', {})).rejects.toThrow('legacy')
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce())
    await host.handle(10, 'capture_restart_workspace', { operationId: send.mock.calls[0][0], snapshot: { navigation: { projectId: null, taskId: null, view: 'board' }, tasks: [] } })
    await rejected
    expect(replace).not.toHaveBeenCalled()
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('does not restore a workspace against a different daemon installation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'openforge-controlled-restart-'))
  try {
    const controller = { installation: 'daemon-installation', lifetime: 'daemon', generation: 1 }
    const inventory = vi.fn(async () => ({ controller, sessions: [], hasLegacySessions: false }))
    const replace = vi.fn(async () => undefined)
    const host = await createControlledRestartHost({ root, operationId: null, inventory, replace })
    const send = vi.fn()
    host.register(10, 'stable', send)
    const restart = host.handle(10, 'controlled_restart', {})
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce())
    const operationId = send.mock.calls[0][0]
    await host.handle(10, 'capture_restart_workspace', { operationId, snapshot: { navigation: { projectId: null, taskId: null, view: 'board' }, tasks: [] } })
    await restart
    const other = await createControlledRestartHost({ root, operationId, replace, inventory: async () => ({ controller: { ...controller, installation: 'other-daemon' }, sessions: [], hasLegacySessions: false }) })
    expect(await other.launchWindowIds()).not.toContain('stable')
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('rejects another restart after replacement is authorized but Electron has not exited yet', async () => {
  const root = await mkdtemp(join(tmpdir(), 'openforge-controlled-restart-'))
  try {
    const controller = { installation: 'daemon-installation', lifetime: 'daemon', generation: 1 }
    const host = await createControlledRestartHost({
      root, operationId: null,
      inventory: async () => ({ controller, sessions: [], hasLegacySessions: false }),
      replace: async () => undefined,
    })
    let captureOperation = ''
    host.register(10, 'stable', operation => { captureOperation = operation })
    const restart = host.handle(10, 'controlled_restart', {})
    await vi.waitFor(() => expect(captureOperation).not.toBe(''))
    await host.handle(10, 'capture_restart_workspace', {
      operationId: captureOperation,
      snapshot: { navigation: { projectId: null, taskId: null, view: 'board' }, tasks: [] },
    })
    await restart
    await expect(host.handle(10, 'controlled_restart', {})).rejects.toThrow('restart already')
  } finally { await rm(root, { recursive: true, force: true }) }
})

it.each(['restart', 'update'] as const)('retains %s intent across controller replacement until the workspace is restored', async intent => {
  const root = await mkdtemp(join(tmpdir(), 'openforge-controlled-restart-'))
  try {
    const controller = { installation: 'daemon-installation', lifetime: 'daemon', generation: 1 }
    const options = {
      root, intent, replace: async () => undefined,
      inventory: async () => ({ controller, sessions: [], hasLegacySessions: false }),
    }
    const host = await createControlledRestartHost({ ...options, operationId: null })
    expect(await host.shutdownIntent()).toBe('quit')
    let operationId = ''
    host.register(10, 'stable', operation => { operationId = operation })
    const restart = host.handle(10, 'controlled_restart', {})
    await vi.waitFor(() => expect(operationId).not.toBe(''))
    await host.handle(10, 'capture_restart_workspace', {
      operationId, snapshot: { navigation: { projectId: null, taskId: null, view: 'board' }, tasks: [] },
    })
    await restart
    expect(await host.shutdownIntent()).toBe(intent)
    const replacement = await createControlledRestartHost({
      ...options, operationId,
      inventory: async () => ({ controller: { ...controller, generation: 2 }, sessions: [], hasLegacySessions: false }),
    })
    expect(await replacement.shutdownIntent()).toBe(intent)
    expect(await replacement.launchWindowIds()).toEqual(['stable'])
    replacement.register(20, 'stable', () => undefined)
    await replacement.handle(20, 'complete_restart_workspace', { operationId })
    expect(await replacement.shutdownIntent()).toBe('quit')
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('refuses detach if controller ownership changes during workspace capture', async () => {
  const root = await mkdtemp(join(tmpdir(), 'openforge-controlled-restart-'))
  try {
    const controller = { installation: 'daemon-installation', lifetime: 'daemon', generation: 1 }
    let generation = 1
    const replace = vi.fn(async () => undefined)
    const host = await createControlledRestartHost({
      root, operationId: null, replace,
      inventory: async () => ({ controller: { ...controller, generation }, sessions: [], hasLegacySessions: false }),
    })
    let operationId = ''
    host.register(10, 'stable', operation => { operationId = operation })
    const rejected = expect(host.handle(10, 'controlled_restart', {})).rejects.toThrow('controller')
    await vi.waitFor(() => expect(operationId).not.toBe(''))
    generation = 2
    await host.handle(10, 'capture_restart_workspace', {
      operationId, snapshot: { navigation: { projectId: null, taskId: null, view: 'board' }, tasks: [] },
    })
    await rejected
    expect(replace).not.toHaveBeenCalled()
    expect(await host.shutdownIntent()).toBe('quit')
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('keeps authorized restart intent when relaunch fails and refuses another operation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'openforge-controlled-restart-'))
  try {
    const controller = { installation: 'daemon-installation', lifetime: 'daemon', generation: 1 }
    const options = {
      root, operationId: null,
      inventory: async () => ({ controller, sessions: [], hasLegacySessions: false }),
      replace: async () => { throw new Error('Relaunch failed') },
    }
    const host = await createControlledRestartHost(options)
    let operationId = ''
    host.register(10, 'stable', operation => { operationId = operation })
    const rejected = expect(host.handle(10, 'controlled_restart', {})).rejects.toThrow('Relaunch failed')
    await vi.waitFor(() => expect(operationId).not.toBe(''))
    await host.handle(10, 'capture_restart_workspace', {
      operationId, snapshot: { navigation: { projectId: null, taskId: null, view: 'board' }, tasks: [] },
    })
    await rejected
    const reopened = await createControlledRestartHost(options)
    expect(await reopened.shutdownIntent()).toBe('restart')
    reopened.register(20, 'other', () => undefined)
    await expect(reopened.handle(20, 'controlled_restart', {})).rejects.toThrow('Restart already')
    expect(await reopened.shutdownIntent()).toBe('restart')
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('does not commit restoration after another controller takes ownership', async () => {
  const root = await mkdtemp(join(tmpdir(), 'openforge-controlled-restart-'))
  try {
    const controller = { installation: 'daemon-installation', lifetime: 'daemon', generation: 1 }
    let generation = 1
    const options = {
      root, replace: async () => undefined,
      inventory: async () => ({ controller: { ...controller, generation }, sessions: [], hasLegacySessions: false }),
    }
    const host = await createControlledRestartHost({ ...options, operationId: null })
    let operationId = ''
    host.register(10, 'stable', operation => { operationId = operation })
    const restart = host.handle(10, 'controlled_restart', {})
    await vi.waitFor(() => expect(operationId).not.toBe(''))
    await host.handle(10, 'capture_restart_workspace', {
      operationId, snapshot: { navigation: { projectId: null, taskId: null, view: 'board' }, tasks: [] },
    })
    await restart
    generation = 2
    const replacement = await createControlledRestartHost({ ...options, operationId })
    replacement.register(20, 'stable', () => undefined)
    generation = 3
    await expect(replacement.handle(20, 'complete_restart_workspace', { operationId })).rejects.toThrow('controller')
    expect(await replacement.shutdownIntent()).toBe('restart')
    expect(await replacement.handle(20, 'get_restart_workspace', {})).not.toBeNull()
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('fences the backend before capturing windows and authorizes detach before relaunch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'openforge-controlled-restart-'))
  try {
    const controller = { installation: 'daemon-installation', lifetime: 'daemon', generation: 1 }
    let fenced = false
    let detached = false
    let capturedWhileFenced = false
    let relaunchedAfterDetach = false
    const host = await createControlledRestartHost({
      root, operationId: null,
      inventory: async () => ({ controller, sessions: [], hasLegacySessions: false }),
      backend: {
        prepare: async () => { fenced = true },
        cancel: async () => { fenced = false },
        detach: async () => { detached = true },
        commit: async () => { fenced = false },
      },
      replace: async () => { relaunchedAfterDetach = detached },
    })
    let operationId = ''
    host.register(10, 'stable', operation => { operationId = operation; capturedWhileFenced = fenced })
    const restart = host.handle(10, 'controlled_restart', {})
    await vi.waitFor(() => expect(operationId).not.toBe(''))
    await host.handle(10, 'capture_restart_workspace', {
      operationId, snapshot: { navigation: { projectId: null, taskId: null, view: 'board' }, tasks: [] },
    })
    await restart
    expect(capturedWhileFenced).toBe(true)
    expect(relaunchedAfterDetach).toBe(true)
  } finally { await rm(root, { recursive: true, force: true }) }
})
