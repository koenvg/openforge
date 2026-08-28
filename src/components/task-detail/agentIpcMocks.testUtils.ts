import { vi } from 'vitest'

type DesktopEventCallback = (event: { payload: unknown }) => void

const { listenCallbacks } = vi.hoisted(() => ({
  listenCallbacks: new Map<string, DesktopEventCallback[]>(),
}))

vi.mock('../../lib/ipc', () => ({
  getLatestSession: vi.fn().mockResolvedValue(null),
  getWorktreeForTask: vi.fn().mockResolvedValue(null),
  writePty: vi.fn().mockResolvedValue(undefined),
  resizePty: vi.fn().mockResolvedValue(undefined),
  killPty: vi.fn().mockResolvedValue(undefined),
  transcribeAudio: vi.fn(),
  getWhisperModelStatus: vi.fn(),
  downloadWhisperModel: vi.fn(),
  getPtyBuffer: vi.fn().mockResolvedValue({ buffer: null, isLive: false, instanceId: null }),
}))

vi.mock('../../lib/desktopIpc', () => ({
  listenDesktopEvent: vi.fn().mockImplementation((eventName: string, callback: DesktopEventCallback) => {
    const callbacks = listenCallbacks.get(eventName) ?? []
    callbacks.push(callback)
    listenCallbacks.set(eventName, callbacks)
    return Promise.resolve(() => {})
  }),
}))

vi.mock('../../lib/audioRecorder', () => ({
  createAudioRecorder: vi.fn(),
}))

export { listenCallbacks }

export function resetAgentIpcMocks() {
  listenCallbacks.clear()
}
