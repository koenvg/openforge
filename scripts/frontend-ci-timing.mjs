import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

function seconds(start, end) {
  const value = (Date.parse(end) - Date.parse(start)) / 1000
  if (!Number.isFinite(value) || value < 0) throw new Error('Missing or invalid timing evidence')
  return value
}

export function summarizeFrontendTiming(run, allJobs) {
  const selected = allJobs.filter(job => /^Frontend (Tests|Static Checks|Shard [123]\/3)$/.test(job.name))
  const sharded = selected.some(job => job.name !== 'Frontend Tests')
  const expected = sharded
    ? ['Frontend Tests', 'Frontend Static Checks', 'Frontend Shard 1/3', 'Frontend Shard 2/3', 'Frontend Shard 3/3']
    : ['Frontend Tests']
  if (selected.length !== expected.length || expected.some(name => selected.filter(job => job.name === name).length !== 1)) {
    throw new Error('Missing or duplicate frontend jobs')
  }
  const jobs = selected.map(job => {
    const firstCheck = job.name.startsWith('Frontend Shard') ? 'Run tests'
      : sharded && job.name === 'Frontend Tests' ? 'Aggregate frontend results' : 'Build built-in plugins'
    const step = job.steps?.find(step => step.name === firstCheck)
    return {
      name: job.name,
      conclusion: job.conclusion,
      runnerLabels: job.labels,
      waitSeconds: seconds(job.created_at, job.started_at),
      setupSeconds: seconds(job.started_at, step?.started_at),
      runnerSeconds: seconds(job.started_at, job.completed_at),
    }
  })
  const sum = key => jobs.reduce((total, job) => total + job[key], 0)
  return {
    runId: run.id,
    revision: run.head_sha,
    attempt: run.run_attempt,
    mode: sharded ? 'three-shard' : 'serial',
    elapsedSeconds: Math.max(...selected.map(job => seconds(run.created_at, job.completed_at))),
    waitSeconds: sum('waitSeconds'),
    setupSeconds: sum('setupSeconds'),
    runnerSeconds: sum('runnerSeconds'),
    runnerMinutes: sum('runnerSeconds') / 60,
    jobs,
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [runPath, jobsPath] = process.argv.slice(2)
  if (!runPath || !jobsPath) throw new Error('Usage: frontend-ci-timing.mjs RUN_JSON JOBS_JSON')
  const run = JSON.parse(readFileSync(runPath, 'utf8'))
  const pages = JSON.parse(readFileSync(jobsPath, 'utf8'))
  const jobs = (Array.isArray(pages) ? pages : [pages]).flatMap(page => page.jobs)
  console.log(JSON.stringify(summarizeFrontendTiming(run, jobs), null, 2))
}
