import {
  createIndexedShellSessionKey,
  type ShellLifecycleState,
  type TaskTerminalTabsSession,
} from '@openforge-app/terminal-runtime'

/** project_config key holding the per-project command used to run the app locally. */
export const RUN_COMMAND_CONFIG_KEY = 'run_command'

/**
 * How long to wait for a freshly-opened terminal's shell PTY to come online before
 * giving up on sending the run command.
 */
export const DEFAULT_RUN_APP_TIMEOUT_MS = 15000

/**
 * How often to re-check whether the target shell's PTY is active while waiting.
 */
export const DEFAULT_RUN_APP_POLL_INTERVAL_MS = 100

/**
 * Resolve the PTY session key of the task terminal's currently active shell tab.
 * Falls back to the default `${taskId}-shell-${activeTabIndex}` key when the session
 * has no tab entry for the active index (e.g. a not-yet-hydrated default session).
 */
export function activeShellKey(taskId: string, session: TaskTerminalTabsSession): string {
  const activeTab = session.tabs.find((tab) => tab.index === session.activeTabIndex)
  return activeTab?.key ?? createIndexedShellSessionKey({
    taskId,
    terminalIndex: session.activeTabIndex,
  })
}

export interface RunAppCommandDeps {
  getSession: (taskId: string) => TaskTerminalTabsSession
  getShellLifecycleState: (terminalKey: string) => ShellLifecycleState
  writePty: (terminalKey: string, data: string) => Promise<void>
  openTerminalView: () => void
}


export interface RunAppCommandOptions {
  timeoutMs?: number
  pollIntervalMs?: number
  setIntervalFn?: (handler: () => void, ms: number) => unknown
  clearIntervalFn?: (handle: unknown) => void
  setTimeoutFn?: (handler: () => void, ms: number) => unknown
  clearTimeoutFn?: (handle: unknown) => void
}

/**
 * Send the configured run command to the task's active terminal tab, exactly as if
 * the user had typed it. Opens the terminal tab first, waits for its shell PTY to be
 * live, then writes `${command}\r`. Resolves `true` when the command was written and
 * `false` when there was nothing to run or the shell never came online in time.
 */
export async function runAppCommandInTaskTerminal(
  taskId: string,
  command: string,
  deps: RunAppCommandDeps,
  options: RunAppCommandOptions = {},
): Promise<boolean> {
  const trimmed = command.trim()
  if (trimmed === '') return false

  deps.openTerminalView()

  const terminalKey = activeShellKey(taskId, deps.getSession(taskId))

  const ready = await waitForShellReady(terminalKey, deps, options)
  if (!ready) return false

  await deps.writePty(terminalKey, `${trimmed}\r`)
  return true
}

// Poll the shell lifecycle rather than subscribing: `ptyActive` can flip true via
// several paths (fresh spawn, PTY output, buffer restore) and not every path notifies
// listeners, so a condition-poll is the robust readiness signal.
function waitForShellReady(
  terminalKey: string,
  deps: RunAppCommandDeps,
  options: RunAppCommandOptions,
): Promise<boolean> {
  if (deps.getShellLifecycleState(terminalKey).ptyActive) {
    return Promise.resolve(true)
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_RUN_APP_TIMEOUT_MS
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_RUN_APP_POLL_INTERVAL_MS
  const setIntervalFn = options.setIntervalFn ?? ((handler, ms) => setInterval(handler, ms))
  const clearIntervalFn =
    options.clearIntervalFn ?? ((handle) => clearInterval(handle as ReturnType<typeof setInterval>))
  const setTimeoutFn = options.setTimeoutFn ?? ((handler, ms) => setTimeout(handler, ms))
  const clearTimeoutFn =
    options.clearTimeoutFn ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))

  return new Promise<boolean>((resolve) => {
    let settled = false
    let intervalHandle: unknown = null
    let timeoutHandle: unknown = null

    const finish = (result: boolean) => {
      if (settled) return
      settled = true
      if (intervalHandle !== null) clearIntervalFn(intervalHandle)
      if (timeoutHandle !== null) clearTimeoutFn(timeoutHandle)
      resolve(result)
    }

    intervalHandle = setIntervalFn(() => {
      if (deps.getShellLifecycleState(terminalKey).ptyActive) finish(true)
    }, pollIntervalMs)

    timeoutHandle = setTimeoutFn(() => finish(false), timeoutMs)
  })
}
