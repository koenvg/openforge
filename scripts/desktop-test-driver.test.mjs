import { describe, expect, it, vi } from 'vitest'
import { createDesktopAppDriver } from './desktop-test/driver.mjs'

function locator(name) {
  return {
    name,
    isVisible: vi.fn(async () => false),
    click: vi.fn(async () => undefined),
    first: vi.fn(function first() { return this }),
    waitFor: vi.fn(async () => undefined),
  }
}

function createPage() {
  const project = locator('project')
  const task = locator('task')
  const openFullView = locator('open-full-view')
  const backlog = locator('backlog')
  const backToTaskBoard = locator('back-to-task-board')
  const terminal = locator('terminal')
  const visibleTerminalText = locator('visible-terminal-text')
  terminal.getByText = vi.fn(() => visibleTerminalText)
  const terminalInput = {
    focus: vi.fn(async () => undefined),
    press: vi.fn(async () => undefined),
    fill: vi.fn(async () => undefined),
  }
  terminal.getByRole = vi.fn(() => terminalInput)
  const shellTab = locator('shell-tab')
  const terminalTab = locator('terminal-tab')
  const agentTab = locator('agent-tab')
  const taskWorkbenchTabs = {
    waitFor: vi.fn(async () => undefined),
    getByRole: vi.fn((_role, options) => options?.name === 'agent' ? agentTab : terminalTab),
  }
  const newShell = locator('new-shell')
  const page = {
    keyboard: {
      press: vi.fn(async () => undefined),
      insertText: vi.fn(async () => undefined),
      type: vi.fn(async () => undefined),
    },
    evaluate: vi.fn()
      .mockResolvedValueOnce({ ok: true, projectCount: 1 })
      .mockResolvedValueOnce(['T-1-shell-0']),
    getByRole: vi.fn((role, options) => {
      if (role === 'navigation' && options?.name === 'Task workbench tabs') return taskWorkbenchTabs
      if (role === 'tab' && String(options?.name).includes('Shell 1')) return shellTab
      if (role === 'button' && String(options?.name).includes('Backlog')) return backlog
      if (role === 'button' && options?.name === 'Back to task board') return backToTaskBoard
      if (role === 'button' && String(options?.name).includes('Terminal performance fixture')) return task
      if (role === 'button' && String(options?.name).includes('Open full view')) return openFullView
      if (role === 'button' && options?.name === 'Open new shell') return newShell
      if (role === 'region') return terminal
      throw new Error(`Unexpected role ${role}`)
    }),
    getByText: vi.fn(() => project),
    waitForFunction: vi.fn(async () => undefined),
  }
  return {
    agentTab, backToTaskBoard, backlog, newShell, openFullView, page, project, shellTab, task, taskWorkbenchTabs, terminal,
    terminalInput, terminalTab, visibleTerminalText,
  }
}

const manifest = {
  projectId: 'P-1',
  projectName: 'Desktop Test Project',
  taskId: 'T-1',
  taskTitle: 'Terminal performance fixture',
}

