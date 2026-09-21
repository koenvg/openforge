import { expect, it } from 'vitest'
import { summarizeFrontendTiming } from './frontend-ci-timing.mjs'

const time = seconds => new Date(Date.UTC(2026, 0, 1, 0, 0, seconds)).toISOString()
const job = (name, created, started, completed, firstCheck) => ({
  name, created_at: time(created), started_at: time(started), completed_at: time(completed),
  conclusion: 'success', labels: ['ubuntu-latest'],
  steps: [{ name: firstCheck, started_at: time(started + 10) }],
})

it('separates frontend elapsed time, per-job wait, setup and summed runner minutes', () => {
  const report = summarizeFrontendTiming({ id: 42, head_sha: 'abc', created_at: time(0) }, [
    job('Frontend Static Checks', 0, 5, 65, 'Build built-in plugins'),
    job('Frontend Shard 1/3', 0, 10, 70, 'Run tests'),
    job('Frontend Shard 2/3', 0, 10, 70, 'Run tests'),
    job('Frontend Shard 3/3', 0, 10, 70, 'Run tests'),
    job('Frontend Tests', 70, 75, 95, 'Aggregate frontend results'),
    job('Rust Tests', 0, 5, 600, 'Run tests'),
  ])
  expect(report).toMatchObject({ runId: 42, revision: 'abc', elapsedSeconds: 95, runnerSeconds: 260, setupSeconds: 50, waitSeconds: 40 })
  expect(report.runnerMinutes).toBeCloseTo(260 / 60)
  expect(report.jobs).toHaveLength(5)
})

it('refuses incomplete or invalid timing evidence instead of inventing a comparison', () => {
  expect(() => summarizeFrontendTiming({ created_at: time(0) }, [])).toThrow()
  expect(() => summarizeFrontendTiming({ created_at: time(0) }, [{ name: 'Frontend Tests' }])).toThrow()
})
