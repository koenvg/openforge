import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { PLAYWRIGHT_IMAGE } from '../playwright-image.mjs'

const roots = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'terminal-visual-')))
  roots.push(root)
  const script = readFileSync(new URL('./container.mjs', import.meta.url), 'utf8')
  const imageModule = readFileSync(new URL('../playwright-image.mjs', import.meta.url), 'utf8')
  mkdirSync(join(root, 'scripts/terminal-visual'), { recursive: true })
  writeFileSync(join(root, 'scripts/terminal-visual/container.mjs'), script)
  writeFileSync(join(root, 'scripts/playwright-image.mjs'), imageModule)
  const bin = join(root, 'bin')
  mkdirSync(bin)
  writeFileSync(
    join(bin, 'docker'),
    '#!/usr/bin/env node\nconsole.log(JSON.stringify(process.argv.slice(2)))\n',
    { mode: 0o755 },
  )
  return { root, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } }
}

function run(mode) {
  const { root, env } = fixture()
  const result = spawnSync(process.execPath, [join(root, 'scripts/terminal-visual/container.mjs'), mode], {
    env,
    encoding: 'utf8',
  })
  expect(result.status, result.stderr).toBe(0)
  return { root, args: JSON.parse(result.stdout.trim().split('\n').at(-1)) }
}

describe('pinned terminal and Markdown visual container', () => {
  it('uses the lockfile-aligned ARM64 Ubuntu Noble image for reproducible checks', () => {
    const lockfile = readFileSync(new URL('../../pnpm-lock.yaml', import.meta.url), 'utf8')
    const rootImporter = lockfile.slice(
      lockfile.indexOf('\n  .:\n'),
      lockfile.indexOf('\n  apps/', lockfile.indexOf('\n  .:\n')),
    )
    const lockedPlaywrightVersion = rootImporter.match(
      /\n      playwright:\n        specifier: [^\n]+\n        version: ([^\s(]+)/,
    )?.[1]
    const { root, args } = run('check')

    expect(PLAYWRIGHT_IMAGE).toMatch(
      new RegExp(`^mcr\\.microsoft\\.com/playwright:v${lockedPlaywrightVersion}-noble@sha256:[a-f0-9]{64}$`),
    )
    expect(args).toContain('--platform=linux/arm64')
    expect(args).toContain(PLAYWRIGHT_IMAGE)
    expect(args).toContain(`TERMINAL_VISUAL_IMAGE=${PLAYWRIGHT_IMAGE}`)
    expect(args).toContain('TERMINAL_VISUAL_MODE=check')
    expect(args).toContain(`${root}:/source:ro`)
    expect(args).toContain(`${root}/packages/terminal-runtime/conformance/baselines/linux-arm64:/terminal-baselines:ro`)
    expect(args).toContain(`${root}/packages/pr-review-ui/src/visual-baselines:/markdown-baselines:ro`)
    expect(args.at(-2)).toBe('bash')
    expect(args.at(-1)).toBe('/source/scripts/terminal-visual/entrypoint.sh')
  })

  it('exposes explicit check and update commands and only update can write baselines', () => {
    const rootPackage = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
    const { root, args } = run('update')

    expect(rootPackage.scripts['terminal:visual:check']).toBe(
      'node scripts/terminal-visual/container.mjs check',
    )
    expect(rootPackage.scripts['terminal:visual:update']).toBe(
      'node scripts/terminal-visual/container.mjs update',
    )
    expect(rootPackage.scripts['markdown:visual']).toBe('pnpm terminal:visual:check')
    expect(rootPackage.scripts['markdown:visual:update']).toBe('pnpm terminal:visual:update')
    expect(args).toContain('TERMINAL_VISUAL_MODE=update')
    expect(args).toContain(`${root}/packages/terminal-runtime/conformance/baselines/linux-arm64:/terminal-baselines`)
    expect(args).toContain(`${root}/packages/pr-review-ui/src/visual-baselines:/markdown-baselines`)
  })

  it('runs both visual suites inside the container in check and update modes', () => {
    const entrypoint = readFileSync(new URL('./entrypoint.sh', import.meta.url), 'utf8')

    expect(entrypoint).toContain('node packages/terminal-runtime/conformance/run.mjs "${terminal_args[@]}"')
    expect(entrypoint).toContain('RUN_MARKDOWN_VISUALS=1 pnpm exec vitest run packages/pr-review-ui/src/RichMarkdownDiff.visual.test.ts')
    expect(entrypoint).toContain('terminal_args+=(--update-baselines)')
    expect(entrypoint).toContain('export UPDATE_MARKDOWN_VISUALS=1')
  })

  it('rejects mutable or ambiguous host commands before Docker starts', () => {
    const { root, env } = fixture()
    for (const mode of ['', 'test', 'check extra']) {
      const args = mode ? mode.split(' ') : []
      const result = spawnSync(process.execPath, [join(root, 'scripts/terminal-visual/container.mjs'), ...args], {
        env,
        encoding: 'utf8',
      })
      expect(result.status).not.toBe(0)
    }
  })
})
