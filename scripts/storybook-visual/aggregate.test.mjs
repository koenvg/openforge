import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { probePhases } from './execution.mjs'

const roots = []
const revision = 'a'.repeat(40)
const manifestDigest = 'b'.repeat(64)
const identities = ['case-a', 'case-b', 'case-c', 'case-d']
const environment = {
  image: 'pinned-image', chromium: 'pinned-browser', platform: 'linux', arch: 'arm64',
  scale: 1, locale: 'en-US', timezone: 'UTC', time: '2026-01-02T09:30:00.000Z',
}

afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })))

function evidence(mode, index) {
  const phases = mode === 'shard' ? ['baseline', 'repeatability'] : probePhases
  const assigned = mode === 'shard' ? [identities[index - 1]] : []
  return {
    schemaVersion: 1,
    mode,
    revision,
    dirty: false,
    manifestDigest,
    status: 'passed',
    environment,
    assignment: { shard: mode === 'shard' ? { index, count: 4 } : null, identities: assigned },
    expectedIdentities: identities,
    expectedPhases: phases,
    phases: phases.map(phase => ({ phase, status: 'passed', completedIdentities: mode === 'shard' ? assigned : [] })),
  }
}

function run(change = () => {}, rawNeeds) {
  const root = mkdtempSync(join(tmpdir(), 'visual-aggregate-'))
  roots.push(root)
  const input = join(root, 'input')
  const output = join(root, 'output')
  const reports = {
    'shard-1': evidence('shard', 1),
    'shard-2': evidence('shard', 2),
    'shard-3': evidence('shard', 3),
    'shard-4': evidence('shard', 4),
    probes: evidence('probes'),
  }
  const needs = { 'catalog-coverage': { result: 'success' }, 'visual-shards': { result: 'success' }, 'visual-probes': { result: 'success' } }
  change(reports, needs)
  for (const [name, report] of Object.entries(reports)) {
    mkdirSync(join(input, name), { recursive: true })
    writeFileSync(join(input, name, 'evidence.json'), JSON.stringify(report))
  }
  const result = spawnSync(process.execPath, ['scripts/storybook-visual/aggregate.mjs', input, output], {
    encoding: 'utf8',
    env: { ...process.env, VISUAL_NEEDS: rawNeeds ?? JSON.stringify(needs) },
  })
  return { ...result, output }
}

it('accepts exactly one compatible successful pair per expected identity and every probe', () => {
  const result = run()
  expect(result.status, result.stderr).toBe(0)
  const summary = JSON.parse(readFileSync(join(result.output, 'summary.json'), 'utf8'))
  expect(summary).toMatchObject({ status: 'passed', revision, manifestDigest, shardCount: 4, expectedCaseCount: 4, completedPairCount: 4 })
  expect(summary.probes).toEqual(probePhases)
})

it.each(['failure', 'cancelled', 'skipped', undefined])('rejects %s shard job metadata even when artifacts look successful', state => {
  const result = run((_reports, needs) => { needs['visual-shards'].result = state })
  expect(result.status).toBe(1)
  expect(readFileSync(join(result.output, 'summary.md'), 'utf8')).toContain(`visual-shards result is ${state ?? 'missing'}`)
})

it.each(['failure', 'cancelled', 'skipped', undefined])('rejects %s coverage job metadata even when visuals pass', state => {
  const result = run((_reports, needs) => { needs['catalog-coverage'].result = state })
  expect(result.status).toBe(1)
  expect(readFileSync(join(result.output, 'summary.md'), 'utf8')).toContain(`catalog-coverage result is ${state ?? 'missing'}`)
})

it.each(['failure', 'cancelled', 'skipped', undefined])('rejects %s probe job metadata even when artifacts look successful', state => {
  const result = run((_reports, needs) => { needs['visual-probes'].result = state })
  expect(result.status).toBe(1)
  expect(readFileSync(join(result.output, 'summary.md'), 'utf8')).toContain(`visual-probes result is ${state ?? 'missing'}`)
})

it('rejects a missing shard report with its index in the diagnostic', () => {
  const result = run(reports => { delete reports['shard-3'] })
  expect(result.status).toBe(1)
  expect(readFileSync(join(result.output, 'summary.md'), 'utf8')).toContain('missing shard 3/4 evidence')
})

it('rejects failed evidence and incomplete case pairs', () => {
  const result = run(reports => {
    reports['shard-2'].status = 'failed'
    reports['shard-2'].phases[0].status = 'failed'
    reports['shard-2'].phases[0].completedIdentities = []
  })
  expect(result.status).toBe(1)
  const diagnostic = readFileSync(join(result.output, 'summary.md'), 'utf8')
  expect(diagnostic).toContain('shard 2/4 status is failed')
  expect(diagnostic).toContain('case-b baseline completed 0 times; expected exactly once')
})

it('rejects duplicate case completion and duplicate assignment', () => {
  const result = run(reports => {
    reports['shard-2'].assignment.identities = ['case-a', 'case-b']
    for (const phase of reports['shard-2'].phases) phase.completedIdentities = ['case-a', 'case-b']
  })
  expect(result.status).toBe(1)
  const diagnostic = readFileSync(join(result.output, 'summary.md'), 'utf8')
  expect(diagnostic).toContain('case-a is assigned 2 times; expected exactly once')
  expect(diagnostic).toContain('case-a baseline completed 2 times; expected exactly once')
})

it.each([
  ['revision', 'c'.repeat(40), 'mixed revision'],
  ['manifestDigest', 'd'.repeat(64), 'mixed manifest digest'],
  ['environment', { ...environment, chromium: 'other-browser' }, 'incompatible environment'],
  ['expectedIdentities', [...identities].reverse(), 'incompatible expected identities'],
])('rejects incompatible %s evidence', (field, value, message) => {
  const result = run(reports => { reports['shard-4'][field] = value })
  expect(result.status).toBe(1)
  expect(readFileSync(join(result.output, 'summary.md'), 'utf8')).toContain(message)
})

it('rejects missing, failed, repeated, or unexpected probe outcomes', () => {
  const result = run(reports => {
    reports.probes.expectedPhases = [...probePhases, 'unexpected-probe']
    reports.probes.phases = [
      ...reports.probes.phases.filter(record => record.phase !== 'cursor-stability'),
      { phase: 'terminal-readiness', status: 'passed', completedIdentities: [] },
      { phase: 'capture-stability', status: 'failed', completedIdentities: [] },
      { phase: 'unexpected-probe', status: 'passed', completedIdentities: [] },
    ]
  })
  expect(result.status).toBe(1)
  const diagnostic = readFileSync(join(result.output, 'summary.md'), 'utf8')
  expect(diagnostic).toContain('cursor-stability completed 0 times; expected exactly once')
  expect(diagnostic).toContain('terminal-readiness completed 2 times; expected exactly once')
  expect(diagnostic).toContain('capture-stability has failed evidence')
  expect(diagnostic).toContain('unexpected probe unexpected-probe')
})

it.each(['{', '', 'null', '[]', '{}'])('fails closed for invalid job metadata %j', metadata => {
  const result = run(undefined, metadata)
  expect(result.status).toBe(1)
  expect(readFileSync(join(result.output, 'summary.json'), 'utf8')).toContain('failed')
})
