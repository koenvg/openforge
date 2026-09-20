import { spawnSync, execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { parseVisualCommand } from './execution.mjs'
import { resolveVisualInputs } from './inputs.mjs'

export const image = 'mcr.microsoft.com/playwright:v1.62.1-noble@sha256:941cc91e5022880ac1d14ae90b476b624deb6399dbbc28d612d5d5bd7928fcbd'
const { mode, shard, env } = parseVisualCommand(process.argv.slice(2))
// Public flags are the only host-side selection API; never silently ignore overrides.
if (['VISUAL_SHARD_INDEX', 'VISUAL_SHARD_COUNT'].some(key => process.env[key] !== undefined)) throw new Error('use --shard-index and --shard-count flags, not host environment overrides')
resolveVisualInputs(mode, process.env)
if (['VISUAL_OUTPUT', 'VISUAL_BASELINES', 'VISUAL_MANIFEST'].some(key => process.env[key] !== undefined)) throw new Error('internal probe overrides are not public command inputs')
const root = resolve(import.meta.dirname, '../..')
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim().length > 0
const isolated = ['shard', 'probes'].includes(mode)
const parent = resolve(root, isolated ? 'artifacts/storybook-visual-runs' : 'artifacts/storybook-visual')
mkdirSync(parent, { recursive: true })
const output = isolated ? mkdtempSync(join(parent, shard ? `shard-${shard.index}-of-${shard.count}-` : 'probes-')) : parent
const baselines = resolve(root, 'storybook/baselines')
mkdirSync(baselines, { recursive: true })
console.log(`Visual artifacts: ${output}`)
const result = spawnSync('docker', ['run', '--rm', '--platform=linux/arm64', '--init', '--ipc=host',
  '-e', 'CI=1', '-e', 'STORYBOOK_DISABLE_TELEMETRY=1', '-e', `VISUAL_MODE=${mode}`, '-e', `VISUAL_IMAGE=${image}`,
  '-e', `VISUAL_REVISION=${revision}`, '-e', `VISUAL_DIRTY=${dirty}`,
  ...Object.entries(env).flatMap(([key, value]) => ['-e', `${key}=${value}`]),
  '-v', `${root}:/source:ro`, '-v', `${output}:/output`, '-v', `${baselines}:/baselines${mode === 'update' ? '' : ':ro'}`,
  '-v', 'openforge-storybook-pnpm:/pnpm-store',
  image, 'bash', '/source/scripts/storybook-visual/entrypoint.sh'], { stdio: 'inherit' })
if (result.error) throw result.error
process.exitCode = result.status ?? 1
