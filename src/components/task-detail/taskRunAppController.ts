import type { ShellLifecycleState, TaskTerminalTabsSession } from '@openforge-app/terminal-runtime'
import type { getProjectConfig, writePty } from '../../lib/ipc'
import {
  RUN_COMMAND_CONFIG_KEY,
  runAppCommandInTaskTerminal,
  type RunAppCommandDeps,
} from '../../lib/runAppCommand'

export { RUN_COMMAND_CONFIG_KEY }

export interface TaskRunAppRegistration {
  taskId: string
  available: boolean
  run: () => Promise<void>
}

export interface TaskRunAppState {
  command: string
  hasRunCommand: boolean
  isLaunching: boolean
  available: boolean
  title: string
}

export const INITIAL_TASK_RUN_APP_STATE: TaskRunAppState = {
  command: '',
  hasRunCommand: false,
  isLaunching: false,
  available: false,
  title: 'Set a run command in this project’s settings to run the app locally',
}

interface TaskRunAppContext {
  taskId: string
  projectId: string | null
  workspacePath: string | null
  terminalViewId: string | null
  onRegistrationChange?: (registration: TaskRunAppRegistration | null) => void
}

interface TaskRunAppTarget {
  taskId: string
  workspacePath: string | null
  command: string
  terminalViewId: string | null
}

interface TaskRunAppControllerOptions {
  getProjectConfig: typeof getProjectConfig
  getSession: (taskId: string) => TaskTerminalTabsSession
  getShellLifecycleState: (terminalKey: string) => ShellLifecycleState
  writePty: typeof writePty
  openTerminalView: (taskId: string, terminalViewId: string) => void
  runCommandInTaskTerminal?: typeof runAppCommandInTaskTerminal
  onStateChange?: (state: TaskRunAppState) => void
  onError?: (operation: 'load-config' | 'launch', error: unknown) => void
}

export interface TaskRunAppController {
  readonly state: TaskRunAppState
  sync(context: TaskRunAppContext): void
  run(): Promise<void>
  destroy(): void
}

function stateFor(target: TaskRunAppTarget | null, isLaunching: boolean): TaskRunAppState {
  const command = target?.command ?? ''
  const hasRunCommand = command !== ''
  const terminalAvailable = target !== null && target.terminalViewId !== null
  const available = target !== null
    && target.workspacePath !== null
    && hasRunCommand
    && terminalAvailable
    && !isLaunching

  const title = !terminalAvailable
    ? 'Enable the Terminal plugin to run the app locally'
    : hasRunCommand
      ? `Run app locally: ${command}`
      : 'Set a run command in this project’s settings to run the app locally'

  return { command, hasRunCommand, isLaunching, available, title }
}

export function createTaskRunAppController(options: TaskRunAppControllerOptions): TaskRunAppController {
  let context: TaskRunAppContext | null = null
  let command = ''
  let currentProjectId: string | null | undefined
  let isLaunching = false
  let destroyed = false
  let configRequestVersion = 0
  let state = INITIAL_TASK_RUN_APP_STATE
  let registrationSink: TaskRunAppContext['onRegistrationChange']
  let registeredTaskId: string | null = null

  function targetFor(currentContext: TaskRunAppContext | null = context): TaskRunAppTarget | null {
    if (currentContext === null) return null
    return {
      taskId: currentContext.taskId,
      workspacePath: currentContext.workspacePath,
      command,
      terminalViewId: currentContext.terminalViewId,
    }
  }

  function clearRegistration(): void {
    registrationSink?.(null)
    registrationSink = undefined
    registeredTaskId = null
  }

  function publish(): void {
    if (destroyed) return

    const target = targetFor()
    state = stateFor(target, isLaunching)
    options.onStateChange?.(state)

    const nextSink = context?.onRegistrationChange
    const nextTaskId = context?.taskId ?? null
    if (registrationSink !== undefined && (registrationSink !== nextSink || registeredTaskId !== nextTaskId)) {
      clearRegistration()
    }
    if (target === null || nextSink === undefined) return

    registrationSink = nextSink
    registeredTaskId = target.taskId
    const registrationTarget = { ...target }
    nextSink({
      taskId: registrationTarget.taskId,
      available: state.available,
      run: () => launch(registrationTarget),
    })
  }

  async function loadCommand(projectId: string, requestVersion: number): Promise<void> {
    try {
      const value = await options.getProjectConfig(projectId, RUN_COMMAND_CONFIG_KEY)
      if (destroyed || requestVersion !== configRequestVersion) return
      command = (value ?? '').trim()
      publish()
    } catch (error) {
      if (destroyed || requestVersion !== configRequestVersion) return
      command = ''
      options.onError?.('load-config', error)
      publish()
    }
  }

  async function launch(target: TaskRunAppTarget): Promise<void> {
    const terminalViewId = target.terminalViewId
    if (destroyed || isLaunching || !stateFor(target, false).available || terminalViewId === null) return

    isLaunching = true
    publish()
    try {
      const deps: RunAppCommandDeps = {
        getSession: options.getSession,
        getShellLifecycleState: options.getShellLifecycleState,
        writePty: options.writePty,
        openTerminalView: () => options.openTerminalView(target.taskId, terminalViewId),
      }
      await (options.runCommandInTaskTerminal ?? runAppCommandInTaskTerminal)(
        target.taskId,
        target.command,
        deps,
      )
    } catch (error) {
      options.onError?.('launch', error)
    } finally {
      isLaunching = false
      publish()
    }
  }

  function sync(nextContext: TaskRunAppContext): void {
    if (destroyed) return

    context = nextContext
    if (nextContext.projectId !== currentProjectId) {
      currentProjectId = nextContext.projectId
      command = ''
      const requestVersion = ++configRequestVersion
      if (nextContext.projectId !== null) {
        void loadCommand(nextContext.projectId, requestVersion)
      }
    }
    publish()
  }

  function destroy(): void {
    if (destroyed) return
    configRequestVersion += 1
    clearRegistration()
    destroyed = true
    context = null
  }

  async function run(): Promise<void> {
    const target = targetFor()
    if (target !== null) await launch(target)
  }

  return {
    get state() { return state },
    sync,
    run,
    destroy,
  }
}
