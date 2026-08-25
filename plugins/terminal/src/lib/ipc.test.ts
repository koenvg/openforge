import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
import {
  getPtyBuffer,
  killPty,
  openTerminalLink,
  resizePty,
  setTerminalOpenForgeApi,
  writePty,
  writeTerminalQueryResponse,
} from './ipc'

function installShellApi() {
  const shell = {
    write: vi.fn(async () => undefined),
    writeTerminalQueryResponse: vi.fn(async () => undefined),
    resize: vi.fn(async () => undefined),
    kill: vi.fn(async () => undefined),
    getBuffer: vi.fn(async () => ({ buffer: 'buffered', isLive: true, instanceId: 42 })),
  }
  setTerminalOpenForgeApi({ shell } as unknown as FrontendOpenForgeAPI)
  return shell
}

function installLinkApi() {
  const taskLinks = { open: vi.fn(async () => undefined) }
  const system = { openUrl: vi.fn(async () => undefined) }
  setTerminalOpenForgeApi({ taskLinks, system } as unknown as FrontendOpenForgeAPI)
  return { taskLinks, system }
}

describe('terminal plugin IPC shell callbacks', () => {
  afterEach(() => {
    setTerminalOpenForgeApi(null)
  })

  it('routes Task terminal links through taskLinks with the Task id', async () => {
    const { taskLinks, system } = installLinkApi()

    await openTerminalLink('T-1-shell-2', 'https://openforge.dev/docs')

    expect(taskLinks.open).toHaveBeenCalledWith({ taskId: 'T-1', url: 'https://openforge.dev/docs' })
    expect(system.openUrl).not.toHaveBeenCalled()
  })

  it('keeps project terminal links on the existing external browser path', async () => {
    const { taskLinks, system } = installLinkApi()

    await openTerminalLink('project-P-1-shell-2', 'https://openforge.dev/docs')

    expect(system.openUrl).toHaveBeenCalledWith('https://openforge.dev/docs')
    expect(taskLinks.open).not.toHaveBeenCalled()
  })

  it('converts indexed terminal keys back to plugin ShellAPI taskId and terminalIndex requests', async () => {
    const shell = installShellApi()

    await writePty('project-P-1-shell-2', 'echo hi\n')
    await writeTerminalQueryResponse({
      shellSessionKey: 'project-P-1-shell-2',
      ptyInstanceId: 42,
      data: '\u001b[1;1R',
    })
    await resizePty('project-P-1-shell-2', 120, 40)
    await expect(getPtyBuffer('project-P-1-shell-2')).resolves.toEqual({ buffer: 'buffered', isLive: true, instanceId: 42 })
    await killPty('project-P-1-shell-2')

    expect(shell.write).toHaveBeenCalledWith({ taskId: 'project-P-1', terminalIndex: 2, data: 'echo hi\n' })
    expect(shell.writeTerminalQueryResponse).toHaveBeenCalledWith({
      taskId: 'project-P-1',
      terminalIndex: 2,
      ptyInstanceId: 42,
      data: '\u001b[1;1R',
    })
    expect(shell.resize).toHaveBeenCalledWith({ taskId: 'project-P-1', terminalIndex: 2, cols: 120, rows: 40 })
    expect(shell.getBuffer).toHaveBeenCalledWith({ taskId: 'project-P-1', terminalIndex: 2 })
    expect(shell.kill).toHaveBeenCalledWith({ taskId: 'project-P-1', terminalIndex: 2 })
  })

  it('fails fast instead of sending unindexed terminal shell requests', async () => {
    const shell = installShellApi()

    await expect(writePty('project-P-1', 'echo hi\n')).rejects.toThrow('indexed terminal key')

    expect(shell.write).not.toHaveBeenCalled()
  })
})
