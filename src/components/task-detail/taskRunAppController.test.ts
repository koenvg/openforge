import type { ShellLifecycleState, TaskTerminalTabsSession } from '@openforge-app/terminal-runtime'
import { describe, expect, it, vi } from 'vitest'
import type { RunAppCommandDeps } from '../../lib/runAppCommand'
import type { TaskRunAppRegistration } from './taskRunAppController'
import { createTaskRunAppController, RUN_COMMAND_CONFIG_KEY } from './taskRunAppController'

const session: TaskTerminalTabsSession = {
  tabs: [{ index: 0, key: 'T-1-shell-0', label: 'Shell 1' }],
  activeTabIndex: 0,
  nextIndex: 1,
}

const shellState: ShellLifecycleState = {
  ptyActive: true,
  shellExited: false,
  currentPtyInstance: 1,
  hasOutput: true,
}

function setup() {
  const getProjectConfig = vi.fn(async () => ' pnpm dev ' as string | null)
  const runCommandInTaskTerminal = vi.fn(async (
    _taskId: string,
    _command: string,
    _deps: RunAppCommandDeps,
  ) => true)
  const openTerminalView = vi.fn()
  const onRegistrationChange = vi.fn<(registration: TaskRunAppRegistration | null) => void>()
  const onStateChange = vi.fn()
  const onError = vi.fn()
  const controller = createTaskRunAppController({
    getProjectConfig,
    getSession: vi.fn(() => session),
    getShellLifecycleState: vi.fn(() => shellState),
    writePty: vi.fn(async () => {}),
    openTerminalView,
    runCommandInTaskTerminal,
    onStateChange,
    onError,
  })

  return {
    controller,
    getProjectConfig,
    onError,
    onRegistrationChange,
    onStateChange,
    openTerminalView,
    runCommandInTaskTerminal,
  }
}

async function syncAvailable(controller: ReturnType<typeof createTaskRunAppController>, onRegistrationChange: (registration: TaskRunAppRegistration | null) => void) {
  controller.sync({
    taskId: 'T-1',
    projectId: 'P-1',
    workspacePath: '/worktree',
    terminalViewId: 'com.openforge.terminal:terminal',
    onRegistrationChange,
  })
  await vi.waitFor(() => expect(controller.state.available).toBe(true))
}

