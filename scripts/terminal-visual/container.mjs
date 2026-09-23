import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

import { PLAYWRIGHT_IMAGE } from '../playwright-image.mjs'

const image = PLAYWRIGHT_IMAGE

const [mode, ...extraArguments] = process.argv.slice(2)
if (!['check', 'update'].includes(mode) || extraArguments.length > 0) {
  throw new Error('usage: pnpm terminal:visual:check or pnpm terminal:visual:update')
}

const root = resolve(import.meta.dirname, '../..')
const terminalBaselines = resolve(root, 'packages/terminal-runtime/conformance/baselines/linux-arm64')
const markdownBaselines = resolve(root, 'packages/pr-review-ui/src/visual-baselines')
const terminalOutput = resolve(root, 'artifacts/terminal-presentation')
const markdownOutput = resolve(root, 'screenshots/markdown-visual')
for (const directory of [terminalBaselines, markdownBaselines, terminalOutput, markdownOutput]) {
  mkdirSync(directory, { recursive: true })
}

const baselineAccess = mode === 'update' ? '' : ':ro'
const result = spawnSync('docker', [
  'run',
  '--rm',
  '--platform=linux/arm64',
  '--init',
  '--ipc=host',
  '-e',
  'CI=1',
  '-e',
  `TERMINAL_VISUAL_MODE=${mode}`,
  '-e',
  `TERMINAL_VISUAL_IMAGE=${image}`,
  '-v',
  `${root}:/source:ro`,
  '-v',
  `${terminalBaselines}:/terminal-baselines${baselineAccess}`,
  '-v',
  `${markdownBaselines}:/markdown-baselines${baselineAccess}`,
  '-v',
  `${terminalOutput}:/terminal-output`,
  '-v',
  `${markdownOutput}:/markdown-output`,
  '-v',
  'openforge-terminal-visual-pnpm:/pnpm-store',
  image,
  'bash',
  '/source/scripts/terminal-visual/entrypoint.sh',
], { stdio: 'inherit' })

if (result.error) throw result.error
process.exitCode = result.status ?? 1
