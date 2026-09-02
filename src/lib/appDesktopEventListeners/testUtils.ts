import { vi } from 'vitest'
import type { DesktopUnlistenFn } from '../desktopIpc'
import type { AgentSession } from '../types'
import type {
  AppDesktopEventDeps,
  AppEventListen,
  DesktopEventListenerRegistration,
} from './types'

export function createSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: 'session-1',
    ticket_id: 'task-1',
    provider: 'opencode',
    opencode_session_id: 'provider-session-1',
    claude_session_id: null,
    pi_session_id: null,
    grok_session_id: null,
    output_revision: 0,
    viewed_output_revision: 0,
    status: 'running',
    stage: 'running',
    checkpoint_data: null,
    error_message: null,
    created_at: 1,
    updated_at: 1,
    ...overrides,
    pty_instance_id: overrides.pty_instance_id ?? null,
  }
}

export function createAppDesktopEventHarness() {
  const handlers = new Map<string, (event: { payload: unknown }) => unknown>()
  const closeUnlistener: DesktopUnlistenFn = vi.fn()
  const eventUnlisteners: DesktopUnlistenFn[] = []
  const listen = vi.fn(async (eventName: string, handler: (event: { payload: unknown }) => unknown) => {
    handlers.set(eventName, handler)
    const unlistener: DesktopUnlistenFn = vi.fn()
    eventUnlisteners.push(unlistener)
    return unlistener
  })
  const onCloseRequested = vi.fn(async () => closeUnlistener)

  const deps: AppDesktopEventDeps = {
    appWindow: { onCloseRequested },
    onCloseRequested: vi.fn(),
    loadTasks: vi.fn(async () => undefined),
    loadSessions: vi.fn(async () => undefined),
    loadPullRequests: vi.fn(async () => undefined),
    loadProjectAttention: vi.fn(async () => undefined),
    refreshPrCounts: vi.fn(async () => undefined),
    getActiveProjectId: vi.fn(() => 'P-1' as string | null),
    reloadInstalledPluginMetadata: vi.fn(async () => true),
    reloadPluginForProject: vi.fn(async () => true),
    loadEnabledPluginsForProject: vi.fn(async () => undefined),
    listen: listen as unknown as AppEventListen,
  }

  return { handlers, deps, closeUnlistener, eventUnlisteners, listen, onCloseRequested }
}

export async function registerEventListenerGroup(
  listeners: Record<string, DesktopEventListenerRegistration>,
  listen: AppEventListen,
): Promise<void> {
  for (const listener of Object.values(listeners)) {
    await listener.register(listen)
  }
}
