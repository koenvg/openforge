import { createHash } from 'node:crypto'
import { identity, validateManifest, validateBaselines } from './manifest.mjs'

const modes = ['check', 'update', 'test', 'shard', 'probes']
export const probePhases = ['terminal-readiness', 'cursor-stability', 'readiness-diagnostics', 'capture-stability', 'runner-probes']

export function resolveShard(mode, env) {
  const values = [env.VISUAL_SHARD_INDEX, env.VISUAL_SHARD_COUNT]
  if (!modes.includes(mode)) throw new Error('invalid visual mode')
  if (mode !== 'shard') {
    if (values.some(value => value !== undefined)) throw new Error('shard inputs require shard mode')
    return null
  }
  if (!values.every(value => typeof value === 'string' && /^[1-9][0-9]*$/.test(value) && Number.isSafeInteger(Number(value)))) {
    throw new Error('shard index/count must be positive safe integers')
  }
  const [index, count] = values.map(Number)
  if (index > count) throw new Error('shard index must not exceed count')
  if ([env.VISUAL_OUTPUT, env.VISUAL_BASELINES, env.VISUAL_MANIFEST].some(value => value !== undefined)) {
    throw new Error('shard inputs cannot be combined with internal probe overrides')
  }
  return { index, count }
}

export function parseVisualCommand(args) {
  const [mode, ...flags] = args
  const env = {}
  if (mode === 'shard') {
    for (let i = 0; i < flags.length; i += 2) {
      const key = { '--shard-index': 'VISUAL_SHARD_INDEX', '--shard-count': 'VISUAL_SHARD_COUNT' }[flags[i]]
      if (!key || env[key] !== undefined || flags[i + 1] === undefined) throw new Error('invalid shard flags')
      env[key] = flags[i + 1]
    }
  } else if (flags.length) throw new Error('unexpected visual command arguments')
  return { mode, shard: resolveShard(mode, env), env }
}

// Selection is deliberately inseparable from global inventory validation.
export function planExecution({ mode, env = {}, manifest, indexes, baselineFiles }) {
  const shard = resolveShard(mode, env)
  const allEntries = validateManifest(manifest, indexes)
  const obsolete = validateBaselines(allEntries, baselineFiles, mode === 'update' ? 'update' : 'check')
  const sorted = [...allEntries].sort((a, b) => identity(a) < identity(b) ? -1 : 1)
  if (shard && shard.count > sorted.length) throw new Error('shard count exceeds manifest size; empty shards are not allowed')
  const entries = mode === 'probes' ? [] : sorted.filter((_, index) => !shard || index % shard.count === shard.index - 1)
  const phases = [
    ...(mode === 'probes' ? [] : ['baseline']),
    ...(['test', 'shard'].includes(mode) ? ['repeatability'] : []),
    ...(['test', 'probes'].includes(mode) ? probePhases : []),
  ]
  return { allEntries, entries, obsolete, shard, phases, expectedIdentities: sorted.map(identity), assignedIdentities: entries.map(identity) }
}

export function createEvidence({ mode, revision, dirty, manifestBytes }) {
  if (!/^[a-f0-9]{40,64}$/.test(revision ?? '')) throw new Error('missing or invalid visual revision')
  return {
    schemaVersion: 1, mode, revision, dirty,
    manifestDigest: createHash('sha256').update(manifestBytes).digest('hex'),
    status: 'incomplete', environment: null, assignment: null, expectedIdentities: [],
    expectedPhases: [], phases: [],
  }
}

// Failed phases retain evidence and do not suppress other independent phases.
export async function executePhases(plan, handlers, { evidence, timings }) {
  for (const phase of plan.phases) {
    const record = { phase, status: 'incomplete', completedIdentities: [] }
    evidence.phases.push(record)
    try {
      await timings.measure(phase, () => handlers[phase](id => record.completedIdentities.push(id)))
      record.status = 'passed'
    } catch (error) {
      record.status = 'failed'
      record.error = error.message
    }
  }
  const failures = evidence.phases.filter(phase => phase.status !== 'passed')
  if (failures.length) throw new Error(`Visual phases failed:\n${failures.map(phase => `${phase.phase}: ${phase.error}`).join('\n')}`)
}
