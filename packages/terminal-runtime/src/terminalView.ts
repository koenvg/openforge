import type { TerminalImageProtocol } from './terminalImages'
import type { TerminalFontReadiness } from './terminalOptions'
import type { ThemeMode } from './theme'

export type TerminalViewData = string | Uint8Array

export interface TerminalViewLiveOutput {
  data: TerminalViewData
  ptyInstanceId: number | null
  sequence: number
}

export interface TerminalViewQueryResponse {
  data: string
  ptyInstanceId: number | null
}

export interface TerminalViewGeometry {
  cols: number
  rows: number
}

export interface TerminalViewPresentationEvidence {
  writeGeneration: number
  parsedGeneration: number
  renderFrame: number
  renderedRows: { start: number; end: number }
  renderer: string
  presentedAt: number
  devicePixelRatio: number
  geometry: TerminalViewGeometry
}

export interface TerminalViewPresentationCell {
  column: number
  text: string
  width: number
  foreground: { mode: number; value: number }
  background: { mode: number; value: number }
  bold: boolean
  italic: boolean
  underline: boolean
  dim: boolean
  inverse: boolean
  invisible: boolean
  strikethrough: boolean
  overline: boolean
}

export interface TerminalViewPresentationLine {
  row: number
  text: string
  wrapped: boolean
  cells: TerminalViewPresentationCell[]
}

export interface TerminalViewPresentationSnapshot {
  geometry: TerminalViewGeometry
  activeBuffer: 'normal' | 'alternate'
  cursor: { x: number; y: number }
  selectionText: string
  lines: TerminalViewPresentationLine[]
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
 * Terminal Runtime bootstraps xterm from PTY byte replay at sequence zero, then
 * delivers monotonic live output. Every write carries its source PTY instance so
 * generated responses remain bound to the generation whose bytes xterm parsed.
 */
export interface TerminalView {
  readonly geometry: TerminalViewGeometry
  readonly imageProtocol: TerminalImageProtocol | null
  readonly resizeTarget: Element

  mount(container: HTMLElement): void
  unmount(): void
  isMountedIn(container: HTMLElement): boolean
  bootstrap(data: TerminalViewData, ptyInstanceId: number | null, sequence: number): void
  writeLive(output: TerminalViewLiveOutput): void
  drainPresentation(): Promise<TerminalViewPresentationEvidence>
  capturePresentation(): TerminalViewPresentationSnapshot
  focus(): void
  reset(): void
  refresh(): void
  fit(): TerminalViewGeometry | null
  onUserInput(listener: (data: string) => void): TerminalViewDisposable
  onQueryResponse(listener: (response: TerminalViewQueryResponse) => void): TerminalViewDisposable
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
  fontReadiness: TerminalFontReadiness
}

export type TerminalViewFactory = (options: TerminalViewFactoryOptions) => TerminalView
