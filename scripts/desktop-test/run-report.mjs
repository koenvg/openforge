import { copyFile as copyFileDefault, mkdir as mkdirDefault, rename as renameDefault, writeFile as writeFileDefault } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

export const INVARIANT_RUN_REPORT_SCHEMA_VERSION = 1

const PASSING_REQUIRED_SECTIONS = [
  'mode',
  'filters',
  'environment',
  'readiness',
  'scenarios',
  'processIdentities',
  'idleEvidence',
  'cleanup',
  'artifacts',
]

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function passingEvidenceIsComplete(report) {
  if (report.schemaVersion !== INVARIANT_RUN_REPORT_SCHEMA_VERSION) return false
  if (!['isolated', 'reuse'].includes(report.mode)) return false
  if (!Array.isArray(report.filters?.scenarios) || report.filters.scenarios.length === 0) return false
  if (!isObject(report.environment) || !report.readiness?.complete) return false
  if (!Array.isArray(report.scenarios) || report.scenarios.length === 0) return false
  if (!report.scenarios.every(scenario => (
    scenario?.status === 'passed'
    && Array.isArray(scenario.assertions)
    && scenario.assertions.length > 0
    && scenario.assertions.every(assertion => assertion?.passed === true)
    && isObject(scenario.diagnostics)
  ))) return false
  if (!Array.isArray(report.processIdentities) || report.processIdentities.length === 0) return false

  const idleSelected = report.filters.scenarios.includes('idle-resources')
  if (!isObject(report.idleEvidence)) return false
  if (idleSelected) {
    if (report.idleEvidence.status !== 'passed' || report.idleEvidence.complete !== true) return false
    if (report.idleEvidence.evidenceFailures?.length || report.idleEvidence.thresholdFailures?.length) return false
  } else if (!['passed', 'not-selected'].includes(report.idleEvidence.status)) return false

  if (report.cleanup?.status !== 'passed' || report.cleanup.failures?.length) return false
  if (!isObject(report.artifacts) || typeof report.artifacts.report !== 'string') return false
  return true
}

export function serializeInvariantRunReport(report) {
  if (!isObject(report)) throw new Error('Invariant run report must be an object')
  if (report.status === 'passed') {
    for (const section of PASSING_REQUIRED_SECTIONS) {
      if (!Object.hasOwn(report, section)) {
        throw new Error(`Passing invariant report is missing required section: ${section}`)
      }
    }
    if (!passingEvidenceIsComplete(report)) {
      throw new Error('Passing invariant report has incomplete or failed evidence')
    }
  }
  return `${JSON.stringify(report, null, 2)}\n`
}

export async function persistInvariantRunReport(report, {
  reportPath = report?.artifacts?.report,
  writeFile = writeFileDefault,
  rename = renameDefault,
} = {}) {
  if (!reportPath) throw new Error('Invariant run report path is required')
  const temporaryPath = `${reportPath}.tmp-${report?.runId ?? 'run'}`
  await writeFile(temporaryPath, serializeInvariantRunReport(report), 'utf8')
  await rename(temporaryPath, reportPath)
  return reportPath
}

function safeArtifactName(value, fallback) {
  const name = basename(String(value || fallback)).replace(/[^A-Za-z0-9._-]/g, '-')
  if (!name || name === '.' || name === '..') throw new Error('Artifact name is invalid')
  return name
}

export async function captureRunArtifacts({
  artifactRoot,
  childLogs = [],
  traceChunks = [],
  screenshots = [],
  eventTimelinePath = null,
  eventCounts = null,
  processSnapshots = [],
  idleResults = [],
  errors = [],
} = {}, {
  mkdir = mkdirDefault,
  writeFile = writeFileDefault,
  copyFile = copyFileDefault,
} = {}) {
  if (!artifactRoot) throw new Error('Run artifact root is required')
  await mkdir(artifactRoot, { recursive: true })
  const manifest = {
    report: join(artifactRoot, 'report.json'),
    eventTimeline: eventTimelinePath,
    eventCounts: null,
    childLogs: [],
    traces: [],
    screenshots: [],
    processSnapshots: [],
    idleResults: [],
    errors: [],
  }

  for (const [index, log] of childLogs.entries()) {
    const target = join(artifactRoot, safeArtifactName(log.name, `child-${index}.log`))
    await writeFile(target, String(log.content ?? ''), 'utf8')
    manifest.childLogs.push(target)
  }
  for (const [index, trace] of traceChunks.entries()) {
    const target = join(artifactRoot, safeArtifactName(trace.name, `trace-${index}.zip`))
    if (resolve(trace.path) !== resolve(target)) await copyFile(trace.path, target)
    manifest.traces.push(target)
  }
  for (const [index, screenshot] of screenshots.entries()) {
    const target = join(artifactRoot, safeArtifactName(screenshot.name, `screenshot-${index}.png`))
    await writeFile(target, screenshot.content)
    manifest.screenshots.push(target)
  }
  if (eventCounts !== null) {
    manifest.eventCounts = join(artifactRoot, 'event-counts.json')
    await writeFile(manifest.eventCounts, `${JSON.stringify(eventCounts, null, 2)}\n`, 'utf8')
  }
  for (const [index, snapshot] of processSnapshots.entries()) {
    const target = join(artifactRoot, safeArtifactName(snapshot.name, `processes-${index}.json`))
    await writeFile(target, `${JSON.stringify(snapshot.value, null, 2)}\n`, 'utf8')
    manifest.processSnapshots.push(target)
  }
  for (const [index, result] of idleResults.entries()) {
    const target = join(artifactRoot, safeArtifactName(result.name, `idle-${index}.json`))
    await writeFile(target, `${JSON.stringify(result.value, null, 2)}\n`, 'utf8')
    manifest.idleResults.push(target)
  }
  for (const [index, error] of errors.entries()) {
    const target = join(artifactRoot, safeArtifactName(error.name, `error-${index}.json`))
    await writeFile(target, `${JSON.stringify(error.value, null, 2)}\n`, 'utf8')
    manifest.errors.push(target)
  }

  return manifest
}
