import { parsePtySessionKey } from './ptySessionKey'
import type { PoolEntry, TerminalRuntime } from './terminalRuntime'

type SharedTerminalRuntimeOperations = Omit<
  TerminalRuntime,
  'acquire' | 'release' | 'releaseAll' | 'releaseAllForTask' | 'dispose' | '_getPool'
>

export interface TerminalSessionClient extends SharedTerminalRuntimeOperations {
  acquire(shellSessionKey: string): Promise<PoolEntry>
  release(shellSessionKey: string): void
  releaseAll(): void
  releaseAllForTask(taskId: string): number
}

export interface TerminalSessionService {
  createClient(ownerId: string): TerminalSessionClient
  releaseAll(): void
  dispose(): void
}

export interface TerminalSessionServiceOptions {
  afterAcquire?(entry: PoolEntry): Promise<void> | undefined
}

export function createTerminalSessionService(
  runtime: TerminalRuntime,
  options: TerminalSessionServiceOptions = {},
): TerminalSessionService {
  const ownersBySession = new Map<string, Set<string>>()
  const sessionsByOwner = new Map<string, Set<string>>()

  function ownerSessions(ownerId: string): Set<string> {
    const existing = sessionsByOwner.get(ownerId)
    if (existing) return existing
    const sessions = new Set<string>()
    sessionsByOwner.set(ownerId, sessions)
    return sessions
  }

  function addOwner(ownerId: string, shellSessionKey: string): boolean {
    const sessions = ownerSessions(ownerId)
    if (sessions.has(shellSessionKey)) return false
    sessions.add(shellSessionKey)
    const owners = ownersBySession.get(shellSessionKey) ?? new Set<string>()
    owners.add(ownerId)
    ownersBySession.set(shellSessionKey, owners)
    return true
  }

  function removeOwner(ownerId: string, shellSessionKey: string): boolean {
    const sessions = sessionsByOwner.get(ownerId)
    if (!sessions?.delete(shellSessionKey)) return false
    if (sessions.size === 0) sessionsByOwner.delete(ownerId)

    const owners = ownersBySession.get(shellSessionKey)
    owners?.delete(ownerId)
    if (owners && owners.size > 0) return true

    ownersBySession.delete(shellSessionKey)
    runtime.release(shellSessionKey)
    return true
  }

  function createClient(ownerId: string): TerminalSessionClient {
    if (!ownerId) throw new Error('Terminal Session client requires an owner ID')

    const {
      acquire: _acquire,
      release: _release,
      releaseAll: _releaseAll,
      releaseAllForTask: _releaseAllForTask,
      dispose: _dispose,
      _getPool,
      ...sharedOperations
    } = runtime
    void _acquire
    void _release
    void _releaseAll
    void _releaseAllForTask
    void _dispose
    void _getPool

    async function acquire(shellSessionKey: string): Promise<PoolEntry> {
      const ownerAdded = addOwner(ownerId, shellSessionKey)
      try {
        const entry = await runtime.acquire(shellSessionKey)
        const checkpoint = options.afterAcquire?.(entry)
        if (checkpoint) await checkpoint
        return entry
      } catch (error) {
        if (ownerAdded) removeOwner(ownerId, shellSessionKey)
        throw error
      }
    }

    function release(shellSessionKey: string): void {
      removeOwner(ownerId, shellSessionKey)
    }

    function releaseAll(): void {
      for (const shellSessionKey of [...(sessionsByOwner.get(ownerId) ?? [])]) {
        removeOwner(ownerId, shellSessionKey)
      }
    }

    function releaseAllForTask(taskId: string): number {
      const matchingSessions = [...(sessionsByOwner.get(ownerId) ?? [])]
        .filter((shellSessionKey) => {
          const session = parsePtySessionKey(shellSessionKey)
          return session.kind === 'indexed-shell' && session.taskId === taskId
        })
      for (const shellSessionKey of matchingSessions) removeOwner(ownerId, shellSessionKey)
      return matchingSessions.length
    }

    return { ...sharedOperations, acquire, release, releaseAll, releaseAllForTask }
  }

  function releaseAll(): void {
    ownersBySession.clear()
    sessionsByOwner.clear()
    runtime.releaseAll()
  }

  function dispose(): void {
    ownersBySession.clear()
    sessionsByOwner.clear()
    runtime.dispose()
  }

  return { createClient, releaseAll, dispose }
}
