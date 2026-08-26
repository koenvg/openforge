import { vi } from 'vitest'
import type { TerminalView } from './terminalRuntime'

export function createFakeTerminalView(overrides: Partial<TerminalView> = {}): TerminalView {
  return {
    geometry: { cols: 80, rows: 24 },
    imageProtocol: null,
    resizeTarget: document.createElement('div'),
    mount: vi.fn(),
    unmount: vi.fn(),
    isMountedIn: vi.fn(() => false),
    bootstrap: vi.fn(),
    writeLive: vi.fn(),
    drainPresentation: vi.fn(async () => ({
      writeGeneration: 0,
      parsedGeneration: 0,
      renderFrame: 1,
      renderedRows: { start: 0, end: 23 },
      renderer: 'fake',
      presentedAt: 0,
      devicePixelRatio: 1,
      geometry: { cols: 80, rows: 24 },
    })),
    capturePresentation: vi.fn(() => ({
      geometry: { cols: 80, rows: 24 },
      activeBuffer: 'normal' as const,
      cursor: { x: 0, y: 0 },
      selectionText: '',
      lines: [],
    })),
    focus: vi.fn(),
    reset: vi.fn(),
    refresh: vi.fn(),
    fit: vi.fn(() => ({ cols: 80, rows: 24 })),
    onUserInput: vi.fn(() => ({ dispose: vi.fn() })),
    onQueryResponse: vi.fn(() => ({ dispose: vi.fn() })),
    setKeyEventHandler: vi.fn(),
    getSelectionText: vi.fn(() => ''),
    setTheme: vi.fn(),
    onRendererFailure: vi.fn(() => ({ dispose: vi.fn() })),
    dispose: vi.fn(),
    ...overrides,
  }
}
