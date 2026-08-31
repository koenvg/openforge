#!/usr/bin/env node
import { fileURLToPath } from 'node:url'
import { invariantScenarioDefinitions } from './desktop-test/invariant-scenarios.mjs'
import { parseInvariantOptions, runInvariantSuite } from './desktop-test/invariant-runner.mjs'

export const INVARIANT_HELP = `OpenForge live Electron invariant harness

Usage:
  pnpm e2e:invariants -- [options]
  pnpm e2e:dev -- [options]

Reuse handshake:
  OPENFORGE_CHROMIUM_DEBUG_PORT=<port> pnpm electron:dev
  OPENFORGE_CHROMIUM_DEBUG_PORT=<port> OPENFORGE_E2E=1 pnpm electron:dev
  pnpm e2e:invariants -- --reuse http://127.0.0.1:<port> [options]

Options:
  --scenario <first-attachment|detach-during-recovery|idle-resources>
                              Select one or more scenarios (canonical serial order).
  --reuse <http://loopback:port>
                              Observe an explicitly remote-debuggable development app.
  --allow-terminal-control    Permit terminal race controls in reuse mode.
  --retain                    Retain isolated temporary runtime data after cleanup.
  --startup-timeout <ms>      Override application readiness timeout.
  --scenario-timeout <ms>     Override each scenario timeout.
  --idle-duration <seconds>   Override idle sampling duration.
  --output <directory>        Write the report and artifacts to this directory.
  --dev                       Run the headed development command with retained runtime data.
  --help                      Show this help.

Reuse is observational by default. Terminal scenarios require both
--allow-terminal-control and renderer E2E controls from the matching launch token.
The reuse endpoint must use HTTP on a loopback address.
`

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const log = dependencies.log ?? console.log
  if (argv.includes('--help') || argv.includes('-h')) {
    log(INVARIANT_HELP)
    return { status: 'help', scenarioResults: [] }
  }
  const options = parseInvariantOptions(argv)
  if (options.devMode) options.retainRuntime = true
  const result = await runInvariantSuite(options, {
    scenarios: invariantScenarioDefinitions,
    ...dependencies,
  })
  log(`OpenForge invariant suite ${result.status}: ${result.scenarioResults.length} scenario(s) recorded`)
  if (result.status !== 'passed') process.exitCode = 1
  return result
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
