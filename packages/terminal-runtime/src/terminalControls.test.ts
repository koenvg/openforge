import { describe, expect, it, vi } from 'vitest'
import {
  TERMINAL_FOCUS_DESCRIPTION_TEXT,
  TERMINAL_TASK_PANE_KEYBOARD_FOCUS_PATH_TEXT,
  TERMINAL_TASK_PANE_WORKSPACE_RECOVERY_TEXT,
  createTerminalTabsController,
  getRestartShellAriaLabel,
  getShellLabel,
  getTerminalFocusDescriptionId,
  getTerminalRegionAriaLabel,
  getTerminalTabAccessibleLabel,
  getTerminalTabPanelId,
  getTerminalTabStatus,
  getTerminalTabTriggerId,
  shouldShowShellReadyAffordance,
  type TerminalTabsControllerSnapshot,
} from './terminalControls'
import type { ShellLifecycleState, TaskTerminalTabsSession } from './terminalRuntime'

function createHarness() {
  const sessions = new Map<string, TaskTerminalTabsSession>()
  const lifecycleStates = new Map<string, ShellLifecycleState>()
  const lifecycleSubscribers = new Map<string, (state: ShellLifecycleState) => void>()
  const snapshots: TerminalTabsControllerSnapshot[] = []
  const changes: number[] = []
  const counts: number[] = []
  const killed: string[] = []
  const released: string[] = []
  const focused: string[] = []
  const focusSnapshots: TerminalTabsControllerSnapshot[] = []

  const controller = createTerminalTabsController({
    taskId: 'T-1',
    getTaskTerminalTabsSession(taskId) {
      const existing = sessions.get(taskId)
      if (existing) return existing
      const session = {
        tabs: [{ index: 0, key: `${taskId}-shell-0`, label: 'Shell 1' }],
        activeTabIndex: 0,
        nextIndex: 1,
      }
      sessions.set(taskId, session)
      return session
    },
    updateTaskTerminalTabsSession(taskId, session) {
      sessions.set(taskId, session)
    },
    getShellLifecycleState(terminalKey) {
      return lifecycleStates.get(terminalKey) ?? {
        ptyActive: false,
        shellExited: false,
        currentPtyInstance: null,
        hasOutput: false,
      }
    },
    subscribeShellLifecycle(terminalKey, callback) {
      lifecycleSubscribers.set(terminalKey, callback)
      return () => lifecycleSubscribers.delete(terminalKey)
    },
    killPty: async (terminalKey) => { killed.push(terminalKey) },
    releaseTerminal: (terminalKey) => { released.push(terminalKey) },
    focusTerminal: (terminalKey) => {
      focused.push(terminalKey)
      const latestSnapshot = snapshots.at(-1)
      if (latestSnapshot) focusSnapshots.push(latestSnapshot)
    },
    waitForDomUpdate: async () => undefined,
    onTabChange: (index) => changes.push(index),
    onTabCountChange: (count) => counts.push(count),
    onSnapshot: (snapshot) => snapshots.push(snapshot),
  })

  function emitLifecycle(terminalKey: string, state: ShellLifecycleState) {
    lifecycleStates.set(terminalKey, state)
    lifecycleSubscribers.get(terminalKey)?.(state)
  }

  return { controller, sessions, snapshots, changes, counts, killed, released, focused, focusSnapshots, emitLifecycle, lifecycleSubscribers }
}

describe('terminal control helpers', () => {
  it('centralizes stable terminal accessibility copy and labels', () => {
    expect(TERMINAL_TASK_PANE_KEYBOARD_FOCUS_PATH_TEXT).toContain('Keyboard focus path:')
    expect(TERMINAL_TASK_PANE_WORKSPACE_RECOVERY_TEXT).toContain('retry loading the terminal')
    expect(TERMINAL_FOCUS_DESCRIPTION_TEXT).toContain('after selecting a shell tab')
    expect(getShellLabel(1)).toBe('Shell 2')
    expect(getTerminalFocusDescriptionId('T-1-shell-0')).toBe('terminal-focus-description-T-1-shell-0')
    expect(getTerminalRegionAriaLabel('Shell 1')).toBe('Terminal region for Shell 1')
    expect(getRestartShellAriaLabel('Shell 1')).toBe('Restart Shell 1')
  })

  it('formats tab ids, status, accessible names, and shell ready affordance from state', () => {
    const tab = { index: 0, key: 'T-1-shell-0', label: 'Shell 1' }
    const running = { ptyActive: true, shellExited: false, currentPtyInstance: 3, hasOutput: false }
    const exited = { ...running, ptyActive: false, shellExited: true }

    expect(getTerminalTabPanelId(tab)).toBe('terminal-panel-T-1-shell-0')
    expect(getTerminalTabTriggerId(tab)).toBe('terminal-tab-T-1-shell-0')
    expect(getTerminalTabStatus(tab, 0, running)).toBe('active')
    expect(getTerminalTabStatus(tab, 1, running)).toBe('inactive')
    expect(getTerminalTabStatus(tab, 0, exited)).toBe('exited')
    expect(getTerminalTabAccessibleLabel(tab, 0, running)).toBe('Shell 1, active, running')
    expect(getTerminalTabAccessibleLabel(tab, 1, exited)).toBe('Shell 1, inactive, exited')
    expect(shouldShowShellReadyAffordance(true, running)).toBe(true)
    expect(shouldShowShellReadyAffordance(false, running)).toBe(false)
    expect(shouldShowShellReadyAffordance(true, { ...running, hasOutput: true })).toBe(false)
    expect(shouldShowShellReadyAffordance(true, exited)).toBe(false)
  })
})

