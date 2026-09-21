import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { chromium } from 'playwright'
import { identity } from './manifest.mjs'
import { resolveShard, planExecution, createEvidence, executePhases } from './execution.mjs'
import { verifyRepeatFromInitial } from './repetition.mjs'
import { compare, report, verifyDiagnostics } from './comparison.mjs'
import { capture, serve } from './capture.mjs'
import { regressionPhases } from './self-test.mjs'
import { createTimings } from './timings.mjs'
import { resolveVisualInputs } from './inputs.mjs'

const mode = process.argv[2]
if (process.argv.length !== 3 || process.platform !== 'linux' || process.arch !== 'arm64' || !process.env.VISUAL_IMAGE) throw new Error('Use the root storybook:visual commands to run in the pinned Linux container')
resolveShard(mode, process.env)
const { output, baselineRoot, manifestPath } = resolveVisualInputs(mode, process.env)
const manifestBytes = await readFile(manifestPath)
const evidence = createEvidence({ mode, revision: process.env.VISUAL_REVISION, dirty: process.env.VISUAL_DIRTY === 'true', manifestBytes })
const json = async path => JSON.parse(await readFile(path, 'utf8'))
async function files(root) {
  return (await readdir(root, { withFileTypes: true })).map(entry => entry.name)
}
async function baselineFiles() {
  const result = []
  for (const entry of await readdir(baselineRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && ['pages', 'components'].includes(entry.name)) {
      for (const name of await files(join(baselineRoot, entry.name))) result.push(`${entry.name}/${name}`)
    } else result.push(entry.name)
  }
  return result
}
const save = async (path, bytes) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes) }
const results = []
const timings = createTimings({ output })
let browser
let server
try {
  await rm(output, { recursive: true, force: true }).catch(error => { if (error.code !== 'EBUSY') throw error })
  await mkdir(output, { recursive: true })
  const plan = await timings.measure('validation', async () => planExecution({
    mode, env: process.env, manifest: JSON.parse(manifestBytes),
    indexes: { pages: await json('storybook-static/pages/index.json'), components: await json('storybook-static/components/index.json') },
    baselineFiles: await baselineFiles(),
  }))
  const { entries } = plan
  console.log(`Obsolete baselines: ${plan.obsolete.join(', ') || 'none'}`)
  evidence.assignment = { shard: plan.shard, identities: plan.assignedIdentities }
  evidence.expectedIdentities = plan.expectedIdentities
  evidence.expectedPhases = plan.phases
  server = await serve('storybook-static')
  // Partial tile repainting can vary rounded-border pixels across identical contexts.
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu', '--disable-partial-raster', '--force-color-profile=srgb'] })
  evidence.environment = { image: process.env.VISUAL_IMAGE, chromium: browser.version(), platform: process.platform, arch: process.arch, scale: 1, locale: 'en-US', timezone: 'UTC', time: '2026-01-02T09:30:00.000Z' }
  await save(join(output, 'environment.json'), JSON.stringify(evidence.environment, null, 2))
  const pending = []
  const baseline = async completed => {
    for (const entry of entries) {
      const id = identity(entry)
      const result = { id, images: [] }
      results.push(result)
      try {
        const baselinePath = join(baselineRoot, id + '.png')
        const baseline = await readFile(baselinePath).catch(error => {
          if (mode === 'update' && error.code === 'ENOENT') return undefined
          throw error
        })
        if (baseline) {
          await save(join(output, id, 'baseline.png'), baseline)
          result.images.push('baseline')
        }
        const { bytes: current, diagnostics } = await capture(browser, server.url, entry, { timings, phase: 'baseline' })
        await save(join(output, id, 'current.png'), current)
        result.images.push('current')
        if (baseline) {
          const comparison = compare(baseline, current, entry.tolerance)
          await save(join(output, id, 'difference.png'), comparison.difference)
          result.images.push('difference')
          result.pixels = comparison.pixels
          result.matches = comparison.matches
          result.tolerance = entry.tolerance
        } else result.added = true
        verifyDiagnostics(diagnostics, entry.expectedErrors)
        if (mode === 'update') pending.push([baselinePath, current])
        if (mode === 'update' || result.matches) completed(id)
      } catch (error) {
        result.error = error.message
      }
    }
    if (results.some(result => result.error || (mode !== 'update' && !result.matches))) throw new Error('Visual check failed. Review index.html')
    // Never replace baselines if any selected story failed readiness or diagnostics.
    for (const [path, bytes] of pending) await save(path, bytes)
  }
  const repeatability = async completed => {
    const failures = []
    for (const entry of entries) {
      try {
        await verifyRepeatFromInitial(entry, output, () => capture(browser, server.url, entry, { timings, phase: 'repeatability' }))
        completed(identity(entry))
      } catch (error) {
        failures.push(error.message)
        results.push({ id: `${identity(entry)}/repeatability`, error: error.message, images: [] })
      }
    }
    if (failures.length) throw new Error(failures.join('\n'))
  }
  await executePhases(plan, {
    baseline, repeatability,
    ...regressionPhases({ browser, url: server.url, entries: plan.allEntries, output, timings }),
  }, { evidence, timings })
  evidence.status = 'passed'
  console.log(`Visual ${mode}: ${entries.length} cases passed; phases: ${plan.phases.join(', ')}`)
} catch (error) {
  evidence.status = 'failed'
  evidence.error = error.message
  results.push({ id: 'run', error: error.message, images: [] })
  console.error(error.message)
  process.exitCode = 1
} finally {
  // Attempt every artifact and teardown even if an earlier finalizer fails.
  for (const finalize of [
    () => save(join(output, 'index.html'), report(results)),
    () => save(join(output, 'results.json'), JSON.stringify(results, null, 2)),
    () => browser?.close(),
    () => server?.close(),
    () => timings.finish(process.exitCode ? 'failed' : 'passed'),
  ]) {
    try { await finalize() } catch (error) {
      console.error(error.message)
      process.exitCode = 1
    }
  }
  evidence.status = process.exitCode ? 'failed' : evidence.status
  await save(join(output, 'evidence.json'), JSON.stringify(evidence, null, 2))
}
