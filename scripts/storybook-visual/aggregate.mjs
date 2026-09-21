import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { probePhases } from './execution.mjs'

const [input, output] = process.argv.slice(2)
if (!input || !output) throw new Error('Usage: aggregate.mjs INPUT OUTPUT')

const shardCount = 4
const issues = []
const reports = []
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)
const describe = value => value === undefined ? 'missing' : String(value)

function readJson(path, label) {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'))
    if (!isObject(value)) throw new Error('root must be an object')
    return value
  } catch (error) {
    issues.push(error.code === 'ENOENT' ? `missing ${label} evidence` : `${label}: invalid evidence (${error.message})`)
    return null
  }
}

let needs
try {
  needs = JSON.parse(process.env.VISUAL_NEEDS)
  if (!isObject(needs)) throw new Error('root must be an object')
} catch {
  needs = {}
  issues.push('invalid VISUAL_NEEDS metadata')
}
for (const job of ['visual-shards', 'visual-probes']) {
  const result = needs[job]?.result
  if (result !== 'success') issues.push(`${job} result is ${describe(result)}`)
}

for (let index = 1; index <= shardCount; index += 1) {
  const report = readJson(join(input, `shard-${index}`, 'evidence.json'), `shard ${index}/${shardCount}`)
  if (report) reports.push({ label: `shard ${index}/${shardCount}`, mode: 'shard', index, report })
}
const probeReport = readJson(join(input, 'probes', 'evidence.json'), 'probes')
if (probeReport) reports.push({ label: 'probes', mode: 'probes', report: probeReport })

const reference = reports.find(({ mode }) => mode === 'shard')?.report ?? probeReport
const expectedIdentities = Array.isArray(reference?.expectedIdentities) ? reference.expectedIdentities : []
const referenceEnvironment = reference?.environment
const revision = reference?.revision
const manifestDigest = reference?.manifestDigest
const assignmentCounts = new Map()
const completionCounts = new Map()
const completedProbes = []
const increment = (map, key) => map.set(key, (map.get(key) ?? 0) + 1)

if (!reference) issues.push('no compatible evidence was available')
if (!/^[a-f0-9]{40,64}$/.test(revision ?? '')) issues.push('missing or invalid revision')
if (!/^[a-f0-9]{64}$/.test(manifestDigest ?? '')) issues.push('missing or invalid manifest digest')
if (!isObject(referenceEnvironment)) issues.push('missing capture environment')
if (!expectedIdentities.length || expectedIdentities.some(identity => typeof identity !== 'string')) issues.push('missing or invalid expected identities')
if (new Set(expectedIdentities).size !== expectedIdentities.length) issues.push('expected identities contain duplicates')

