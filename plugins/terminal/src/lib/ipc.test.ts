import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FrontendOpenForgeAPI } from '@openforge/plugin-sdk/frontend'
import { getPtyBuffer, killPty, resizePty, setTerminalOpenForgeApi, writePty } from './ipc'

function installShellApi() {
  const shell = {
    write: vi.fn(async () => undefined),
    resize: vi.fn(async () => undefined),
    kill: vi.fn(async () => undefined),
    getBuffer: vi.fn(async () => 'buffered'),
  }
  setTerminalOpenForgeApi({ shell } as unknown as FrontendOpenForgeAPI)
  return shell
}

describe('terminal plugin IPC shell callbacks', () => {
  afterEach(() => {
    setTerminalOpenForgeApi(null)
  })

  it('converts indexed terminal keys back to plugin ShellAPI taskId and terminalIndex requests', async () => {
    const shell = installShellApi()

    await writePty('project-P-1-shell-2', 'echo hi\n')
    await resizePty('project-P-1-shell-2', 120, 40)
    await expect(getPtyBuffer('project-P-1-shell-2')).resolves.toBe('buffered')
    await killPty('project-P-1-shell-2')

    expect(shell.write).toHaveBeenCalledWith({ taskId: 'project-P-1', terminalIndex: 2, data: 'echo hi\n' })
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
