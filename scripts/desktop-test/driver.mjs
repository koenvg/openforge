const DEFAULT_DRIVER_TIMEOUT_MS = 20_000

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function createDesktopAppDriver(page, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_DRIVER_TIMEOUT_MS

  async function verifyDesktopBridge() {
    await page.waitForFunction(
      () => typeof window.openforge?.invoke === 'function',
      null,
      { timeout: timeoutMs },
    )
    const result = await page.evaluate(async () => {
      const bridge = window.openforge
      if (!bridge || typeof bridge.invoke !== 'function') {
        return { ok: false, message: 'window.openforge is undefined' }
      }
      try {
        const projects = await bridge.invoke('get_projects')
        return { ok: true, projectCount: Array.isArray(projects) ? projects.length : null }
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) }
      }
    })
    if (!result?.ok) throw new Error(`Desktop bridge check failed: ${result?.message ?? 'unknown error'}`)
    return result
  }

  async function selectTaskView(name) {
    await page
      .getByRole('navigation', { name: 'Task workbench tabs' })
      .getByRole('button', { name })
      .click()
  }

  async function focusShellTerminal() {
    await page.getByRole('tab', { name: /^Shell 1\b/i }).click()
    await page.waitForFunction(
      label => [...document.querySelectorAll('[role="region"]')]
        .find(element => element.getAttribute('aria-label') === label)
        ?.contains(document.activeElement),
      'Terminal region for Shell 1',
      { timeout: timeoutMs },
    )
  }

  async function openSeededTerminal(manifest) {
    const project = page.getByText(manifest.projectName, { exact: true }).first()
    await project.click()
    await page.getByRole('button', { name: /^Backlog\b/i }).click()

    const task = page.getByRole('button', {
      name: new RegExp(escapeRegExp(manifest.taskTitle), 'i'),
    }).first()
    await task.click()
    await selectTaskView('Terminal')

    const region = page.getByRole('region', { name: 'Terminal region for Shell 1' })
    await region.waitFor({ state: 'visible', timeout: timeoutMs })
    await focusShellTerminal()
    await page.waitForFunction(
      taskId => window.__openforgeDesktopTest?.terminal.list()
        .some(key => key.startsWith(`${taskId}-shell-`)),
      manifest.taskId,
      { timeout: timeoutMs },
    )
    const terminalKeys = await page.evaluate(
      () => window.__openforgeDesktopTest?.terminal.list() ?? [],
    )
    const terminalKey = terminalKeys.find(key => key.startsWith(`${manifest.taskId}-shell-`))
    if (!terminalKey) throw new Error(`No observed shell terminal for task ${manifest.taskId}`)
    return { region, terminalKey }
  }

  async function typeTerminalCommand(region, command) {
    await focusShellTerminal()
    const terminalInput = region.getByRole('textbox', { name: 'Terminal input' })
    await terminalInput.fill(command)
    await terminalInput.press('Enter')
  }

  async function observeTerminal(terminalKey) {
    return page.evaluate(
      key => window.__openforgeDesktopTest?.terminal.observe(key) ?? null,
      terminalKey,
    )
  }

  async function drainTerminal(terminalKey, expectation = {}) {
    return page.evaluate(
      ({ key, expected }) => {
        const probe = window.__openforgeDesktopTest
        if (!probe) throw new Error('OpenForge desktop test probe is unavailable')
        return probe.terminal.drain(key, expected)
      },
      { key: terminalKey, expected: expectation },
    )
  }

  return {
    drainTerminal,
    observeTerminal,
    selectTaskView,
    openSeededTerminal,
    typeTerminalCommand,
    verifyDesktopBridge,
  }
}