for (const { label, mode, index, report } of reports) {
  if (report.schemaVersion !== 1) issues.push(`${label} has unsupported schema version ${describe(report.schemaVersion)}`)
  if (report.mode !== mode) issues.push(`${label} mode is ${describe(report.mode)}; expected ${mode}`)
  if (report.status !== 'passed') issues.push(`${label} status is ${describe(report.status)}`)
  if (report.dirty !== false) issues.push(`${label} is not bound to a clean checkout`)
  if (report.revision !== revision) issues.push(`${label} has mixed revision`)
  if (report.manifestDigest !== manifestDigest) issues.push(`${label} has mixed manifest digest`)
  if (!same(report.environment, referenceEnvironment)) issues.push(`${label} has incompatible environment`)
  if (!same(report.expectedIdentities, expectedIdentities)) issues.push(`${label} has incompatible expected identities`)

  const requiredPhases = mode === 'shard' ? ['baseline', 'repeatability'] : probePhases
  if (!same(report.expectedPhases, requiredPhases)) issues.push(`${label} declares incompatible expected phases`)
  const phaseRecords = Array.isArray(report.phases) ? report.phases : []

  if (mode === 'shard') {
    const shard = report.assignment?.shard
    const assigned = report.assignment?.identities
    if (shard?.index !== index || shard?.count !== shardCount) issues.push(`${label} has incompatible shard assignment`)
    if (!Array.isArray(assigned)) {
      issues.push(`${label} has invalid assigned identities`)
    } else {
      for (const identity of assigned) increment(assignmentCounts, identity)
      const deterministic = expectedIdentities.filter((_, position) => position % shardCount === index - 1)
      if (!same(assigned, deterministic)) issues.push(`${label} assignment does not match deterministic manifest partition`)
    }
    for (const phase of ['baseline', 'repeatability']) {
      for (const record of phaseRecords.filter(record => record?.phase === phase)) {
        if (record.status !== 'passed') issues.push(`${label} ${phase} has ${describe(record.status)} evidence`)
        if (!Array.isArray(record.completedIdentities)) issues.push(`${label} ${phase} has invalid completions`)
        else for (const identity of record.completedIdentities) increment(completionCounts, `${phase}\0${identity}`)
      }
    }
    for (const record of phaseRecords) if (!requiredPhases.includes(record?.phase)) issues.push(`${label} has unexpected phase ${describe(record?.phase)}`)
  } else {
    if (report.assignment?.shard !== null || !same(report.assignment?.identities, [])) issues.push('probes report has a case assignment')
    for (const phase of probePhases) {
      const records = phaseRecords.filter(record => record?.phase === phase)
      if (records.length !== 1) issues.push(`${phase} completed ${records.length} times; expected exactly once`)
      for (const record of records) {
        if (record.status !== 'passed') issues.push(`${phase} has ${describe(record.status)} evidence`)
        if (!same(record.completedIdentities, [])) issues.push(`${phase} unexpectedly completed case identities`)
        if (record.status === 'passed') completedProbes.push(phase)
      }
    }
    for (const record of phaseRecords) if (!probePhases.includes(record?.phase)) issues.push(`unexpected probe ${describe(record?.phase)}`)
  }
}

for (const identity of expectedIdentities) {
  const assignments = assignmentCounts.get(identity) ?? 0
  if (assignments !== 1) issues.push(`${identity} is assigned ${assignments} times; expected exactly once`)
  for (const phase of ['baseline', 'repeatability']) {
    const completions = completionCounts.get(`${phase}\0${identity}`) ?? 0
    if (completions !== 1) issues.push(`${identity} ${phase} completed ${completions} times; expected exactly once`)
  }
}
for (const identity of assignmentCounts.keys()) if (!expectedIdentities.includes(identity)) issues.push(`unexpected assigned identity ${identity}`)
for (const key of completionCounts.keys()) {
  const [phase, identity] = key.split('\0')
  if (!expectedIdentities.includes(identity)) issues.push(`unexpected ${phase} completion ${identity}`)
}

const uniqueIssues = [...new Set(issues)]
const completedPairCount = expectedIdentities.filter(identity => ['baseline', 'repeatability'].every(phase => completionCounts.get(`${phase}\0${identity}`) === 1)).length
const summary = {
  schemaVersion: 1,
  status: uniqueIssues.length ? 'failed' : 'passed',
  revision: revision ?? null,
  manifestDigest: manifestDigest ?? null,
  environment: referenceEnvironment ?? null,
  shardCount,
  expectedCaseCount: expectedIdentities.length,
  completedPairCount,
  probes: probePhases.filter(phase => completedProbes.filter(value => value === phase).length === 1),
  issues: uniqueIssues,
}
mkdirSync(output, { recursive: true })
writeFileSync(join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
writeFileSync(join(output, 'summary.md'), `# Storybook visual aggregate\n\nStatus: **${summary.status}**\n\nRevision: \`${summary.revision ?? 'unavailable'}\`  \nManifest: \`${summary.manifestDigest ?? 'unavailable'}\`  \nCases: ${completedPairCount}/${expectedIdentities.length} complete pairs  \nProbes: ${summary.probes.length}/${probePhases.length} passed\n\n${uniqueIssues.length ? `## Diagnostics\n\n${uniqueIssues.map(issue => `- ${issue}`).join('\n')}\n` : 'Every expected shard, case pair, and probe completed with compatible evidence.\n'}`)
if (uniqueIssues.length) {
  console.error(uniqueIssues.join('\n'))
  process.exitCode = 1
} else {
  console.log(`Visual aggregate passed: ${completedPairCount} case pairs and ${probePhases.length} probes`)
}
