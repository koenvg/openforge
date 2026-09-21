import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const workflow = readFileSync(new URL('../../.github/workflows/storybook-visual.yml', import.meta.url), 'utf8')
const job = name => workflow.split(`\n  ${name}:\n`)[1]?.split(/\n  [\w-]+:\n/)[0] ?? ''

it('runs four independent canonical ARM shards with isolated reports', () => {
  const shards = job('visual-shards')
  expect(shards).toContain('runs-on: ubuntu-24.04-arm')
  expect(shards).toContain('fail-fast: false')
  expect(shards).toContain('shard: [1, 2, 3, 4]')
  expect(shards).toContain('pnpm storybook:visual:shard --shard-index ${{ matrix.shard }} --shard-count 4')
  expect(shards).toContain('name: storybook-visual-shard-${{ matrix.shard }}')
  expect(shards).toContain('if: always()')
  expect(shards).toContain('retention-days: 14')
})

it('runs visual unit coverage and regression probes exactly once in a dedicated ARM job', () => {
  const probes = job('visual-probes')
  expect(probes).toContain('runs-on: ubuntu-24.04-arm')
  expect(probes).toContain('pnpm exec playwright install --with-deps chromium')
  expect(probes.match(/pnpm storybook:visual:unit/g)).toHaveLength(1)
  expect(probes.match(/pnpm storybook:visual:probes/g)).toHaveLength(1)
  expect(probes).toContain('name: storybook-visual-probes')
  expect(probes).toContain('if: always()')
})

it('preserves the smoke gate identity and fails closed over all jobs and evidence', () => {
  const aggregate = job('smoke')
  expect(aggregate).toContain('needs: [visual-shards, visual-probes]')
  expect(aggregate).toContain('if: always()')
  expect(aggregate).toContain('VISUAL_NEEDS: ${{ toJSON(needs) }}')
  expect(aggregate).toContain('node scripts/storybook-visual/aggregate.mjs')
  for (const name of ['storybook-visual-shard-1', 'storybook-visual-shard-2', 'storybook-visual-shard-3', 'storybook-visual-shard-4', 'storybook-visual-probes']) {
    expect(aggregate).toContain(`name: ${name}`)
  }
  expect(aggregate).toContain('name: storybook-visual-review')
  expect(aggregate).not.toMatch(/^    continue-on-error:/m)
})