describe('taskRunAppController', () => {
  it('loads and trims the project run command, then publishes task-bound availability', async () => {
    const { controller, getProjectConfig, onRegistrationChange } = setup()

    await syncAvailable(controller, onRegistrationChange)

    expect(getProjectConfig).toHaveBeenCalledWith('P-1', RUN_COMMAND_CONFIG_KEY)
    expect(controller.state).toMatchObject({
      command: 'pnpm dev',
      hasRunCommand: true,
      isLaunching: false,
      available: true,
      title: 'Run app locally: pnpm dev',
    })
    expect(onRegistrationChange).toHaveBeenLastCalledWith(expect.objectContaining({
      taskId: 'T-1',
      available: true,
      run: expect.any(Function),
    }))
  })

  it('keeps the registration unavailable with an explanatory title when terminal integration is missing', async () => {
    const { controller, onRegistrationChange } = setup()

    controller.sync({
      taskId: 'T-1',
      projectId: 'P-1',
      workspacePath: '/worktree',
      terminalViewId: null,
      onRegistrationChange,
    })
    await vi.waitFor(() => expect(controller.state.hasRunCommand).toBe(true))

    expect(controller.state.available).toBe(false)
    expect(controller.state.title).toBe('Enable the Terminal plugin to run the app locally')
    expect(onRegistrationChange).toHaveBeenLastCalledWith(expect.objectContaining({
      taskId: 'T-1',
      available: false,
    }))
  })

  it('launches through the terminal plugin integration and suppresses concurrent launches', async () => {
    const { controller, onRegistrationChange, openTerminalView, runCommandInTaskTerminal } = setup()
    let finishLaunch: (() => void) | undefined
    runCommandInTaskTerminal.mockImplementation(() => new Promise<boolean>((resolve) => {
      finishLaunch = () => resolve(true)
    }))
    await syncAvailable(controller, onRegistrationChange)
    const registration = onRegistrationChange.mock.calls.at(-1)?.[0]
    expect(registration).not.toBeNull()

    const firstLaunch = registration!.run()
    const secondLaunch = controller.run()

    expect(controller.state.isLaunching).toBe(true)
    expect(controller.state.available).toBe(false)
    expect(runCommandInTaskTerminal).toHaveBeenCalledTimes(1)
    const [taskId, command, deps] = runCommandInTaskTerminal.mock.calls[0]!
    expect(taskId).toBe('T-1')
    expect(command).toBe('pnpm dev')
    deps.openTerminalView()
    expect(openTerminalView).toHaveBeenCalledWith('T-1', 'com.openforge.terminal:terminal')

    finishLaunch?.()
    await Promise.all([firstLaunch, secondLaunch])
    expect(controller.state.isLaunching).toBe(false)
    expect(controller.state.available).toBe(true)
  })

  it('ignores a stale project configuration response after the active project changes', async () => {
    const { controller, getProjectConfig, onRegistrationChange } = setup()
    let resolveFirst: ((value: string | null) => void) | undefined
    getProjectConfig
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve }))
      .mockResolvedValueOnce('pnpm start')

    controller.sync({
      taskId: 'T-1',
      projectId: 'P-1',
      workspacePath: '/worktree',
      terminalViewId: 'terminal:view',
      onRegistrationChange,
    })
    controller.sync({
      taskId: 'T-1',
      projectId: 'P-2',
      workspacePath: '/worktree',
      terminalViewId: 'terminal:view',
      onRegistrationChange,
    })
    await vi.waitFor(() => expect(controller.state.command).toBe('pnpm start'))

    resolveFirst?.('stale command')
    await Promise.resolve()

    expect(controller.state.command).toBe('pnpm start')
  })

  it('cleans up the previous task registration on task change and the current one on destroy', async () => {
    const { controller, onRegistrationChange } = setup()
    await syncAvailable(controller, onRegistrationChange)
    onRegistrationChange.mockClear()

    controller.sync({
      taskId: 'T-2',
      projectId: 'P-1',
      workspacePath: '/other-worktree',
      terminalViewId: 'terminal:view',
      onRegistrationChange,
    })

    expect(onRegistrationChange.mock.calls[0]?.[0]).toBeNull()
    expect(onRegistrationChange).toHaveBeenLastCalledWith(expect.objectContaining({ taskId: 'T-2' }))

    controller.destroy()
    expect(onRegistrationChange).toHaveBeenLastCalledWith(null)
  })

  it('reports configuration and launch failures without leaking a launching state', async () => {
    const { controller, getProjectConfig, onError, onRegistrationChange, runCommandInTaskTerminal } = setup()
    getProjectConfig.mockRejectedValueOnce(new Error('config unavailable'))

    controller.sync({
      taskId: 'T-1',
      projectId: 'P-1',
      workspacePath: '/worktree',
      terminalViewId: 'terminal:view',
      onRegistrationChange,
    })
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith('load-config', expect.any(Error)))
    expect(controller.state.command).toBe('')

    getProjectConfig.mockResolvedValueOnce('pnpm dev')
    controller.sync({
      taskId: 'T-1',
      projectId: 'P-2',
      workspacePath: '/worktree',
      terminalViewId: 'terminal:view',
      onRegistrationChange,
    })
    await vi.waitFor(() => expect(controller.state.available).toBe(true))
    runCommandInTaskTerminal.mockRejectedValueOnce(new Error('pty failed'))

    await controller.run()

    expect(onError).toHaveBeenCalledWith('launch', expect.any(Error))
    expect(controller.state.isLaunching).toBe(false)
    expect(controller.state.available).toBe(true)
  })
})
