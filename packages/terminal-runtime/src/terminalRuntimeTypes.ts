import type { TerminalAuthorityBinding } from './terminalAuthority'
import type {
  TerminalModelOutputEvent,
  TerminalOutputEvent,
  TerminalTransportDisposable,
} from './terminalTransport'
import type { TerminalView, TerminalViewDisposable } from './terminalView'
import type { Readable } from 'svelte/store'
import type { ThemeMode } from './theme'

export type TerminalRuntimeUnlistenFn = () => void

export type TerminalStateSource = 'bootstrapping' | 'pty-byte-replay' | 'ghostty-snapshot'

export interface TerminalSessionConfiguration {
  renderer: 'xterm'
  enableImages?: boolean
}

export interface TerminalRuntimeEnvironment {
  openLink(shellSessionKey: string, url: string): Promise<void>
  sampleSessionConfiguration?(shellSessionKey: string): TerminalSessionConfiguration
  themeMode?: Readable<ThemeMode>
  loggerName?: string
  enableImages?: boolean
}

export interface PoolEntry {
  shellSessionKey: string
  view: TerminalView
  ptyActive: boolean
  needsClear: boolean
  shellExited: boolean
  transportSubscription: TerminalTransportDisposable | null
  viewSubscriptions: TerminalViewDisposable[]
  resizeObserver: ResizeObserver | null
  visibilityObserver: IntersectionObserver | null
  resizeTimeout: ReturnType<typeof setTimeout> | null
  attached: boolean
  attachmentGeneration: number
  spawnPending: boolean
  currentPtyInstance: number | null
  authority: TerminalAuthorityBinding | null
  terminalStateSource: TerminalStateSource
  pendingPtyOutput: TerminalOutputEvent[]
  terminalModelSequence: number | null
  pendingTerminalModelOutput: TerminalModelOutputEvent[]
  terminalReplayRecovery: Promise<void> | null
  hasOutput: boolean
  outputSequence: number
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
