import { Buffer } from 'node:buffer'
import { createDesktopAppDriver } from './driver.mjs'

function assertDetachedRecovery(detached, emission) {
  if (detached?.lifecycle?.attached !== false || detached.lifecycle.recoveryNeeded !== true) {
    throw new Error('Terminal detached recovery was marked complete or remained attached after stale-read release')
  }
  const subscription = detached.modelOutputSubscription
  if (subscription && (subscription.desired || subscription.pending || subscription.registered)) {
    throw new Error('Detached terminal model output was re-enabled during recovery')
  }
  if (detached.lifecycle.authorityReadPending) {
    throw new Error('Detached terminal retained a pending authority read after gate release')
  }
  if (detached.lifecycle.currentPtyInstance !== null
    && detached.lifecycle.currentPtyInstance !== emission.ptyInstanceId) {
    throw new Error(`Detached terminal PTY ${detached.lifecycle.currentPtyInstance} did not match emitted PTY ${emission.ptyInstanceId}`)
  }
  if (detached.output?.sequenceContinuous !== true) {
    throw new Error('Detached terminal output sequence became discontinuous')
  }
}

function assertFreshAttachment(fresh, detached, emission, marker, drained) {
  if (fresh?.lifecycle?.attached !== true || fresh.lifecycle.recoveryNeeded !== false) {
    throw new Error('Fresh terminal attachment did not complete authoritative recovery')
  }
  if (fresh.lifecycle.attachmentGeneration <= detached.lifecycle.attachmentGeneration) {
    throw new Error('Fresh terminal attachment did not advance attachment generation')
  }
  if (fresh.lifecycle.currentPtyInstance !== emission.ptyInstanceId) {
    throw new Error(`Fresh PTY instance ${fresh.lifecycle.currentPtyInstance ?? 'unknown'} does not match emitted instance ${emission.ptyInstanceId}`)
  }
  if (fresh.modelOutputSubscription?.desired !== true || fresh.modelOutputSubscription?.registered !== true) {
    throw new Error('Fresh terminal attachment did not re-enable model output')
  }
  if (!Number.isSafeInteger(fresh.output?.lastSequence)
    || fresh.output.lastSequence <= emission.sequenceBaseline
    || !Number.isSafeInteger(fresh.output.modelSequence)
    || fresh.output.modelSequence <= emission.sequenceBaseline) {
    throw new Error('Fresh terminal regressed to the stale authority response')
  }
  if (fresh.output?.sequenceContinuous !== true || fresh.output.lastSequence < detached.output.lastSequence) {
    throw new Error('Fresh terminal attachment lost authoritative sequence continuity')
  }
  if (!drained?.markerFound || !drained.visibleText?.includes(marker)) {
    throw new Error(`Fresh terminal attachment did not present latest controlled output ${marker}`)
  }
}

export async function runDetachDuringRecoveryScenario({ context, options }, dependencies = {}) {
  const manifest = context?.fixture?.manifest
  if (!manifest?.taskId) throw new Error('Detach-during-recovery scenario requires an isolated fixture task')
  const createDriver = dependencies.createDriver ?? createDesktopAppDriver
  const createMarker = dependencies.createMarker ?? (() => `detach-recovery-${crypto.randomUUID()}`)
  const outputBytes = dependencies.outputBytes ?? 4 * 1024
  const driver = createDriver(context.page, { timeoutMs: Math.min(options.scenarioTimeoutMs, 20_000) })
  let terminalKey = `${manifest.taskId}-shell-0`
  const marker = createMarker()
  let gate = null
  let acquisitionGate = null
  let acquisitionReleased = false
  let released = false
  let recoveringAttachment = null

  try {
    await driver.verifyDesktopBridge()
    await driver.selectSeededTask(manifest)
    const initial = await driver.attachTerminalView(manifest.taskId)
    terminalKey = initial.terminalKey
    const screenshotBeforeRecovery = await driver.captureTerminalScreenshot(initial.region)
    const initialDiagnostics = await driver.captureTerminalDiagnostics(terminalKey)
    await driver.detachTerminalView(initial.region, { projectName: manifest.projectName })

    gate = await driver.armTerminalGate('authoritative-read', terminalKey, {
      timeoutMs: Math.min(options.scenarioTimeoutMs, 20_000),
    })
    acquisitionGate = await driver.armTerminalGate('acquisition', terminalKey, {
      timeoutMs: Math.min(options.scenarioTimeoutMs, 20_000),
    })
    await driver.selectSeededTask(manifest)
    recoveringAttachment = driver.attachTerminalView(manifest.taskId, { focus: false, observe: false })
    try {
      await driver.waitForTerminalGate(gate.id, 'reached')
    } catch (error) {
      const diagnostics = await driver.captureTerminalDiagnostics(terminalKey)
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Authoritative-read gate was not reached: ${message}; ${JSON.stringify(diagnostics)}`)
    }
    await driver.detachTerminalView(initial.region, { projectName: manifest.projectName })
    const emission = await driver.emitTerminalFixtureOutput(terminalKey, marker, outputBytes)
    await driver.resumeTerminalGate(gate.id)
    released = true
    await driver.waitForTerminalGate(acquisitionGate.id, 'reached')
    await driver.resumeTerminalGate(acquisitionGate.id)
    acquisitionReleased = true
    await recoveringAttachment

    const detachedDiagnostics = await driver.captureTerminalDiagnostics(terminalKey)
    assertDetachedRecovery(detachedDiagnostics.terminal, emission)

    await driver.selectSeededTask(manifest)
    const freshAttachment = await driver.attachTerminalView(manifest.taskId)
    const drained = await driver.drainTerminal(terminalKey, {
      marker,
      minimumModelSequence: emission.sequenceBaseline + 1,
      timeoutMs: options.scenarioTimeoutMs,
    })
    const screenshotAfterRecovery = await driver.captureTerminalScreenshot(freshAttachment.region)
    if (Buffer.from(screenshotBeforeRecovery).equals(Buffer.from(screenshotAfterRecovery))) {
      throw new Error('Fresh attachment Playwright screenshot did not change after newer output')
    }
    const freshDiagnostics = await driver.captureTerminalDiagnostics(terminalKey)
    assertFreshAttachment(freshDiagnostics.terminal, detachedDiagnostics.terminal, emission, marker, drained)

    return {
      assertions: [
        { name: 'detached recovery remained pending', passed: true },
        { name: 'detached model output remained disabled', passed: true },
        { name: 'newer authority survived stale response', passed: true },
        { name: 'fresh attachment presented latest output', passed: true },
      ],
      artifacts: {
        screenshots: [
          { name: 'detach-recovery-before.png', content: screenshotBeforeRecovery },
          { name: 'detach-recovery-after.png', content: screenshotAfterRecovery },
        ],
      },
      diagnostics: {
        marker,
        emission,
        initial: initialDiagnostics.terminal,
        detached: detachedDiagnostics.terminal,
        fresh: freshDiagnostics.terminal,
        gates: freshDiagnostics.gates,
        presentation: drained.presentation ?? null,
      },
    }
  } finally {
    if (gate && !released) await driver.cancelTerminalGate(gate.id).catch(() => {})
    if (acquisitionGate && !acquisitionReleased) {
      await driver.cancelTerminalGate(acquisitionGate.id).catch(() => {})
    }
    if (recoveringAttachment) await Promise.allSettled([recoveringAttachment])
  }
}
