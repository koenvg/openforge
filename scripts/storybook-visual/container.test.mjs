import { afterEach, beforeEach, expect, it } from 'vitest'
import { mkdtemp, mkdir, copyFile, writeFile, readdir, rm, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync, spawnSync } from 'node:child_process'

let root
let env
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'visual-container-')))
  const scripts = join(root, 'scripts/storybook-visual')
  await mkdir(scripts, { recursive: true })
  for (const file of ['container.mjs', 'execution.mjs', 'inputs.mjs', 'manifest.mjs']) await copyFile(new URL(file, import.meta.url), join(scripts, file))
  await copyFile(new URL('../playwright-image.mjs', import.meta.url), join(root, 'scripts/playwright-image.mjs'))
  const bin = join(root, 'bin')
  await mkdir(bin)
  await writeFile(join(bin, 'docker'), '#!/usr/bin/env node\nconsole.log(JSON.stringify(process.argv.slice(2)))\n', { mode: 0o755 })
  execFileSync('git', ['init', '-q', root])
  execFileSync('git', ['-c', 'user.name=Visual test', '-c', 'user.email=visual@example.test', '-c', 'core.hooksPath=/dev/null', 'commit', '--allow-empty', '-qm', 'fixture'], { cwd: root })
  env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('VISUAL_')))
  env.PATH = `${bin}:${env.PATH}`
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })
function run(args, overrides = {}) {
  return spawnSync(process.execPath, [join(root, 'scripts/storybook-visual/container.mjs'), ...args], { env: { ...env, ...overrides }, encoding: 'utf8' })
}
function dockerArgs(result) {
  expect(result.status, result.stderr).toBe(0)
  return JSON.parse(result.stdout.trim().split('\n').at(-1))
}

it('isolates concurrent reproduction outputs without changing pinned mounts or capture environment', () => {
  const commands = [run(['shard', '--shard-index', '2', '--shard-count', '4']), run(['shard', '--shard-index', '2', '--shard-count', '4']), run(['probes'])]
  const args = commands.map(dockerArgs)
  const outputMounts = args.map(values => values.find(value => value.endsWith(':/output')))
  expect(new Set(outputMounts).size).toBe(3)
  expect(outputMounts[0]).toMatch(/storybook-visual-runs\/shard-2-of-4-[^/]+:\/output$/)
  expect(outputMounts[2]).toMatch(/storybook-visual-runs\/probes-[^/]+:\/output$/)
  for (const values of args) {
    expect(values).toContain('--platform=linux/arm64')
    expect(values).toContain(`${root}:/source:ro`)
    expect(values).toContain(`${root}/storybook/baselines:/baselines:ro`)
    expect(values.some(value => /^VISUAL_REVISION=[a-f0-9]{40}$/.test(value))).toBe(true)
    expect(values).toContain('VISUAL_IMAGE=mcr.microsoft.com/playwright:v1.62.1-noble@sha256:941cc91e5022880ac1d14ae90b476b624deb6399dbbc28d612d5d5bd7928fcbd')
  }
  expect(args[0]).toContain('VISUAL_SHARD_INDEX=2')
  expect(args[0]).toContain('VISUAL_SHARD_COUNT=4')
  expect(args[2].some(value => value.startsWith('VISUAL_SHARD_'))).toBe(false)
})

it('keeps the full command and baseline update mounts compatible', () => {
  const full = dockerArgs(run(['test']))
  expect(full).toContain(`${root}/artifacts/storybook-visual:/output`)
  expect(full).toContain('VISUAL_MODE=test')
  expect(full.some(value => value.startsWith('VISUAL_SHARD_'))).toBe(false)
  const update = dockerArgs(run(['update']))
  expect(update).toContain(`${root}/storybook/baselines:/baselines`)
})

it('rejects invalid selection and internal overrides before creating outputs or launching Docker', async () => {
  for (const args of [['shard'], ['shard', '--shard-index', '0', '--shard-count', '4'], ['shard', '--shard-index', '2', '--shard-count', '1'], ['test', '--shard-index', '1']]) expect(run(args).status).not.toBe(0)
  expect(run(['probes'], { VISUAL_OUTPUT: '/output/self-test/restored' }).status).not.toBe(0)
  expect(run(['test'], { VISUAL_SHARD_COUNT: '2' }).status).not.toBe(0)
  expect(run(['shard', '--shard-index', '1', '--shard-count', '4'], { VISUAL_SHARD_COUNT: 'invalid' }).status).not.toBe(0)
  await expect(readdir(join(root, 'artifacts'))).rejects.toMatchObject({ code: 'ENOENT' })
})
