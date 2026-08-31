import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { INVARIANT_HELP, main } from './e2e-invariants.mjs'

describe('invariant package commands', () => {
  it('registers headed development and invariant package scripts', async () => {
    const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
    expect(packageJson.scripts['e2e:dev']).toBe('node scripts/e2e-invariants.mjs --dev')
    expect(packageJson.scripts['e2e:invariants']).toBe('node scripts/e2e-invariants.mjs')
  })

  it('documents every scenario, reuse consent, retention, timeout, and output option', async () => {
    const log = vi.fn()

    const guide = await readFile(new URL('../docs/live-electron-invariants.md', import.meta.url), 'utf8')
    await expect(main(['--help'], { log })).resolves.toEqual({ status: 'help', scenarioResults: [] })

    expect(log).toHaveBeenCalledWith(INVARIANT_HELP)
    for (const text of [
      'first-attachment',
      'detach-during-recovery',
      'idle-resources',
      '--reuse',
      'OPENFORGE_CHROMIUM_DEBUG_PORT=<port>',
      'OPENFORGE_E2E=1',
      '--allow-terminal-control',
      '--retain',
      '--startup-timeout',
      '--scenario-timeout',
      '--idle-duration',
      '--output',
      'observational by default',
      'matching launch token',
    ]) expect(INVARIANT_HELP).toContain(text)

    const documentedOptions = [...new Set([...guide.matchAll(/--[a-z][a-z-]*/g)].map(match => match[0]))]
    expect(documentedOptions.length).toBeGreaterThan(0)
    for (const option of documentedOptions) expect(INVARIANT_HELP).toContain(option)
    for (const command of ['pnpm e2e:dev', 'pnpm e2e:invariants']) {
      expect(guide).toContain(command)
      expect(INVARIANT_HELP).toContain(command)
    }
  })

  it('runs terminal races on pull requests and keeps the macOS idle gate scheduled or manual', async () => {
    const pullRequestWorkflow = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
    const idleWorkflow = await readFile(new URL('../.github/workflows/live-electron-idle.yml', import.meta.url), 'utf8')
    const pullRequestJob = pullRequestWorkflow.slice(
      pullRequestWorkflow.indexOf('  live-electron-terminal-invariants:'),
    )

    expect(pullRequestJob).toContain('live-electron-terminal-invariants:')
    expect(pullRequestJob).toContain('name: Live Electron Terminal Invariants')
    expect(pullRequestJob).toContain('--scenario first-attachment')
    expect(pullRequestJob).toContain('--scenario detach-during-recovery')
    expect(pullRequestJob).toContain('artifacts/desktop-test/ci-terminal-invariants')
    expect(pullRequestJob).toContain('name: live-electron-terminal-invariants')
    expect(pullRequestJob).toContain('uses: oven-sh/setup-bun@v2')

    expect(idleWorkflow).toContain('schedule:')
    expect(idleWorkflow).toContain('workflow_dispatch:')
    expect(idleWorkflow).not.toContain('pull_request:')
    expect(idleWorkflow).toContain('runs-on: macos-14')
    expect(idleWorkflow).toContain('--scenario idle-resources')
    expect(idleWorkflow).toContain('artifacts/desktop-test/ci-idle-resources')
    expect(idleWorkflow).toContain('name: live-electron-idle-invariant')
    expect(idleWorkflow).toContain('uses: oven-sh/setup-bun@v2')
  })
})
