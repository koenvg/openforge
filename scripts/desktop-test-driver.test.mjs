import { describe, expect, it, vi } from 'vitest'
import { createDesktopAppDriver } from './desktop-test/driver.mjs'

function locator(name) {
  return {
    name,
    click: vi.fn(async () => undefined),
    first: vi.fn(function first() { return this }),
    waitFor: vi.fn(async () => undefined),
  }
}

function createPage() {
  const project = locator('project')
  const task = locator('task')
  const backlog = locator('backlog')
  const terminal = locator('terminal')
  const terminalInput = {
    press: vi.fn(async () => undefined),
    fill: vi.fn(async () => undefined),
  }
  terminal.getByRole = vi.fn(() => terminalInput)
  const shellTab = locator('shell-tab')
  const terminalTab = locator('terminal-tab')
  const taskWorkbenchTabs = { getByRole: vi.fn(() => terminalTab) }
  const newShell = locator('new-shell')
  const page = {
    keyboard: {
      press: vi.fn(async () => undefined),
      type: vi.fn(async () => undefined),
    },
    evaluate: vi.fn()
      .mockResolvedValueOnce({ ok: true, projectCount: 1 })
      .mockResolvedValueOnce(['T-1-shell-0']),
    getByRole: vi.fn((role, options) => {
      if (role === 'navigation' && options?.name === 'Task workbench tabs') return taskWorkbenchTabs
      if (role === 'tab' && String(options?.name).includes('Shell 1')) return shellTab
      if (role === 'button' && String(options?.name).includes('Backlog')) return backlog
      if (role === 'button' && String(options?.name).includes('Terminal performance fixture')) return task
      if (role === 'button' && options?.name === 'Open new shell') return newShell
      if (role === 'region') return terminal
      throw new Error(`Unexpected role ${role}`)
    }),
    getByText: vi.fn(() => project),
    waitForFunction: vi.fn(async () => undefined),
  }
  return { backlog, newShell, page, project, shellTab, task, taskWorkbenchTabs, terminal, terminalInput, terminalTab }
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

    expect(harness.page.waitForFunction).toHaveBeenCalledTimes(3)
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

  it('types terminal commands through the focused terminal landmark', async () => {
    const harness = createPage()
    const driver = createDesktopAppDriver(harness.page)

    await driver.typeTerminalCommand(harness.terminal, 'printf TEST_READY')

    expect(harness.shellTab.click).toHaveBeenCalledOnce()
    expect(harness.terminal.click).not.toHaveBeenCalled()
    expect(harness.terminal.getByRole).toHaveBeenCalledWith('textbox', { name: 'Terminal input' })
    expect(harness.terminalInput.fill).toHaveBeenCalledWith('printf TEST_READY')
    expect(harness.terminalInput.press).toHaveBeenCalledWith('Enter')
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
})
