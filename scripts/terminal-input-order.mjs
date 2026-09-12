#!/usr/bin/env node
// Isolated live regression. Requires Python 3 and the desktop-test build prerequisites.
import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createDesktopAppDriver } from './desktop-test/driver.mjs'
import { createDesktopTestLifecycle } from './desktop-test/lifecycle.mjs'

const trials = [...Array(100).fill(0), ...Array(10).fill(50)]
const expected = 'after4'.repeat(trials.length)
const lifecycle = createDesktopTestLifecycle({
  outputDir: process.argv[2],
  playwrightElectron: true,
  requireSidecarReadiness: true,
  timeoutMs: 120_000,
})

async function waitFor(check, message) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(message)
}

try {
  await lifecycle.runScenario(async context => {
    const { page, electronApplication: app } = context
    const driver = createDesktopAppDriver(page, { terminalProbe: 'performance', timeoutMs: 30_000 })
    await driver.verifyDesktopBridge()
    const { region, terminalKey } = await driver.openSeededTerminal(context.fixture.manifest)
    const artifactDir = await mkdtemp(join(context.paths.artifactRoot, 'input-order-'))
    const receivedPath = join(artifactDir, 'received.bin')
    const readyPath = join(artifactDir, 'ready')
    const readerPath = join(artifactDir, 'reader.py')
    await writeFile(readerPath, `import os, termios, tty
original = termios.tcgetattr(0)
try:
    tty.setraw(0)
    with open(${JSON.stringify(receivedPath)}, 'wb', buffering=0) as capture:
        open(${JSON.stringify(readyPath)}, 'w').close()
        remaining = ${expected.length}
        while remaining:
            data = os.read(0, remaining)
            if not data:
                raise RuntimeError('unexpected EOF')
            capture.write(data)
            os.write(1, data)
            remaining -= len(data)
finally:
    termios.tcsetattr(0, termios.TCSANOW, original)
`)
    await driver.typeTerminalCommand(region, `python3 -u '${readerPath.replaceAll("'", "'\\''")}'`)
    await waitFor(() => access(readyPath).then(() => true, () => false), 'Raw PTY reader did not start')

    // Capture only synthetic input, in this owned app, after the raw reader is ready.
    await app.evaluate((_electron, key) => {
      const original = globalThis.fetch
      globalThis.inputOrderTrace = []
      globalThis.fetch = function (url, init) {
        if (String(url).endsWith('/app/invoke') && typeof init?.body === 'string') {
          const request = JSON.parse(init.body)
          if (request.command === 'pty_write' && request.payload.shellSessionKey === key) {
            globalThis.inputOrderTrace.push(request.payload.data)
          }
        }
        return original.apply(this, arguments)
      }
    }, terminalKey)
    await page.evaluate(() => {
      window.inputOrderKeys = []
      document.addEventListener('keydown', event => {
        if (event.key.length === 1) window.inputOrderKeys.push(event.key)
      }, true)
    })
    for (const delay of trials) {
      await page.keyboard.type('after4', { delay })
      await page.waitForTimeout(30)
    }
    const complete = await waitFor(
      () => stat(receivedPath).then(info => info.size >= expected.length, () => false),
      'Timed out receiving terminal input',
    ).then(() => true, () => false)
    const received = await readFile(receivedPath, 'utf8')
    const fetchInput = await app.evaluate(() => globalThis.inputOrderTrace.join(''))
    const rendererInput = await page.evaluate(() => window.inputOrderKeys.join(''))
    const report = {
      terminalKey, trials, expected, rendererInput, fetchInput, received, complete,
      wrongTrials: trials.flatMap((delay, index) => {
        const actual = received.slice(index * 6, index * 6 + 6)
        return actual === 'after4' ? [] : [{ trial: index + 1, delay, actual }]
      }),
    }
    await writeFile(join(artifactDir, 'trace.json'), JSON.stringify(report, null, 2))
    await page.screenshot({ path: join(artifactDir, 'terminal.png') })
    console.log(JSON.stringify({ artifactDir, bytes: received.length, wrongTrials: report.wrongTrials }))
    assert.equal(rendererInput, expected, 'Renderer key order changed')
    assert.equal(fetchInput, expected, 'Electron request initiation order changed')
    assert.equal(received, expected, 'PTY input order changed')
    assert.equal(complete, true, 'Not all PTY bytes arrived')
  })
} catch (error) {
  console.error(error)
  process.exitCode = 1
}
