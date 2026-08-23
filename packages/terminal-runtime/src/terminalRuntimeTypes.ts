import type { FitAddon } from '@xterm/addon-fit'
import type { ImageAddon } from '@xterm/addon-image'
import type { WebglAddon } from '@xterm/addon-webgl'
import type { IDisposable, Terminal } from '@xterm/xterm'
import type { Readable } from 'svelte/store'
import type { TerminalImageProtocol } from './terminalImages'
import type { ThemeMode } from './theme'

export type TerminalRuntimeUnlistenFn = () => void

export interface TerminalRuntimeEvent<TPayload> {
  payload: TPayload
}

export interface PtyEvent {
  data?: string | null
  instance_id?: number | null
}

export interface PtyBufferState {
  buffer: string | null
  isLive: boolean
}

export interface TerminalRuntimeHost {
  listenEvent<TPayload>(eventName: string, handler: (event: TerminalRuntimeEvent<TPayload>) => void): Promise<TerminalRuntimeUnlistenFn>
  getPtyBuffer(taskId: string): Promise<PtyBufferState>
  writePty(taskId: string, data: string): Promise<void>
  resizePty(taskId: string, cols: number, rows: number): Promise<void>
  openLink(terminalKey: string, url: string): Promise<void>
  themeMode?: Readable<ThemeMode>
  loggerName?: string
  enableImages?: boolean
}

export interface PoolEntry {
  taskId: string
  terminal: Terminal
  fitAddon: FitAddon
  hostDiv: HTMLDivElement
  ptyActive: boolean
  needsClear: boolean
  unlisteners: TerminalRuntimeUnlistenFn[]
  resizeObserver: ResizeObserver | null
  visibilityObserver: IntersectionObserver | null
  resizeTimeout: ReturnType<typeof setTimeout> | null
  attached: boolean
  spawnPending: boolean
  currentPtyInstance: number | null
  hasOutput: boolean
  imageAddon: ImageAddon | null
  imageProtocol: TerminalImageProtocol | null
  webglAddon: WebglAddon | null
  webglContextLossDisposable: IDisposable | null
  webglUnavailable: boolean
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
