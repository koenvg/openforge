import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

export const image = 'mcr.microsoft.com/playwright:v1.62.1-noble@sha256:941cc91e5022880ac1d14ae90b476b624deb6399dbbc28d612d5d5bd7928fcbd'
const mode = process.argv[2]
if (!['check', 'update', 'test'].includes(mode) || process.argv.length !== 3) throw new Error('usage: container.mjs check|update|test')
const root = resolve(import.meta.dirname, '../..')
const output = resolve(root, 'artifacts/storybook-visual')
const baselines = resolve(root, 'storybook/baselines')
mkdirSync(output, { recursive: true })
mkdirSync(baselines, { recursive: true })
const result = spawnSync('docker', ['run', '--rm', '--platform=linux/arm64', '--init', '--ipc=host',
  '-e', 'CI=1', '-e', 'STORYBOOK_DISABLE_TELEMETRY=1', '-e', `VISUAL_MODE=${mode}`, '-e', `VISUAL_IMAGE=${image}`,
  '-v', `${root}:/source:ro`, '-v', `${output}:/output`, '-v', `${baselines}:/baselines${mode === 'update' ? '' : ':ro'}`,
  '-v', 'openforge-storybook-pnpm:/pnpm-store',
  image, 'bash', '/source/scripts/storybook-visual/entrypoint.sh'], { stdio: 'inherit' })
if (result.error) throw result.error
process.exitCode = result.status ?? 1
