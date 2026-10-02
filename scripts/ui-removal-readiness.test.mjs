import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { expect, it } from 'vitest'

const command = resolve(import.meta.dirname, 'check-ui-migration-inventory.mjs')

function withSourceTree(run) {
  const root = mkdtempSync(join(tmpdir(), 'of-removal-readiness-'))
  function seed(path, text) {
    const target = join(root, path)
    mkdirSync(resolve(target, '..'), { recursive: true })
    writeFileSync(target, text)
  }
  seed('scripts/ui-removal-review.json', JSON.stringify({ negativeTests: {}, reviewed: [] }))
  try {
    run({ seed, check: () => spawnSync(process.execPath, [command, '--root', root, '--removal-readiness'], { encoding: 'utf8' }) })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

it('rejects legacy colors in executable stories even outside the production migration roots', () => {
  withSourceTree(({ seed, check }) => {
    seed('storybook/frame.svelte', '<p class="border-error/30 bg-error/10 text-error">Failed</p>')
    const result = check()
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('storybook/frame.svelte:1')
    expect(result.stderr).toContain('border-error/30')
  })
})

it('permits documented negative tests but never exempts executable fixture styles', () => {
  withSourceTree(({ seed, check }) => {
    seed('scripts/guard.test.mjs', 'const negativeSource = "text-error"')
    seed('scripts/ui-removal-review.json', JSON.stringify({
      negativeTests: { 'scripts/guard.test.mjs': 'Intentional rejected color input.' }, reviewed: [],
    }))
    expect(check().status).toBe(0)
    seed('scripts/ui-removal-review.json', JSON.stringify({
      negativeTests: { 'storybook/frame.svelte': 'Not a negative test.' }, reviewed: [],
    }))
    seed('storybook/frame.svelte', '<p class="text-error">Failed</p>')
    const result = check()
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Invalid negative-test exclusion')
  })
})

it('requires exact, counted review of dynamic producers and rejects stale or paint exemptions', () => {
  withSourceTree(({ seed, check }) => {
    seed('src/Forward.svelte', '<script>let className;</script><div class={className}/>')
    const reviewed = [{ path: 'src/Forward.svelte', kind: 'unresolved', token: 'class={className}', count: 1, reason: 'Caller-owned class pass-through.' }]
    seed('scripts/ui-removal-review.json', JSON.stringify({ negativeTests: {}, reviewed }))
    expect(check().status).toBe(0)
    seed('src/Forward.svelte', '<script>let className;</script><div class={className}/><p class={className}/>')
    expect(check().status).toBe(1)
    seed('src/Forward.svelte', '<div/>')
    expect(check().stderr).toContain('Stale reviewed record')
    seed('src/Forward.svelte', '<div class="text-error"/>')
    seed('scripts/ui-removal-review.json', JSON.stringify({ negativeTests: {}, reviewed: [
      { ...reviewed[0], kind: 'color', token: 'text-error' },
    ] }))
    expect(check().stderr).toContain('Invalid reviewed record')
  })
})

it('keeps executable Task Browser stories independent of legacy paint', () => {
  const result = spawnSync(process.execPath, [command, '--legacy-inventory'], { encoding: 'utf8', maxBuffer: 8_000_000 })
  expect(result.status).toBe(0)
  const records = JSON.parse(result.stdout).records.filter(record => [
    'storybook/shared/frames/TaskBrowserModule.svelte',
    'storybook/shared/environment/storyBrowserSurfaceAdapter.ts',
    'storybook/shared/environment/fileViewerMotionAdapter.ts',
    'scripts/capture-sdk-migration-baseline.mjs',
    'scripts/storybook-migration-browser-harness.mjs',
    'scripts/storybook-visual/motion.test.mjs',
    'scripts/ui-migration-baseline-cases.mjs',
    'scripts/ui-migration-baseline-measurements.test.mjs',
  ].includes(record.path) && ['color', 'script-candidate', 'script-selector-candidate', 'build-input'].includes(record.kind))
  expect(records).toEqual([])
}, 30_000)

it('reports script-loaded dependency assets and legacy selector probes as executable inputs', () => {
  withSourceTree(({ seed, check }) => {
    seed('scripts/probe.mjs', `const css = new URL('../node_modules/daisyui/components/loading.css', import.meta.url); document.querySelector('.loading')`)
    const result = check()
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('build-input: ../node_modules/daisyui/components/loading.css')
    expect(result.stderr).toContain('script-selector-candidate: loading')
  })
})

it('rejects restoring the removed Vite dependency resolver through a build entrypoint', () => {
  withSourceTree(({ seed, check }) => {
    seed('vite.config.ts', 'import { createDaisyUiTailwindPluginAliases } from "./src/lib/viteDaisyUi.ts"')
    const result = check()
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('build-input: ./src/lib/viteDaisyUi.ts')
  })
})
