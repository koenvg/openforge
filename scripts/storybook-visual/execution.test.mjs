import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { identity } from './manifest.mjs'
import { parseVisualCommand, resolveShard, planExecution, createEvidence, executePhases } from './execution.mjs'
import { resolveVisualInputs } from './inputs.mjs'

const manifest = JSON.parse(await readFile(new URL('../../storybook/visual-manifest.json', import.meta.url), 'utf8'))
function inventory(entries = manifest) {
  const indexes = { pages: { entries: {} }, components: { entries: {} } }
  for (const entry of entries) indexes[entry.catalog].entries[entry.story] = { type: 'story' }
  return { manifest: entries, indexes, baselineFiles: entries.map(entry => identity(entry) + '.png') }
}
const shardEnv = (index, count) => ({ VISUAL_SHARD_INDEX: String(index), VISUAL_SHARD_COUNT: String(count) })

it('accepts explicit one-based shard flags and rejects malformed or ambiguous public requests', () => {
  expect(parseVisualCommand(['shard', '--shard-count', '4', '--shard-index', '2'])).toEqual({ mode: 'shard', shard: { index: 2, count: 4 }, env: shardEnv(2, 4) })
  for (const args of [[], ['unknown'], ['shard'], ['shard', '--shard-index', '1'], ['shard', '--shard-index', '1', '--shard-count', '2', '--shard-index', '1'], ['probes', '--shard-index', '1'], ['test', 'extra'], ['shard', '--other', '2']]) {
    expect(() => parseVisualCommand(args)).toThrow()
  }
  for (const value of ['', '0', '-1', '1.5', '1e1', ' 1', '01', 'NaN', 'Infinity', '9007199254740992', undefined]) {
    expect(() => resolveShard('shard', { ...shardEnv(1, 4), VISUAL_SHARD_INDEX: value })).toThrow()
    expect(() => resolveShard('shard', { ...shardEnv(1, 4), VISUAL_SHARD_COUNT: value })).toThrow()
  }
  expect(() => resolveShard('shard', shardEnv(5, 4))).toThrow('exceed count')
  for (const mode of ['check', 'update', 'test', 'probes']) expect(() => resolveShard(mode, shardEnv(1, 4))).toThrow('require shard mode')
})

it('keeps internal probe overrides separate from shard and standalone probe commands', () => {
  const probe = { VISUAL_OUTPUT: '/output/self-test/restored', VISUAL_BASELINES: '/work/visual-probe/baselines', VISUAL_MANIFEST: '/work/visual-probe/manifest.json' }
  expect(() => resolveShard('shard', { ...shardEnv(1, 4), ...probe })).toThrow('internal probe overrides')
  for (const mode of ['shard', 'probes']) expect(() => resolveVisualInputs(mode, probe)).toThrow('invalid probe inputs')
})

it('partitions sorted identities with a complete duplicate-free union even after catalog growth', () => {
  for (const entries of [manifest, [...manifest, { ...manifest[0], story: 'new-catalog-story' }]]) {
    for (const count of [1, 2, 4, 7]) {
      const plans = Array.from({ length: count }, (_, index) => planExecution({ mode: 'shard', env: shardEnv(index + 1, count), ...inventory(entries) }))
      const ids = plans.flatMap(plan => plan.assignedIdentities)
      expect(ids.toSorted()).toEqual(entries.map(identity).toSorted())
      expect(new Set(ids).size).toBe(entries.length)
      for (const [index, plan] of plans.entries()) {
        expect(plan.assignedIdentities).toEqual(planExecution({ mode: 'shard', env: shardEnv(index + 1, count), ...inventory([...entries].reverse()) }).assignedIdentities)
        expect(plan.phases).toEqual(['baseline', 'repeatability'])
      }
    }
  }
  const three = ['c', 'a', 'b'].map(story => ({ ...manifest[0], story }))
  const plan = planExecution({ mode: 'shard', env: shardEnv(1, 2), ...inventory(three) })
  expect(plan.entries.map(entry => entry.story)).toEqual(['a', 'c'])
  expect(() => planExecution({ mode: 'shard', env: shardEnv(1, 4), ...inventory(three) })).toThrow('empty shards')
})