describe('createTerminalTabsController', () => {
  it('hydrates, creates tabs, persists session, announces, and focuses the new shell', async () => {
    const { controller, snapshots, counts, changes, focused, sessions } = createHarness()

    controller.hydrate()
    await controller.addTab()

    expect(snapshots.at(-1)?.tabs.map(tab => tab.label)).toEqual(['Shell 1', 'Shell 2'])
    expect(snapshots.at(-1)?.activeTabIndex).toBe(1)
    expect(snapshots.at(-1)?.liveMessage).toBe('Shell 2 created. Focus moved to Shell 2 terminal.')
    expect(sessions.get('T-1')?.nextIndex).toBe(2)
    expect(changes).toEqual([1])
    expect(counts).toEqual([1, 2])
    expect(focused).toEqual(['T-1-shell-1'])
  })

  it('switches by visible tab position and focuses the selected shell', async () => {
    const { controller, changes, focused } = createHarness()

    controller.hydrate()
    await controller.addTab()
    focused.length = 0
    await controller.switchToTab(0)

    expect(controller.getSnapshot().activeTabIndex).toBe(0)
    expect(changes).toEqual([1, 0])
    expect(focused).toEqual(['T-1-shell-0'])
  })

  it('closes active tabs, releases terminal resources, and focuses the adjacent shell', async () => {
    const { controller, killed, released, focused, changes, counts } = createHarness()

    controller.hydrate()
    await controller.addTab()
    focused.length = 0
    await controller.closeActiveTab()

    expect(controller.getSnapshot().tabs.map(tab => tab.label)).toEqual(['Shell 1'])
    expect(controller.getSnapshot().activeTabIndex).toBe(0)
    expect(controller.getSnapshot().liveMessage).toBe('Shell 2 closed. Focus moved to Shell 1.')
    expect(killed).toEqual(['T-1-shell-1'])
    expect(released).toEqual(['T-1-shell-1'])
    expect(focused).toEqual(['T-1-shell-0'])
    expect(changes).toEqual([1, 0])
    expect(counts).toEqual([1, 2, 1])
  })

  it('publishes the adjacent active tab snapshot before focusing when closing the active tab', async () => {
    const { controller, focusSnapshots } = createHarness()

    controller.hydrate()
    await controller.addTab()
    focusSnapshots.length = 0

    await controller.closeActiveTab()

    expect(focusSnapshots[0]?.tabs.map(tab => tab.label)).toEqual(['Shell 1'])
    expect(focusSnapshots[0]?.activeTabIndex).toBe(0)
  })

  it('keeps the final running shell open but allows closing the final exited shell', async () => {
    const { controller, emitLifecycle, killed, released } = createHarness()

    controller.hydrate()
    await controller.closeActiveTab()
    expect(controller.getSnapshot().tabs).toHaveLength(1)
    expect(killed).toEqual([])

    emitLifecycle('T-1-shell-0', { ptyActive: false, shellExited: true, currentPtyInstance: 1, hasOutput: true })
    await controller.closeActiveTab()

    expect(controller.getSnapshot().tabs).toHaveLength(0)
    expect(killed).toEqual(['T-1-shell-0'])
    expect(released).toEqual(['T-1-shell-0'])
  })

  it('announces lifecycle transitions and unsubscribes removed tabs', async () => {
    const { controller, emitLifecycle, lifecycleSubscribers } = createHarness()

    controller.hydrate()
    await controller.addTab()
    emitLifecycle('T-1-shell-1', { ptyActive: false, shellExited: true, currentPtyInstance: 2, hasOutput: true })

    expect(controller.getSnapshot().liveMessage).toBe('Shell 2 exited. Use Restart shell to start it again.')
    expect(controller.isTabExited('T-1-shell-1')).toBe(true)

    emitLifecycle('T-1-shell-1', { ptyActive: true, shellExited: false, currentPtyInstance: 3, hasOutput: false })
    expect(controller.getSnapshot().liveMessage).toBe('Shell 2 restarted. Focus returned to Shell 2 terminal.')

    await controller.closeActiveTab()
    expect(lifecycleSubscribers.has('T-1-shell-1')).toBe(false)
  })

  it('logs kill failures but still removes the tab', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const harness = createHarness()
    const controller = createTerminalTabsController({
      taskId: 'T-1',
      getTaskTerminalTabsSession: harness.controller.getSession,
      updateTaskTerminalTabsSession: (taskId, session) => harness.sessions.set(taskId, session),
      getShellLifecycleState: () => ({ ptyActive: false, shellExited: false, currentPtyInstance: null, hasOutput: false }),
      subscribeShellLifecycle: () => () => undefined,
      killPty: async () => { throw new Error('nope') },
      releaseTerminal: () => undefined,
      focusTerminal: () => undefined,
      waitForDomUpdate: async () => undefined,
      loggerName: 'TerminalTabs',
    })

    controller.hydrate()
    await controller.addTab()
    await controller.closeActiveTab()

    expect(controller.getSnapshot().tabs.map(tab => tab.label)).toEqual(['Shell 1'])
    expect(consoleError).toHaveBeenCalledWith('[TerminalTabs] Failed to kill PTY on close:', expect.any(Error))
    consoleError.mockRestore()
  })
})
