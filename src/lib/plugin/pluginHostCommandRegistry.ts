export type PluginHostCommandPayload = Record<string, unknown> | undefined

export type PluginHostCommandHandler = (
  payload: PluginHostCommandPayload,
  ownerPluginId?: string,
) => unknown | Promise<unknown>

export type PluginHostCommandEntries = ReadonlyArray<readonly [
  command: string,
  handler: PluginHostCommandHandler,
]>

export type PluginHostCommandDispatcher = (
  command: string,
  payload?: unknown,
  ownerPluginId?: string,
) => Promise<unknown>

function normalizeCommandPayload(payload: unknown): PluginHostCommandPayload {
  return payload !== null && typeof payload === 'object'
    ? payload as Record<string, unknown>
    : undefined
}

export function createPluginHostCommandDispatcher(
  ...groups: ReadonlyArray<PluginHostCommandEntries>
): PluginHostCommandDispatcher {
  const handlers = new Map<string, PluginHostCommandHandler>()

  for (const group of groups) {
    for (const [command, handler] of group) {
      if (handlers.has(command)) {
        throw new Error(`Duplicate plugin host command: ${command}`)
      }
      handlers.set(command, handler)
    }
  }

  return async (command, payload, ownerPluginId) => {
    const handler = handlers.get(command)
    if (!handler) {
      throw new Error(`Unknown plugin host command: ${command}`)
    }
    return handler(normalizeCommandPayload(payload), ownerPluginId)
  }
}
