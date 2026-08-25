import type { TerminalAuthorityBinding, TerminalQueryResponseWrite } from './terminalAuthority'
import type { TerminalView, TerminalViewDisposable } from './terminalView'
import type { Readable } from 'svelte/store'
import type { ThemeMode } from './theme'

export type TerminalRuntimeUnlistenFn = () => void

export interface TerminalRuntimeEvent<TPayload> {
  payload: TPayload
}

export interface PtyOutputEventPayload {
  task_id: string
  data: string
  instance_id: number
}


export type TerminalStateSource = 'bootstrapping' | 'pty-byte-replay'

export interface PtyExitEventPayload {
  instance_id: number
}

export function ptyOutputEventName(terminalKey: string): `pty-output-${string}` {
  return `pty-output-${terminalKey}`
}


export function ptyExitEventName(terminalKey: string): `pty-exit-${string}` {
  return `pty-exit-${terminalKey}`
}

export interface AppEventsReconnectedPayload {
  attempt: number
  reconnectedAt: string
}

export type TerminalRuntimeEventName =
  | `pty-output-${string}`
  | `pty-exit-${string}`
  | 'openforge-app-events-reconnected'
export type TerminalRuntimeEventPayload<TEventName extends TerminalRuntimeEventName> =
  TEventName extends `pty-output-${string}`
    ? PtyOutputEventPayload
    : TEventName extends `pty-exit-${string}`
      ? PtyExitEventPayload
      : AppEventsReconnectedPayload

export interface PtyBufferState {
  buffer: string | null
  isLive: boolean
  instanceId: number | null
}

export interface TerminalRuntimeHost {
  listenEvent<TEventName extends TerminalRuntimeEventName>(
    eventName: TEventName,
    handler: (event: TerminalRuntimeEvent<TerminalRuntimeEventPayload<TEventName>>) => void,
  ): Promise<TerminalRuntimeUnlistenFn>
  getPtyBuffer(taskId: string): Promise<PtyBufferState>
  writePty(taskId: string, data: string): Promise<void>
  writeTerminalQueryResponse(response: TerminalQueryResponseWrite): Promise<void>
  resizePty(taskId: string, cols: number, rows: number): Promise<void>
  openLink(terminalKey: string, url: string): Promise<void>
  themeMode?: Readable<ThemeMode>
  loggerName?: string
  enableImages?: boolean
}

export interface PoolEntry {
  shellSessionKey: string
  view: TerminalView
  ptyActive: boolean
  needsClear: boolean
  unlisteners: TerminalRuntimeUnlistenFn[]
  viewSubscriptions: TerminalViewDisposable[]
  resizeObserver: ResizeObserver | null
  visibilityObserver: IntersectionObserver | null
  resizeTimeout: ReturnType<typeof setTimeout> | null
  attached: boolean
  spawnPending: boolean
  currentPtyInstance: number | null
  authority: TerminalAuthorityBinding | null
  terminalStateSource: TerminalStateSource
  pendingPtyOutput: PtyOutputEventPayload[]
  terminalReplayRecovery: Promise<void> | null
  hasOutput: boolean
}

export interface TerminalTab {
  index: number
  key: string
  label: string
}

export interface TaskTerminalTabsSession {
  tabs: TerminalTab[]
  activeTabIndex: number
  nextIndex: number
}

export interface ShellLifecycleState {
  ptyActive: boolean
  shellExited: boolean
  currentPtyInstance: number | null
  hasOutput: boolean
}

export type ShellLifecycleListener = (state: ShellLifecycleState) => void
