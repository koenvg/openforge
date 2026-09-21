import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// This CLI consumes isolated download directories, never overlapping shard filenames.
const [input, output] = process.argv.slice(2)
if (!input || !output) throw new Error('Usage: frontend-ci.mjs INPUT OUTPUT')
const results = join(output, 'results')
const logs = join(output, 'logs')
mkdirSync(results, { recursive: true })
mkdirSync(logs, { recursive: true })
let needs
try { needs = JSON.parse(process.env.FRONTEND_NEEDS) } catch { needs = {} }
let failed = false
function read(path) {
  try { return readFileSync(path, 'utf8') } catch { return undefined }
}
function result(check, success) {
  writeFileSync(join(results, `${check}-exit-code`), success ? '0\n' : '1\n')
  failed ||= !success
}
for (const check of ['plugin-build', 'app-build', 'typecheck', 'lint']) {
  const code = read(join(input, 'static', `${check}-exit-code`))
  result(check, needs?.['frontend-static']?.result === 'success' && code?.trim() === '0')
  const jobResult = needs?.['frontend-static']?.result ?? 'missing'
  const diagnostic = jobResult === 'success' ? '' : `Static job result: ${jobResult}. This check cannot be confirmed successful.\n`
  writeFileSync(join(logs, `${check}.log`), diagnostic + (read(join(input, 'static', `${check}.log`)) ?? `${check}: logs unavailable; result ${JSON.stringify(code)}\n`))
}
let testsPassed = needs?.['frontend-shards']?.result === 'success'
const summaries = []
const fullLogs = []
for (const shard of [1, 2, 3]) {
  const code = read(join(input, String(shard), 'tests-exit-code'))
  const log = read(join(input, String(shard), 'tests.log'))
  testsPassed &&= code?.trim() === '0'
  const heading = `=== Shard ${shard}/3: ${code?.trim() === '0' ? 'passed' : 'failed or missing'} ===`
  fullLogs.push(`${heading}\n${log ?? 'Logs unavailable'}\n`)
  const lines = (log ?? 'Logs unavailable').split('\n')
  const errors = lines.filter(line => /FAIL|Error|error|Assertion|❯/.test(line))
  summaries.push(`${heading}\n${errors.join('\n').slice(0, 4000)}\n${lines.slice(-40).join('\n').slice(-4000)}\n`)
}
result('tests', testsPassed)
writeFileSync(join(logs, 'tests.log'), fullLogs.join('\n'))
// A bounded summary budgets space per shard rather than losing early failures to a global tail.
writeFileSync(join(logs, 'tests-summary.log'), `Matrix result: ${needs?.['frontend-shards']?.result ?? 'missing'}\n${summaries.join('\n')}`)
process.exitCode = failed ? 1 : 0
