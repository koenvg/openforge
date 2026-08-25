import type { TerminalImageProtocol } from './terminalImages'
import type { ThemeMode } from './theme'

export type TerminalViewData = string | Uint8Array

export interface TerminalViewLiveOutput {
  data: TerminalViewData
  sequence: number | null
}

export interface TerminalViewGeometry {
  cols: number
  rows: number
}

export interface TerminalViewTheme {
  readonly background?: string
  readonly foreground?: string
  readonly cursor?: string
  readonly cursorAccent?: string
  readonly selectionBackground?: string
  readonly selectionForeground?: string
  readonly black?: string
  readonly red?: string
  readonly green?: string
  readonly yellow?: string
  readonly blue?: string
  readonly magenta?: string
  readonly cyan?: string
  readonly white?: string
  readonly brightBlack?: string
  readonly brightRed?: string
  readonly brightGreen?: string
  readonly brightYellow?: string
  readonly brightBlue?: string
  readonly brightMagenta?: string
  readonly brightCyan?: string
  readonly brightWhite?: string
}

export interface TerminalViewDisposable {
  dispose(): void
}

export interface TerminalViewRendererFailure {
  renderer: string
  reason: 'unavailable' | 'context-lost'
  error?: unknown
}

/**
 * Presents one Terminal Session without owning its PTY lifecycle.
 * The runtime bootstraps the view before delivering ordered live output. A null
 * live-output sequence identifies the legacy stream; model sequences increase
 * monotonically within one PTY instance.
 */
export interface TerminalView {
  readonly geometry: TerminalViewGeometry
  readonly imageProtocol: TerminalImageProtocol | null

  mount(container: HTMLElement): void
  unmount(): void
  isMountedIn(container: HTMLElement): boolean
  bootstrap(data: TerminalViewData): void
  writeLive(output: TerminalViewLiveOutput): void
  focus(): void
  reset(): void
  refresh(): void
  fit(): TerminalViewGeometry | null
  onUserInput(listener: (data: string) => void): TerminalViewDisposable
  setKeyEventHandler(handler: (event: KeyboardEvent) => boolean): void
  getSelectionText(): string
  setTheme(theme: TerminalViewTheme): void
  onRendererFailure(listener: (failure: TerminalViewRendererFailure) => void): TerminalViewDisposable
  dispose(): void
}

export interface TerminalViewFactoryOptions {
  terminalKey: string
  themeMode: ThemeMode
  openLink(url: string): Promise<void>
  enableImages?: boolean
  loggerName?: string
}

export type TerminalViewFactory = (options: TerminalViewFactoryOptions) => TerminalView
