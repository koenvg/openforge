import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, expect, it } from 'vitest'
import { readCiResults, renderFrontendComment } from './ci-comment.mjs'

const roots = []
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })))

function run(change = () => {}, rawNeeds) {
  const root = mkdtempSync(join(tmpdir(), 'frontend-ci-'))
  roots.push(root)
  const input = join(root, 'input')
  const output = join(root, 'output')
  for (const [name, checks] of Object.entries({ static: ['plugin-build', 'app-build', 'typecheck', 'lint'], '1': ['tests'], '2': ['tests'], '3': ['tests'] })) {
    mkdirSync(join(input, name), { recursive: true })
    for (const check of checks) {
      writeFileSync(join(input, name, `${check}-exit-code`), '0\n')
      writeFileSync(join(input, name, `${check}.log`), `${name} ${check} evidence\n`)
    }
  }
  const needs = { 'frontend-static': { result: 'success' }, 'frontend-shards': { result: 'success' } }
  change(input, needs)
  const result = spawnSync(process.execPath, ['scripts/frontend-ci.mjs', input, output], { encoding: 'utf8', env: { ...process.env, FRONTEND_NEEDS: rawNeeds ?? JSON.stringify(needs) } })
  return { ...result, output }
}

it('publishes successful legacy results only for complete successful inputs', () => {
  const result = run()
  expect(result.status, result.stderr).toBe(0)
  expect(readFileSync(join(result.output, 'results/tests-exit-code'), 'utf8')).toBe('0\n')
})

it.each(['failure', 'cancelled', 'skipped', undefined])('rejects a %s matrix even with successful files', state => {
  expect(run((input, needs) => { needs['frontend-shards'].result = state }).status).toBe(1)
})

it.each(['1', '2', '3'])('rejects missing shard %s and retains its diagnostic', shard => {
  const result = run(input => rmSync(join(input, shard), { recursive: true }))
  expect(result.status).toBe(1)
  expect(readFileSync(join(result.output, 'logs/tests.log'), 'utf8')).toContain(`Shard ${shard}/3`)
})

it.each(['', 'garbage', '00', '1'])('rejects malformed or failed results %j', code => {
  expect(run(input => writeFileSync(join(input, '2/tests-exit-code'), code)).status).toBe(1)
})

it('retains each shard failure before later verbose output', () => {
  const result = run(input => {
    for (const shard of ['1', '2', '3']) {
      writeFileSync(join(input, shard, 'tests-exit-code'), '1\n')
      writeFileSync(join(input, shard, 'tests.log'), `FAIL unique-${shard}\n${'noise\n'.repeat(500)}`)
    }
  })
  expect(result.status).toBe(1)
  const log = readFileSync(join(result.output, 'logs/tests.log'), 'utf8')
  for (const shard of ['1', '2', '3']) expect(log).toContain(`FAIL unique-${shard}`)
})

it.each(['plugin-build', 'app-build', 'typecheck', 'lint'])('rejects a missing static %s result', check => {
  const result = run(input => rmSync(join(input, 'static', `${check}-exit-code`)))
  expect(result.status).toBe(1)
  expect(readFileSync(join(result.output, `results/${check}-exit-code`), 'utf8')).toBe('1\n')
})

it.each(['failure', 'cancelled', 'skipped', undefined])('rejects a %s static job with otherwise successful artifacts', state => {
  const result = run((input, needs) => { needs['frontend-static'].result = state })
  expect(result.status).toBe(1)
  expect(readFileSync(join(result.output, 'results/typecheck-exit-code'), 'utf8')).toBe('1\n')
})

it.each(['1', '2', '3'])('keeps shard %s failure visible through the real artifact/comment contract', shard => {
  const result = run(input => {
    writeFileSync(join(input, shard, 'tests-exit-code'), '1\n')
    writeFileSync(join(input, shard, 'tests.log'), `FAIL shard-${shard}-regression\n${'noise\n'.repeat(1000)}`)
  })
  const reader = path => readFileSync(path.replace('/tmp/frontend-results', join(result.output, 'results')).replace('/tmp/frontend-logs', join(result.output, 'logs')), 'utf8')
  const dependencies = { readFileSync: reader, core: { info() {}, warning() {} } }
  const checks = readCiResults(dependencies)
  expect(result.status).toBe(1)
  expect(checks.frontend.testsFailed).toBe(true)
  expect(renderFrontendComment(checks.frontend, dependencies)).toContain(`FAIL shard-${shard}-regression`)
})

it.each(['{', '', 'null', '[]', '{}'])('fails closed for invalid job metadata %j', metadata => {
  const result = run(undefined, metadata)
  expect(result.status).toBe(1)
  expect(readFileSync(join(result.output, 'results/tests-exit-code'), 'utf8')).toBe('1\n')
})
