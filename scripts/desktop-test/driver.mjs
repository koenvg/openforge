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

  async function focusTerminal() {
    await page.getByRole('tab', { name: /^Shell 1\b/i }).click()
    await page.waitForFunction(
      label => [...document.querySelectorAll('[role="region"]')]
        .find(element => element.getAttribute('aria-label') === label)
        ?.contains(document.activeElement),
      'Terminal region for Shell 1',
      { timeout: timeoutMs },
    )
  }

  async function attachTerminalView(taskId, { focus = true, observe = true } = {}) {
    await selectTaskView('Terminal')
    const region = page.getByRole('region', { name: 'Terminal region for Shell 1' })
    await region.waitFor({ state: 'visible', timeout: timeoutMs })
    if (focus) await focusTerminal()
    if (!observe) return { region, terminalKey: null }
    await page.waitForFunction(
      expectedTaskId => window.__openforgeE2e?.terminal.list()
        .some(key => key.startsWith(`${expectedTaskId}-shell-`)),
      taskId,
      { timeout: timeoutMs },
    )
    const terminalKeys = await page.evaluate(() => window.__openforgeE2e?.terminal.list() ?? [])
    const terminalKey = terminalKeys.find(key => key.startsWith(`${taskId}-shell-`))
    if (!terminalKey) throw new Error(`No observed shell terminal for task ${taskId}`)
    return { region, terminalKey }
  }

  async function detachTerminalView(region, { projectName = null } = {}) {
    await page.getByRole('button', { name: 'Back to task board' }).click()
    try {
      await region.waitFor({ state: 'hidden', timeout: Math.min(timeoutMs, 2_000) })
    } catch (error) {
      if (!projectName) throw error
      await page.getByText(projectName, { exact: true }).first().click()
      await region.waitFor({ state: 'hidden', timeout: timeoutMs })
    }
  }

  async function selectSeededTask(manifest) {
    const backToTaskBoard = page.getByRole('button', { name: 'Back to task board' })
    if (await backToTaskBoard.isVisible()) {
      await backToTaskBoard.click()
      await backToTaskBoard.waitFor({ state: 'hidden', timeout: timeoutMs })
    }
    const project = page.getByText(manifest.projectName, { exact: true }).first()
    await project.click()
    await page.getByRole('button', { name: /^Backlog\b/i }).click()
    const task = page.getByRole('button', {
      name: new RegExp(escapeRegExp(manifest.taskTitle), 'i'),
    }).first()
    await task.click()
    const workbenchTabs = page.getByRole('navigation', { name: 'Task workbench tabs' })
    try {
      await workbenchTabs.waitFor({ state: 'visible', timeout: Math.min(timeoutMs, 2_000) })
    } catch {
      await page.getByRole('button', { name: /^Open full view\b/i }).click()
      await workbenchTabs.waitFor({ state: 'visible', timeout: timeoutMs })
    }
  }

  async function openSeededTerminal(manifest) {
    await selectSeededTask(manifest)
    await selectTaskView('Terminal')
    const region = page.getByRole('region', { name: 'Terminal region for Shell 1' })
    await region.waitFor({ state: 'visible', timeout: timeoutMs })
    await focusTerminal()
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
    await page.waitForFunction(
      key => window.__openforgeDesktopTest?.terminal.observe(key).lifecycle.ptyActive === true,
      terminalKey,
      { timeout: timeoutMs },
    )
    return { region, terminalKey }
  }

  async function typeFocusedTerminalCommand(_region, command) {
    await page.keyboard.insertText(command)
    await page.keyboard.press('Enter')
  }

  async function typeTerminalCommand(region, command) {
    await focusTerminal()
    await typeFocusedTerminalCommand(region, command)
  }

  async function startTerminalPerformanceTrace() {
    await page.waitForFunction(
      () => typeof window.__openforgeDesktopTest?.terminal.performance?.start === 'function',
      null,
      { timeout: timeoutMs },
    )
    return page.evaluate(() => {
      const performanceTrace = window.__openforgeDesktopTest?.terminal.performance
      if (!performanceTrace) throw new Error('Terminal performance trace is unavailable')
      performanceTrace.start()
    })
  }

  async function finishTerminalPerformanceTrace() {
    return page.evaluate(() => {
      const performanceTrace = window.__openforgeDesktopTest?.terminal.performance
      if (!performanceTrace) throw new Error('Terminal performance trace is unavailable')
      return performanceTrace.finish()
    })
  }

  async function observeTerminal(terminalKey) {
    return page.evaluate(
      key => window.__openforgeE2e?.terminal.observe(key) ?? null,
      terminalKey,
    )
  }

  async function drainTerminal(terminalKey, expectation = {}) {
    return page.evaluate(
      ({ key, expected }) => {
        const probe = window.__openforgeE2e
        if (!probe) throw new Error('OpenForge desktop test probe is unavailable')
        return probe.terminal.drain(key, expected)
      },
      { key: terminalKey, expected: expectation },
    )
  }

  async function armTerminalGate(kind, key, gateOptions = {}) {
    await waitForE2eControls()
    return page.evaluate(({ kind: gateKind, key: terminalKey, options: armOptions }) => {
      const controls = window.__openforgeE2e
      if (!controls) throw new Error('OpenForge E2E controls are unavailable')
      return controls.gates.arm(gateKind, terminalKey, armOptions)
    }, { kind, key, options: gateOptions })
  }
  async function waitForE2eControls() {
    await page.waitForFunction(
      () => typeof window.__openforgeE2e?.gates?.arm === 'function',
      null,
      { timeout: timeoutMs },
    )
  }

  async function waitForTerminalGate(id, state) {
    await page.waitForFunction(
      ({ id: gateId, state: expectedState }) => {
        const gate = window.__openforgeE2e?.gates.get(gateId)
        if (!gate) return false
        if (['resumed', 'cancelled', 'timed-out'].includes(gate.state) && gate.state !== expectedState) {
          throw new Error(`Terminal E2E gate ${gateId} completed as ${gate.state} before reaching ${expectedState}`)
        }
        return gate.state === expectedState
      },
      { id, state },
      { timeout: timeoutMs },
    )
    return page.evaluate(({ id: gateId }) => window.__openforgeE2e?.gates.get(gateId) ?? null, { id, state })
  }

  async function resumeTerminalGate(id) {
    return page.evaluate((gateId) => {
      const controls = window.__openforgeE2e
      if (!controls) throw new Error('OpenForge E2E controls are unavailable')
      controls.gates.resume(gateId)
    }, id)
  }

  async function cancelTerminalGate(id) {
    return page.evaluate((gateId) => {
      const controls = window.__openforgeE2e
      if (!controls) throw new Error('OpenForge E2E controls are unavailable')
      controls.gates.cancel(gateId)
    }, id)
  }

  async function emitTerminalFixtureOutput(key, marker, byteCount) {
    return page.evaluate(({ key: terminalKey, marker: outputMarker, byteCount: outputBytes }) => {
      const controls = window.__openforgeE2e
      if (!controls) throw new Error('OpenForge E2E controls are unavailable')
      return controls.terminal.emitFixtureOutput(terminalKey, outputMarker, outputBytes)
    }, { key, marker, byteCount })
  }

  async function captureTerminalDiagnostics(key) {
    return page.evaluate((terminalKey) => {
      const controls = window.__openforgeE2e
      if (!controls) throw new Error('OpenForge E2E controls are unavailable')
      return {
        terminal: controls.terminal.observe(terminalKey),
        gates: controls.gates.list(),
      }
    }, key)
  }

  async function waitForVisibleTerminalText(region, text) {
    await region.getByText(text, { exact: false }).waitFor({ state: 'visible', timeout: timeoutMs })
  }

  async function captureTerminalScreenshot(region) {
    return region.screenshot({ animations: 'disabled' })
  }

  async function waitForUiQuiescence() {
    await page.waitForFunction(
      () => {
        const controls = window.__openforgeE2e
        if (!controls || document.readyState !== 'complete') return false
        const hasPendingGate = controls.gates.list()
          .some(gate => gate.state === 'armed' || gate.state === 'reached')
        if (hasPendingGate) return false
        return controls.terminal.list().every(key => {
          const observation = controls.terminal.observe(key)
          const subscription = observation.modelOutputSubscription
          return !observation.lifecycle.attached
            && !observation.lifecycle.authorityReadPending
            && !subscription?.desired
            && !subscription?.pending
            && !subscription?.registered
        })
      },
      null,
      { timeout: timeoutMs },
    )
  }

  return {
    armTerminalGate,
    attachTerminalView,
    cancelTerminalGate,
    captureTerminalDiagnostics,
    captureTerminalScreenshot,
    detachTerminalView,
    drainTerminal,
    emitTerminalFixtureOutput,
    finishTerminalPerformanceTrace,
    focusTerminal,
    observeTerminal,
    selectSeededTask,
    selectTaskView,
    resumeTerminalGate,
    startTerminalPerformanceTrace,
    openSeededTerminal,
    typeFocusedTerminalCommand,
    typeTerminalCommand,
    waitForTerminalGate,
    waitForVisibleTerminalText,
    waitForUiQuiescence,
    verifyDesktopBridge,
  }
}
