import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { chromium } from 'playwright'
import { validateManifest, validateBaselines, identity } from './manifest.mjs'
import { compare, report, verifyDiagnostics } from './comparison.mjs'
import { capture, serve } from './capture.mjs'
import { selfTest } from './self-test.mjs'

const mode = process.argv[2]
if (!['check', 'update', 'test'].includes(mode) || process.platform !== 'linux' || process.arch !== 'arm64' || !process.env.VISUAL_IMAGE) throw new Error('Use the root storybook:visual commands to run in the pinned Linux container')
// Overrides are used only by disposable child-command regression probes.
const output = process.env.VISUAL_OUTPUT ?? '/output'
const baselineRoot = process.env.VISUAL_BASELINES ?? '/baselines'
if (output !== '/output' && !/^\/output\/self-test\/[a-z-]+$/.test(output)) throw new Error('invalid probe output')
if (!['/baselines', '/work/visual-probe-baselines'].includes(baselineRoot)) throw new Error('invalid probe baselines')
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
let browser
let server
try {
  await rm(output, { recursive: true, force: true }).catch(error => { if (error.code !== 'EBUSY') throw error })
  await mkdir(output, { recursive: true })
  const entries = validateManifest(await json('storybook/visual-manifest.json'), {
    pages: await json('storybook-static/pages/index.json'), components: await json('storybook-static/components/index.json'),
  })
  const obsolete = validateBaselines(entries, await baselineFiles(), mode === 'test' ? 'check' : mode)
  console.log(`Obsolete baselines: ${obsolete.join(', ') || 'none'}`)
  server = await serve('storybook-static')
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu', '--force-color-profile=srgb'] })
  await save(join(output, 'environment.json'), JSON.stringify({ image: process.env.VISUAL_IMAGE, chromium: browser.version(), scale: 1, locale: 'en-US', timezone: 'UTC', time: '2026-01-02T09:30:00.000Z' }, null, 2))
  const pending = []
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
      const { bytes: current, diagnostics } = await capture(browser, server.url, entry)
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
    } catch (error) {
      result.error = error.message
    }
  }
  if (results.some(result => result.error || (mode !== 'update' && !result.matches))) throw new Error('Visual check failed. Review artifacts/storybook-visual/index.html')
  // Do not replace any baselines if another selected story failed readiness or diagnostics.
  for (const [path, bytes] of pending) await save(path, bytes)
  if (mode === 'test') await selfTest({ browser, url: server.url, entries, output, save })
  console.log(`Visual ${mode}: ${entries.length} cases passed`)
} catch (error) {
  results.push({ id: 'run', error: error.message, images: [] })
  console.error(error.message)
  process.exitCode = 1
} finally {
  await save(join(output, 'index.html'), report(results))
  await save(join(output, 'results.json'), JSON.stringify(results, null, 2))
  await browser?.close()
  await server?.close()
}