describe('desktop app driver', () => {
  it('verifies the desktop bridge and opens the seeded terminal with accessible controls', async () => {
    const harness = createPage()
    const driver = createDesktopAppDriver(harness.page, { timeoutMs: 8_000 })

    await expect(driver.verifyDesktopBridge()).resolves.toEqual({ ok: true, projectCount: 1 })
    const opened = await driver.openSeededTerminal(manifest)

    expect(harness.page.waitForFunction).toHaveBeenCalledTimes(4)
    expect(harness.page.getByText).toHaveBeenCalledWith('Desktop Test Project', { exact: true })
    expect(harness.project.click).toHaveBeenCalledOnce()
    expect(harness.page.getByRole).toHaveBeenCalledWith('button', { name: /^Backlog\b/i })
    expect(harness.backlog.click).toHaveBeenCalledOnce()
    expect(harness.page.getByRole).toHaveBeenCalledWith('button', {
      name: /Terminal performance fixture/i,
    })
    expect(harness.task.click).toHaveBeenCalledOnce()
    expect(harness.page.getByRole).toHaveBeenCalledWith('navigation', { name: 'Task workbench tabs' })
    expect(harness.taskWorkbenchTabs.getByRole).toHaveBeenCalledWith('button', { name: 'Terminal' })
    expect(harness.terminalTab.click).toHaveBeenCalledOnce()
    expect(harness.page.getByRole).toHaveBeenCalledWith('tab', { name: /^Shell 1\b/i })
    expect(harness.shellTab.click).toHaveBeenCalledOnce()
    expect(harness.page.getByRole).toHaveBeenCalledWith('region', {
      name: 'Terminal region for Shell 1',
    })
    expect(harness.terminal.waitFor).toHaveBeenCalledWith({ state: 'visible', timeout: 8_000 })
    expect(opened).toEqual({ region: harness.terminal, terminalKey: 'T-1-shell-0' })
    expect(JSON.stringify(opened)).not.toContain('xterm')
  })

  it('opens the full task view when board selection stays in the preview pane', async () => {
    const harness = createPage()
    harness.taskWorkbenchTabs.waitFor
      .mockRejectedValueOnce(new Error('workbench not visible'))
      .mockResolvedValueOnce(undefined)
    const driver = createDesktopAppDriver(harness.page, { timeoutMs: 8_000 })

    await driver.selectSeededTask(manifest)

    expect(harness.openFullView.click).toHaveBeenCalledOnce()
    expect(harness.taskWorkbenchTabs.waitFor).toHaveBeenLastCalledWith({
      state: 'visible',
      timeout: 8_000,
    })
  })

  it('returns to the task board before selecting a task from an existing full view', async () => {
    const harness = createPage()
    harness.backToTaskBoard.isVisible.mockResolvedValue(true)
    const driver = createDesktopAppDriver(harness.page, { timeoutMs: 8_000 })

    await driver.selectSeededTask(manifest)

    expect(harness.backToTaskBoard.click).toHaveBeenCalledOnce()
    expect(harness.backToTaskBoard.waitFor).toHaveBeenCalledWith({
      state: 'hidden',
      timeout: 8_000,
    })
    expect(harness.backToTaskBoard.click.mock.invocationCallOrder[0])
      .toBeLessThan(harness.project.click.mock.invocationCallOrder[0])
  })

  it('types terminal commands through the focused terminal landmark', async () => {
    const harness = createPage()
    const driver = createDesktopAppDriver(harness.page)

    await driver.typeTerminalCommand(harness.terminal, 'printf TEST_READY')

    expect(harness.shellTab.click).toHaveBeenCalledOnce()
    expect(harness.terminal.click).not.toHaveBeenCalled()
    expect(harness.page.keyboard.insertText).toHaveBeenCalledWith('printf TEST_READY')
    expect(harness.page.keyboard.press).toHaveBeenCalledWith('Enter')
  })

  it('types through an already-focused terminal without clicking the shell tab', async () => {
    const harness = createPage()
    const driver = createDesktopAppDriver(harness.page)

    await driver.focusTerminal()
    expect(harness.shellTab.click).toHaveBeenCalledOnce()
    harness.shellTab.click.mockClear()

    await driver.typeFocusedTerminalCommand(harness.terminal, 'printf STEADY_STATE')

    expect(harness.shellTab.click).not.toHaveBeenCalled()
    expect(harness.page.keyboard.insertText).toHaveBeenCalledWith('printf STEADY_STATE')
    expect(harness.page.keyboard.press).toHaveBeenCalledWith('Enter')
  })

  it('waits for the development performance probe before starting a trace', async () => {
    const harness = createPage()
    const driver = createDesktopAppDriver(harness.page, { timeoutMs: 8_000 })

    await driver.startTerminalPerformanceTrace()

    expect(harness.page.waitForFunction).toHaveBeenCalledOnce()
    expect(harness.page.waitForFunction).toHaveBeenCalledWith(
      expect.any(Function),
      null,
      { timeout: 8_000 },
    )
  })

  it('rejects unavailable desktop bridges and missing probe terminal keys', async () => {
    const unavailable = createPage()
    unavailable.page.evaluate.mockReset().mockResolvedValue({ ok: false, message: 'window.openforge is undefined' })
    const unavailableDriver = createDesktopAppDriver(unavailable.page)
    await expect(unavailableDriver.verifyDesktopBridge()).rejects.toThrow('window.openforge is undefined')

    const missing = createPage()
    missing.page.evaluate.mockReset()
      .mockResolvedValueOnce({ ok: true, projectCount: 1 })
      .mockResolvedValueOnce([])
    const missingDriver = createDesktopAppDriver(missing.page)
    await missingDriver.verifyDesktopBridge()
    await expect(missingDriver.openSeededTerminal(manifest)).rejects.toThrow('No observed shell terminal for task T-1')
  })

  it('attaches and detaches the terminal through normal task workbench controls', async () => {
    const harness = createPage()
    harness.page.evaluate.mockReset().mockResolvedValueOnce(['T-1-shell-0'])
    const driver = createDesktopAppDriver(harness.page, { timeoutMs: 8_000 })

    const attached = await driver.attachTerminalView('T-1')
    await driver.detachTerminalView(attached.region)

    expect(harness.taskWorkbenchTabs.getByRole).toHaveBeenCalledWith('button', { name: 'Terminal' })
    expect(harness.terminalTab.click).toHaveBeenCalledOnce()
    expect(attached).toEqual({ region: harness.terminal, terminalKey: 'T-1-shell-0' })
    expect(harness.page.getByRole).toHaveBeenCalledWith('button', { name: 'Back to task board' })
    expect(harness.backToTaskBoard.click).toHaveBeenCalledOnce()
    expect(harness.terminal.waitFor).toHaveBeenLastCalledWith({ state: 'hidden', timeout: 2_000 })
  })

  it('starts a recovery attachment without waiting for terminal presentation', async () => {
    const harness = createPage()
    const driver = createDesktopAppDriver(harness.page, { timeoutMs: 8_000 })

    const attachment = await driver.attachTerminalView('T-1', { focus: false, observe: false })

    expect(harness.terminalTab.click).toHaveBeenCalledOnce()
    expect(harness.terminal.waitFor).not.toHaveBeenCalled()
    expect(harness.shellTab.click).not.toHaveBeenCalled()
    expect(attachment).toEqual({ region: harness.terminal, terminalKey: null })
  })

  it('falls back to project navigation when back navigation does not detach the view', async () => {
    const harness = createPage()
    harness.terminal.waitFor
      .mockRejectedValueOnce(new Error('terminal remained visible'))
      .mockResolvedValueOnce(undefined)
    const driver = createDesktopAppDriver(harness.page, { timeoutMs: 8_000 })

    await driver.detachTerminalView(harness.terminal, { projectName: manifest.projectName })

    expect(harness.backToTaskBoard.click).toHaveBeenCalledOnce()
    expect(harness.page.getByText).toHaveBeenCalledWith('Desktop Test Project', { exact: true })
    expect(harness.project.click).toHaveBeenCalledOnce()
    expect(harness.terminal.waitFor).toHaveBeenLastCalledWith({ state: 'hidden', timeout: 8_000 })
  })

  it('uses only bounded gate, marker, visible-output, and diagnostic controls', async () => {
    const harness = createPage()
    harness.page.evaluate.mockReset()
      .mockResolvedValueOnce({ id: 'gate-1', state: 'armed' })
      .mockResolvedValueOnce({ id: 'gate-1', state: 'reached' })
      .mockResolvedValueOnce({ operationId: 'output-1', marker: 'fixture-complete', sequenceBaseline: 4 })
      .mockResolvedValueOnce({
        terminal: { lifecycle: { attachmentGeneration: 1 }, output: { sequenceContinuous: true } },
        gates: [{ id: 'gate-1', state: 'reached' }],
      })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
    const driver = createDesktopAppDriver(harness.page, { timeoutMs: 8_000 })

    await expect(driver.armTerminalGate('acquisition', 'T-1-shell-0', { timeoutMs: 5_000 }))
      .resolves.toEqual({ id: 'gate-1', state: 'armed' })
    await expect(driver.waitForTerminalGate('gate-1', 'reached'))
      .resolves.toEqual({ id: 'gate-1', state: 'reached' })
    await expect(driver.emitTerminalFixtureOutput('T-1-shell-0', 'fixture-complete', 32))
      .resolves.toMatchObject({ operationId: 'output-1', marker: 'fixture-complete' })
    await expect(driver.captureTerminalDiagnostics('T-1-shell-0')).resolves.toMatchObject({
      terminal: { output: { sequenceContinuous: true } },
      gates: [{ id: 'gate-1' }],
    })
    await driver.resumeTerminalGate('gate-1')
    await driver.cancelTerminalGate('gate-2')
    await driver.waitForVisibleTerminalText(harness.terminal, 'fixture-complete')

    expect(harness.terminal.getByText).toHaveBeenCalledWith('fixture-complete', { exact: false })
    expect(harness.visibleTerminalText.waitFor).toHaveBeenCalledWith({ state: 'visible', timeout: 8_000 })
    expect(harness.page.evaluate.mock.calls.map(([, argument]) => argument)).toEqual([
      { kind: 'acquisition', key: 'T-1-shell-0', options: { timeoutMs: 5_000 } },
      { id: 'gate-1', state: 'reached' },
      { key: 'T-1-shell-0', marker: 'fixture-complete', byteCount: 32 },
      'T-1-shell-0',
      'gate-1',
      'gate-2',
    ])
  })
})
