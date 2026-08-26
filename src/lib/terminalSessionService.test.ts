import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  openUrl: vi.fn(async () => undefined),
  openTaskLink: vi.fn(async () => undefined),
}))

vi.mock('./desktopIpc', () => ({
  listenDesktopEvent: vi.fn(async () => () => undefined),
}))

vi.mock('./ipc', () => ({
  getPtyBuffer: vi.fn(async () => ({ buffer: null, isLive: false, instanceId: null })),
  openUrl: mocks.openUrl,
  resizePty: vi.fn(async () => undefined),
  writePty: vi.fn(async () => undefined),
  writeTerminalQueryResponse: vi.fn(async () => undefined),
}))

vi.mock('./plugin/taskLinks', () => ({
  taskLinkRouter: { open: mocks.openTaskLink },
}))

import { openTerminalLink } from './terminalSessionService'

describe('host terminal link routing', () => {
  beforeEach(() => vi.clearAllMocks())

  it('keeps project shell links outside the Task Link router', async () => {
    await openTerminalLink('project-P-1-shell-0', 'https://example.com/docs')

    expect(mocks.openUrl).toHaveBeenCalledWith('https://example.com/docs')
    expect(mocks.openTaskLink).not.toHaveBeenCalled()
  })

  it('offers task and agent terminal links to Task Link handlers', async () => {
    await openTerminalLink('T-1-shell-0', 'https://localhost:3000')
    await openTerminalLink('T-2', 'https://example.com/agent')

    expect(mocks.openTaskLink).toHaveBeenNthCalledWith(1, {
      taskId: 'T-1',
      url: 'https://localhost:3000',
    })
    expect(mocks.openTaskLink).toHaveBeenNthCalledWith(2, {
      taskId: 'T-2',
      url: 'https://example.com/agent',
    })
    expect(mocks.openUrl).not.toHaveBeenCalled()
  })
})
