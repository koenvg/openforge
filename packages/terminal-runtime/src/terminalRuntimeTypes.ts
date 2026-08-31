import type { Readable } from 'svelte/store'
import type { LiveModelOutputSubscriptionSnapshot } from './liveModelOutputSubscription'
import type { TerminalImageProtocol } from './terminalImages'
import type { TerminalOutputObservation } from './terminalOutputObservation'
import type { TerminalPerformanceTrace } from './terminalPerformanceTrace'
import type { ThemeMode } from './theme'
import type { TerminalGeometry } from './terminalTransport'
import type {
  TerminalViewPresentationEvidence,
  TerminalViewPresentationSnapshot,
} from './terminalView'

export type TerminalRuntimeUnlistenFn = () => void

export type TerminalStateSource = 'bootstrapping' | 'ghostty-snapshot'

export interface TerminalSessionConfiguration {
  renderer: 'xterm'
  enableImages?: boolean
}

export interface TerminalRuntimeEnvironment {
  openLink(url: string): Promise<void>
  sampleSessionConfiguration?(shellSessionKey: string): TerminalSessionConfiguration
  themeMode?: Readable<ThemeMode>
  loggerName?: string
  enableImages?: boolean
  performanceTrace?: TerminalPerformanceTrace
}

declare const terminalSessionBrand: unique symbol

export interface TerminalSession {
  readonly shellSessionKey: string
  readonly [terminalSessionBrand]: true
}

export function createTerminalSessionHandle(shellSessionKey: string): TerminalSession {
  return Object.freeze({ shellSessionKey }) as TerminalSession
}

export interface TerminalViewAttachment {
  readonly generation: number
  refit(signal?: AbortSignal): Promise<TerminalGeometry | null>
  detach(): void
}

export interface TerminalPtySpawnLease {
  readonly generation: number
  readonly geometry: TerminalGeometry
  readonly imageProtocol: TerminalImageProtocol | null
  started(instanceId: number): Promise<void>
  cancel(): void
}

export interface TerminalSessionDiagnostics {
  readonly shellSessionKey: string
  readonly lifecycle: ShellLifecycleState & {
    attached: boolean
    spawnPending: boolean
    stateSource: TerminalStateSource
  }
  readonly output: Readonly<TerminalOutputObservation> & {
    modelSequence: number | null
  }
  readonly view: Readonly<{
    attached: boolean
    visible: boolean
    needsRecovery: boolean
    attachmentGeneration: number
    authorityReadPending: boolean
  }>
  readonly modelOutputSubscription: LiveModelOutputSubscriptionSnapshot | null
  readonly geometry: TerminalGeometry
}

export interface TerminalRuntimeDiagnostics {
  list(): string[]
  observe(shellSessionKey: string): TerminalSessionDiagnostics
  capturePresentation(shellSessionKey: string): TerminalViewPresentationSnapshot
  drainPresentation(shellSessionKey: string): Promise<TerminalViewPresentationEvidence>
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
