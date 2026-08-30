#!/usr/bin/env node
import { fileURLToPath } from 'node:url'
import { parseDesktopTestOptions } from './desktop-test/cli-options.mjs'
import { createDesktopTestLifecycle } from './desktop-test/lifecycle.mjs'

export const parseDesktopTestAppOptions = parseDesktopTestOptions

function installSignalHandlers(lifecycle, target) {
  const handlers = new Map([
    ['SIGINT', () => void lifecycle.shutdown().finally(() => target.exit(130))],
    ['SIGTERM', () => void lifecycle.shutdown().finally(() => target.exit(143))],
  ])
  for (const [signal, handler] of handlers) target.once(signal, handler)
  return () => {
    for (const [signal, handler] of handlers) target.off(signal, handler)
  }
}

export async function runDesktopTestApp(options = {}, dependencies = {}) {
  const createLifecycle = dependencies.createLifecycle ?? createDesktopTestLifecycle
  const log = dependencies.log ?? console.log
  const target = dependencies.process ?? process
  const lifecycle = createLifecycle({ ...options, connectPlaywright: false })
  const removeSignalHandlers = installSignalHandlers(lifecycle, target)
  try {
    const context = await lifecycle.start()
    log(`Desktop test repository: ${context.fixture.repository.repoPath}`)
    log(`Isolated run root: ${context.paths.runRoot}`)
    log(`Artifacts: ${context.paths.artifactRoot}`)
    log('The test app is ready. Close the Electron window to stop it.')
    await context.launcher.waitForExit()
  } finally {
    removeSignalHandlers()
    await lifecycle.shutdown()
  }
}

export async function main(argv = process.argv.slice(2)) {
  await runDesktopTestApp(parseDesktopTestAppOptions(argv))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error)
    process.exitCode = 1
  })
}
