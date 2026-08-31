#!/usr/bin/env node
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_IDLE_OPTIONS,
  EventRateCounter,
  collectEventEvidence,
  collectVmmapFootprint,
  discoverIdleProcessSet,
  evaluateIdleSample,
  fetchProcessMemoryDiagnostics,
  idleProcessRole,
  parseCpuTime,
  parseFootprintBytes,
  parseIdleOptions,
  parseProcessRows,
  parseVmmapSummary,
  readProcessRows,
  readSidecarConnection,
  sampleIdleResources,
} from './desktop-test/idle-resource-sampler.mjs'

export {
  DEFAULT_IDLE_OPTIONS,
  EventRateCounter,
  collectEventEvidence,
  collectVmmapFootprint,
  discoverIdleProcessSet,
  evaluateIdleSample,
  fetchProcessMemoryDiagnostics,
  idleProcessRole,
  parseCpuTime,
  parseFootprintBytes,
  parseIdleOptions,
  parseProcessRows,
  parseVmmapSummary,
  readProcessRows,
  readSidecarConnection,
  sampleIdleResources,
}

async function run() {
  if (process.platform !== 'darwin') throw new Error('This check currently requires macOS ps and vmmap')
  const result = await sampleIdleResources(parseIdleOptions(process.argv.slice(2)))
  console.log(JSON.stringify(result, null, 2))
  if (!result.passed) process.exitCode = 1
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  run().catch(error => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
