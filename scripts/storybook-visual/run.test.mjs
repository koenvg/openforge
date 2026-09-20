import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PNG } from 'pngjs'
import { identity } from './manifest.mjs'

// Run the command against a disposable filesystem with deterministic browser I/O.
// Real validation, comparisons, repeatability and report writing stay in the path.
const state = vi.hoisted(() => ({ root: '', bytes: null, captures: [], probes: [], failBaseline: false }))
vi.mock('node:fs/promises', async importOriginal => {
  const fs = await importOriginal()
  const mapped = path => typeof path === 'string' && !path.startsWith(state.root) ? join(state.root, path) : path
  return { ...fs, ...Object.fromEntries(['readFile', 'writeFile', 'mkdir', 'readdir', 'rm'].map(name => [name, (path, ...args) => fs[name](mapped(path), ...args)])) }
})
vi.mock('playwright', () => ({ chromium: { launch: async () => ({ version: () => 'pinned-test-browser', close: async () => {} }) } }))
vi.mock('./capture.mjs', () => ({
  serve: async () => ({ url: 'http://fixture', close: async () => {} }),
  capture: async (_browser, _url, entry, { phase }) => {
    state.captures.push({ story: entry.story, phase })
    return { bytes: state.bytes, diagnostics: state.failBaseline && phase === 'baseline' ? ['unexpected diagnostic'] : [] }
  },
}))
vi.mock('./self-test.mjs', () => ({ regressionPhases: () => Object.fromEntries(
  ['terminal-readiness', 'cursor-stability', 'readiness-diagnostics', 'capture-stability', 'runner-probes'].map(phase => [phase, async () => { state.probes.push(phase) }]),
) }))

const original = { platform: process.platform, arch: process.arch, argv: process.argv, exitCode: process.exitCode }
const entries = ['c', 'a', 'b'].map(story => ({ catalog: 'components', story, theme: 'openforge-light', viewport: { width: 100, height: 100 }, ready: '#ready', expectedErrors: [] }))
const json = async path => JSON.parse(await readFile(join(state.root, path), 'utf8'))
beforeEach(async () => {
  vi.resetModules()
  state.root = await mkdtemp(join(tmpdir(), 'visual-run-'))
  state.captures = []; state.probes = []; state.failBaseline = false
  const png = new PNG({ width: 100, height: 100 })
  png.data.fill(255)
  state.bytes = PNG.sync.write(png)
  for (const directory of ['storybook', 'storybook-static/pages', 'storybook-static/components', 'baselines/components']) await mkdir(join(state.root, directory), { recursive: true })
  await writeFile(join(state.root, 'storybook/visual-manifest.json'), JSON.stringify(entries))
  await writeFile(join(state.root, 'storybook-static/pages/index.json'), JSON.stringify({ entries: {} }))
  await writeFile(join(state.root, 'storybook-static/components/index.json'), JSON.stringify({ entries: Object.fromEntries(entries.map(entry => [entry.story, { type: 'story' }])) }))
  for (const entry of entries) await writeFile(join(state.root, 'baselines', identity(entry) + '.png'), state.bytes)
  for (const [key, value] of Object.entries({ platform: 'linux', arch: 'arm64' })) Object.defineProperty(process, key, { value, configurable: true })
  for (const key of ['VISUAL_SHARD_INDEX', 'VISUAL_SHARD_COUNT', 'VISUAL_OUTPUT', 'VISUAL_BASELINES', 'VISUAL_MANIFEST']) vi.stubEnv(key, undefined)
  vi.stubEnv('VISUAL_IMAGE', 'pinned-image')
  vi.stubEnv('VISUAL_REVISION', 'a'.repeat(40))
  vi.stubEnv('VISUAL_DIRTY', 'true')
  process.exitCode = undefined
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(async () => {
  Object.defineProperty(process, 'platform', { value: original.platform, configurable: true })
  Object.defineProperty(process, 'arch', { value: original.arch, configurable: true })
  process.argv = original.argv
  process.exitCode = original.exitCode
  vi.unstubAllEnvs(); vi.restoreAllMocks()
  await rm(state.root, { recursive: true, force: true })
})
async function run(mode) {
  process.argv = ['node', 'run.mjs', mode]
  if (mode === 'shard') { vi.stubEnv('VISUAL_SHARD_INDEX', '1'); vi.stubEnv('VISUAL_SHARD_COUNT', '2') }
  await import('./run.mjs')
  return json('output/evidence.json')
}

it('captures only assigned cases twice and binds the report to assignment and environment', async () => {
  const report = await run('shard')
  expect(state.captures).toEqual([
    { story: 'a', phase: 'baseline' }, { story: 'c', phase: 'baseline' },
    { story: 'a', phase: 'repeatability' }, { story: 'c', phase: 'repeatability' },
  ])
  expect(state.probes).toEqual([])
  expect(report).toMatchObject({ status: 'passed', revision: 'a'.repeat(40), dirty: true, environment: { image: 'pinned-image', chromium: 'pinned-test-browser', arch: 'arm64' }, assignment: { shard: { index: 1, count: 2 } }, expectedPhases: ['baseline', 'repeatability'] })
  expect(report.expectedIdentities).toHaveLength(3)
  expect(report.assignment.identities).toEqual([identity(entries[1]), identity(entries[0])])
  for (const phase of report.phases) expect(phase.completedIdentities).toEqual(report.assignment.identities)
})

it.each(['shard', 'probes'])('%s rejects invalid inventory before any browser work', async mode => {
  await rm(join(state.root, 'baselines', identity(entries[2]) + '.png'))
  const report = await run(mode)
  expect(process.exitCode).toBe(1)
  expect(report).toMatchObject({ status: 'failed', phases: [] })
  expect(report.error).toContain('missing baseline')
  expect(state.captures).toEqual([])
  expect(state.probes).toEqual([])
})

it('runs standalone probes once without baseline or repeatability captures', async () => {
  const report = await run('probes')
  expect(state.captures).toEqual([])
  expect(state.probes).toEqual(['terminal-readiness', 'cursor-stability', 'readiness-diagnostics', 'capture-stability', 'runner-probes'])
  expect(report.phases.map(phase => phase.phase)).toEqual(state.probes)
  expect(report.assignment.identities).toEqual([])
  expect(report.status).toBe('passed')
})

it('retains every phase and both full passes in the existing test command', async () => {
  const report = await run('test')
  expect(state.captures.filter(capture => capture.phase === 'baseline').map(capture => capture.story)).toEqual(['a', 'b', 'c'])
  expect(state.captures.filter(capture => capture.phase === 'repeatability').map(capture => capture.story)).toEqual(['a', 'b', 'c'])
  expect(state.probes).toHaveLength(5)
  expect(report.phases).toHaveLength(7)
  expect(report.status).toBe('passed')
})

it('keeps failed baseline diagnostics and still takes independent repeats', async () => {
  state.failBaseline = true
  const report = await run('shard')
  expect(process.exitCode).toBe(1)
  expect(report.status).toBe('failed')
  expect(report.phases.map(phase => phase.status)).toEqual(['failed', 'passed'])
  expect(state.captures).toHaveLength(4)
  expect((await json('output/results.json'))[0].error).toContain('unexpected diagnostic')
})
