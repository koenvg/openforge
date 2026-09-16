import type { PtyBufferState, ShellAPI, ShellSessionRequest } from '@openforge-app/plugin-sdk'

type Callback = <T>(method: string, params: Record<string, unknown>) => Promise<T>

/** Each plugin activation holds only session identities, never a PTY or daemon controller. */
export function createBackendShellApi(callback: Callback): ShellAPI {
  const instances = new Map<string, number>()
  const reads = new Map<string, number>()
  const key = (request: ShellSessionRequest) => JSON.stringify([request.taskId, request.terminalIndex])
  function beginRead(request: ShellSessionRequest) {
    const id = key(request)
    const revision = (reads.get(id) ?? 0) + 1
    reads.set(id, revision)
    return (instance: number | null | undefined) => {
      if (reads.get(id) !== revision) return
      if (typeof instance === 'number') instances.set(id, instance)
      else instances.delete(id)
    }
  }
  function mutation(method: string, request: ShellSessionRequest) {
    // Capture before yielding. A later reattachment cannot retarget an in-flight command.
    const instanceId = instances.get(key(request))
    return callback<void>(method, { ...request, instanceId })
  }
  return {
    async spawn(request) {
      const remember = beginRead(request)
      const instance = await callback<number>('openforge.shell.spawn', { ...request })
      remember(instance)
      return instance
    },
    write: request => mutation('openforge.shell.write', request),
    resize: request => mutation('openforge.shell.resize', request),
    kill: request => mutation('openforge.shell.kill', request),
    async getBuffer(request) {
      const remember = beginRead(request)
      const state = await callback<PtyBufferState>('openforge.shell.getBuffer', { ...request })
      remember(state.instanceId)
      return state
    },
  }
}
