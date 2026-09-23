import { readFileSync } from 'node:fs'
import { createVitest } from 'vitest/node'
import { expect, it } from 'vitest'
import config from '../vitest.config.ts'

const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
const job = name => workflow.split(`\n  ${name}:\n`)[1]?.split(/\n  [\w-]+:\n/)[0] ?? ''

it('runs three independent shards with complete local prerequisites and configured workers', () => {
  const shards = job('frontend-shards')
  expect(shards).toContain('fail-fast: false')
  expect(shards).toContain('shard: [1, 2, 3]')
  expect(shards).not.toContain('needs:')
  expect(shards).toContain('pnpm install --frozen-lockfile')
  expect(shards).toContain('pnpm exec playwright install --with-deps chromium')
  expect(shards).toContain('pnpm build:plugins')
  expect(shards).toContain('pnpm build')
  expect(shards).toContain('pnpm test --shard=${{ matrix.shard }}/3')
  expect(shards).not.toContain('--project')
  expect(shards).not.toContain('--maxWorkers')
  expect(config.test.maxWorkers).toBe(2)
  expect(config.test.testTimeout).toBe(15_000)
})

it('preserves the required aggregate identity, legacy artifacts, static checks and package gate', () => {
  const aggregate = job('frontend')
  expect(aggregate).toContain('name: Frontend Tests')
  expect(aggregate).toContain('needs: [frontend-static, frontend-shards]')
  expect(aggregate).toContain('if: always()')
  expect(aggregate).toContain('FRONTEND_NEEDS: ${{ toJSON(needs) }}')
  expect(aggregate).toContain('node scripts/frontend-ci.mjs')
  expect(aggregate).toContain('name: frontend-results')
  expect(aggregate).toContain('name: frontend-logs')
  const checks = job('frontend-static')
  for (const command of ['pnpm build:plugins', 'pnpm build', 'pnpm exec tsc --noEmit', 'pnpm plugin-host:typecheck', 'pnpm --filter @openforge-app/plugin-github-sync typecheck', 'pnpm mobile:contract:check', 'pnpm lint']) expect(checks).toContain(command)
  for (const command of ['pnpm packages:build', 'pnpm packages:test', 'pnpm packages:contract:check', 'pnpm packages:pack:dry-run']) expect(job('npm-packages')).toContain(command)
})

it('native shard selection covers the full suite exactly once across every named project', async () => {
  const vitest = await createVitest('test', { watch: false })
  try {
    const full = await vitest.globTestSpecifications()
    const shards = []
    for (const index of [1, 2, 3]) {
      vitest.config.shard = { index, count: 3 }
      const sequencer = new vitest.config.sequence.sequencer(vitest)
      shards.push(...await sequencer.shard([...full]))
    }
    const identity = entry => JSON.stringify([entry.project.name, entry.moduleId])
    expect(shards.map(identity).sort()).toEqual(full.map(identity).sort())
    expect(new Set(shards.map(identity)).size).toBe(full.length)
    expect([...new Set(full.map(entry => entry.project.name))].sort()).toEqual(config.test.projects.map(project => project.test.name).sort())
  } finally {
    await vitest.close()
  }
}, 30000)
