import { vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  poolEntry: {
    taskId: '',
    view: {
      geometry: { cols: 80, rows: 24 },
      reset: vi.fn(),
      dispose: vi.fn(),
      fit: vi.fn(() => ({ cols: 80, rows: 24 })),
      setTheme: vi.fn(),
      isMountedIn: vi.fn(() => mocks.poolEntry.attached),
    },
    ptyActive: false,
    needsClear: false,
    unlisteners: [] as Array<() => void>,
    resizeObserver: null,
    visibilityObserver: null,
    resizeTimeout: null,
    attached: false,
  },
  attachment: {
    generation: 1,
    detach: vi.fn(),
  },
  shellLifecycleState: {
    ptyActive: false,
    shellExited: false,
    currentPtyInstance: null as number | null,
  },
}))

vi.mock('@xterm/xterm', () => {
  const Terminal = vi.fn().mockImplementation(() => ({
    open: vi.fn(),
    write: vi.fn(),
    dispose: vi.fn(),
    onData: vi.fn(),
    loadAddon: vi.fn(),
    refresh: vi.fn(),
    focus: vi.fn(),
    reset: vi.fn(),
    cols: 80,
    rows: 24,
  }))
  return { Terminal }
})

vi.mock('@xterm/addon-fit', () => {
  const FitAddon = vi.fn().mockImplementation(() => ({
    fit: vi.fn(),
    proposeDimensions: vi.fn().mockReturnValue({ cols: 80, rows: 24 }),
  }))
  return { FitAddon }
})

vi.mock('@openforge-app/terminal-runtime/xterm.css', () => ({}))

vi.mock('../../lib/terminalPool', () => ({
  acquire: vi.fn().mockResolvedValue(mocks.poolEntry),
  attach: vi.fn().mockResolvedValue(mocks.attachment),
  detach: vi.fn(),
  recoverActiveTerminal: vi.fn(),
  focusTerminal: vi.fn(),
  restorePtyInstance: vi.fn().mockImplementation((_taskId: string, instanceId: number) => {
    mocks.shellLifecycleState.ptyActive = true
    mocks.shellLifecycleState.shellExited = false
    mocks.shellLifecycleState.currentPtyInstance = instanceId
  }),
  release: vi.fn(),
  releaseAll: vi.fn(),
  getShellLifecycleState: vi.fn().mockImplementation(() => ({ ...mocks.shellLifecycleState })),
  isPtyActive: vi.fn().mockImplementation(() => mocks.shellLifecycleState.ptyActive),
  isValidTerminalDimensions: vi.fn().mockReturnValue(true),
  updateShellLifecycleState: vi.fn().mockImplementation((_taskId: string, state: typeof mocks.shellLifecycleState) => {
    mocks.shellLifecycleState.ptyActive = state.ptyActive
    mocks.shellLifecycleState.shellExited = state.shellExited
    mocks.shellLifecycleState.currentPtyInstance = state.currentPtyInstance
  }),
  _getPool: vi.fn().mockReturnValue(new Map()),
}))

export const mockPoolEntry = mocks.poolEntry
export const mockAttachment = mocks.attachment
export const mockShellLifecycleState = mocks.shellLifecycleState

export function resetAgentTerminalMocks() {
  mocks.poolEntry.taskId = ''
  mocks.poolEntry.ptyActive = false
  mocks.poolEntry.needsClear = false
  mocks.poolEntry.attached = false
  mocks.attachment.detach.mockClear()
  mocks.poolEntry.view.setTheme.mockClear()
  mocks.shellLifecycleState.ptyActive = false
  mocks.shellLifecycleState.shellExited = false
  mocks.shellLifecycleState.currentPtyInstance = null
}