it.each(['shard', 'probes'])('%s validates invalid inventory outside its assignment', mode => {
  const options = { mode, env: mode === 'shard' ? shardEnv(1, 4) : {} }
  const plan = planExecution({ ...options, ...inventory() })
  const outside = manifest.find(entry => !plan.assignedIdentities.includes(identity(entry)))
  const id = identity(outside)
  const missing = inventory()
  missing.baselineFiles = missing.baselineFiles.filter(file => file !== `${id}.png`)
  expect(() => planExecution({ ...options, ...missing })).toThrow('missing baseline')
  for (const [file, message] of [['components/obsolete.png', 'obsolete baselines'], ['unexpected.txt', 'unexpected baseline files']]) {
    const invalid = inventory()
    invalid.baselineFiles.push(file)
    expect(() => planExecution({ ...options, ...invalid })).toThrow(message)
  }
  const noStory = inventory()
  delete noStory.indexes[outside.catalog].entries[outside.story]
  expect(() => planExecution({ ...options, ...noStory })).toThrow('missing story')
  expect(() => planExecution({ ...options, ...inventory([...manifest, outside]) })).toThrow('duplicate identity')
})

it('binds evidence to revision and exact manifest bytes', () => {
  const revision = 'a'.repeat(40)
  const evidence = createEvidence({ mode: 'probes', revision, dirty: true, manifestBytes: '[]' })
  expect(evidence).toMatchObject({ revision, dirty: true, status: 'incomplete', manifestDigest: '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945' })
  expect(createEvidence({ mode: 'probes', revision, manifestBytes: '[ ]' }).manifestDigest).not.toBe(evidence.manifestDigest)
  expect(() => createEvidence({ mode: 'test', manifestBytes: '[]' })).toThrow('revision')
})

it.each(['test', 'shard', 'probes', 'check', 'update'])('%s executes only its required phases, once, and records completions', async mode => {
  const plan = planExecution({ mode, env: mode === 'shard' ? shardEnv(1, 4) : {}, ...inventory() })
  const expected = {
    test: ['baseline', 'repeatability', 'terminal-readiness', 'cursor-stability', 'readiness-diagnostics', 'capture-stability', 'runner-probes'],
    shard: ['baseline', 'repeatability'],
    probes: ['terminal-readiness', 'cursor-stability', 'readiness-diagnostics', 'capture-stability', 'runner-probes'],
    check: ['baseline'], update: ['baseline'],
  }[mode]
  const calls = []
  const evidence = { phases: [] }
  const handlers = Object.fromEntries(expected.map(phase => [phase, completed => { calls.push(phase); if (phase === 'baseline' || phase === 'repeatability') plan.assignedIdentities.forEach(completed) }]))
  await executePhases(plan, handlers, { evidence, timings: { measure: (_, work) => work() } })
  expect(calls).toEqual(expected)
  expect(evidence.phases.map(record => record.status)).toEqual(expected.map(() => 'passed'))
  for (const phase of evidence.phases.filter(record => ['baseline', 'repeatability'].includes(record.phase))) expect(phase.completedIdentities).toEqual(plan.assignedIdentities)
  if (mode === 'probes') expect(plan.entries).toEqual([])
})

it('retains failed phase evidence and attempts remaining independent phases', async () => {
  const evidence = { phases: [] }
  await expect(executePhases({ phases: ['baseline', 'repeatability'] }, {
    baseline: completed => { completed('first'); throw new Error('pixel mismatch') },
    repeatability: completed => completed('first'),
  }, { evidence, timings: { measure: (_, work) => work() } })).rejects.toThrow('Visual phases failed')
  expect(evidence.phases).toEqual([
    { phase: 'baseline', status: 'failed', completedIdentities: ['first'], error: 'pixel mismatch' },
    { phase: 'repeatability', status: 'passed', completedIdentities: ['first'] },
  ])
})
