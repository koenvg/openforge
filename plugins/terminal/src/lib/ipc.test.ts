import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
import { killPty, openTerminalLink, setTerminalOpenForgeApi } from './ipc'

function installShellApi() {
  const shell = {
    kill: vi.fn(async () => undefined),
  }
  setTerminalOpenForgeApi({ shell } as unknown as FrontendOpenForgeAPI)
  return shell
}

function installLinkApi() {
  const system = { openUrl: vi.fn(async () => undefined) }
  setTerminalOpenForgeApi({ system } as unknown as FrontendOpenForgeAPI)
  return system
}

describe('terminal plugin IPC shell callbacks', () => {
  afterEach(() => {
    setTerminalOpenForgeApi(null)
  })

  it('opens terminal links in the external browser', async () => {
    const system = installLinkApi()

    await openTerminalLink('https://openforge.dev/docs')

    expect(system.openUrl).toHaveBeenCalledWith('https://openforge.dev/docs')
  })

  it('converts indexed terminal keys back to plugin ShellAPI taskId and terminalIndex requests', async () => {
    const shell = installShellApi()

    await killPty('project-P-1-shell-2')

    expect(shell.kill).toHaveBeenCalledWith({ taskId: 'project-P-1', terminalIndex: 2 })
  })

  it('fails fast instead of sending unindexed terminal shell requests', async () => {
    const shell = installShellApi()

    await expect(killPty('project-P-1')).rejects.toThrow('indexed Shell Session Key')
    await expect(killPty('project-P-1-shell-4294967296')).rejects.toThrow(
      'indexed Shell Session Key',
    )

    expect(shell.kill).not.toHaveBeenCalled()
  })
})
