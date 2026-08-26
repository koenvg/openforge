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
