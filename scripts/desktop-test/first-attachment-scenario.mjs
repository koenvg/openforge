import { Buffer } from 'node:buffer'
import { createDesktopAppDriver } from './driver.mjs'

function assertFirstAttachmentEvidence(terminal, emission, marker, drained) {
  if (!drained?.markerFound || !drained.visibleText?.includes(marker)) {
    throw new Error(`First attachment did not present controlled marker ${marker}`)
  }
  if (terminal?.lifecycle?.attachmentGeneration !== 1) {
    throw new Error(`First attachment used attachment generation ${terminal?.lifecycle?.attachmentGeneration ?? 'unknown'} instead of 1`)
  }
  if (terminal.lifecycle.authorityReadApplied !== true) {
    throw new Error('First attachment did not apply an authoritative terminal read')
  }
  if (terminal.lifecycle.currentPtyInstance !== emission.ptyInstanceId) {
    throw new Error(`First attachment PTY instance ${terminal.lifecycle.currentPtyInstance ?? 'unknown'} does not match emitted instance ${emission.ptyInstanceId}`)
  }
  if (terminal.output?.sequenceContinuous !== true) {
    throw new Error('First attachment output sequence is discontinuous')
  }
  if (!Number.isSafeInteger(terminal.output.lastSequence) || terminal.output.lastSequence <= emission.sequenceBaseline) {
    throw new Error(`First attachment sequence ${terminal.output?.lastSequence ?? 'unknown'} did not advance beyond emission baseline ${emission.sequenceBaseline}`)
  }
  if (!Number.isSafeInteger(terminal.output.modelSequence) || terminal.output.modelSequence < terminal.output.lastSequence) {
    throw new Error('First attachment authoritative model sequence trails visible output')
  }
  if (terminal.modelOutputSubscription?.desired !== true || terminal.modelOutputSubscription?.registered !== true) {
    throw new Error('First attachment model-output subscription is not registered')
  }
}

export async function runFirstAttachmentScenario({ context, options }, dependencies = {}) {
  const manifest = context?.fixture?.manifest
  if (!manifest?.taskId) throw new Error('First-attachment scenario requires an isolated fixture task')
  const createDriver = dependencies.createDriver ?? createDesktopAppDriver
  const createMarker = dependencies.createMarker ?? (() => `first-attachment-${crypto.randomUUID()}`)
  const outputBytes = dependencies.outputBytes ?? 4 * 1024
  const driver = createDriver(context.page, { timeoutMs: Math.min(options.scenarioTimeoutMs, 20_000) })
  const marker = createMarker()
  const terminalKey = `${manifest.taskId}-shell-0`
  let gate = null
  let attachment = null
  let released = false

  try {
    await driver.verifyDesktopBridge()
    await driver.selectSeededTask(manifest)
    gate = await driver.armTerminalGate('acquisition', terminalKey, {
      timeoutMs: Math.min(options.scenarioTimeoutMs, 20_000),
    })
    attachment = driver.attachTerminalView(manifest.taskId)
    await driver.waitForTerminalGate(gate.id, 'reached')
    await driver.resumeTerminalGate(gate.id)
    released = true
    const attached = await attachment
    if (attached.terminalKey !== terminalKey) {
      throw new Error(`First attachment resolved unexpected terminal key ${attached.terminalKey}`)
    }
    const screenshotBeforeOutput = await driver.captureTerminalScreenshot(attached.region)
    const emission = await driver.emitTerminalFixtureOutput(terminalKey, marker, outputBytes)
    const drained = await driver.drainTerminal(terminalKey, {
      marker,
      minimumReceivedBytes: outputBytes,
      minimumModelSequence: emission.sequenceBaseline + 1,
      timeoutMs: options.scenarioTimeoutMs,
    })
    const screenshotAfterOutput = await driver.captureTerminalScreenshot(attached.region)
    if (Buffer.from(screenshotBeforeOutput).equals(Buffer.from(screenshotAfterOutput))) {
      throw new Error('First attachment Playwright screenshot did not change after controlled output')
    }
    const diagnostics = await driver.captureTerminalDiagnostics(terminalKey)
    assertFirstAttachmentEvidence(diagnostics.terminal, emission, marker, drained)

    return {
      assertions: [
        { name: 'controlled output emitted', passed: true },
        { name: 'marker visible in first attachment', passed: true },
        { name: 'single attachment generation', passed: true },
        { name: 'authoritative sequence advanced continuously', passed: true },
      ],
      artifacts: {
        screenshots: [
          { name: 'first-attachment-before.png', content: screenshotBeforeOutput },
          { name: 'first-attachment-after.png', content: screenshotAfterOutput },
        ],
      },
      diagnostics: {
        marker,
        emission,
        terminal: diagnostics.terminal,
        gates: diagnostics.gates,
        presentation: drained.presentation ?? null,
      },
    }
  } finally {
    if (gate && !released) {
      await driver.cancelTerminalGate(gate.id).catch(() => {})
      if (attachment) await Promise.allSettled([attachment])
    }
  }
}
