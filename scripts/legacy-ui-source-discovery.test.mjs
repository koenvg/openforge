import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { inventoryLegacyUiConsumers, readLegacyUiSources } from './check-ui-migration-inventory.mjs'

vi.mock('node:fs', { spy: true })
function withFixture(test) {
  const root = mkdtempSync(resolve(tmpdir(), 'legacy-ui-discovery-'))
  const seed = (path, contents = '<div />') => {
    mkdirSync(dirname(resolve(root, path)), { recursive: true })
    writeFileSync(resolve(root, path), contents)
  }
  try {
    test({ root, seed })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

describe('scoped legacy UI source discovery', () => {
  it('recursively discovers an owner directory and explicitly selected shared files', () => {
    withFixture(({ root, seed }) => {
      seed('plugins/owned/src/nested/New.svelte')
      seed('plugins/owned/src/classes.ts', 'export const paint = "text-error"')
      seed('plugins/owned/package.json', '{"dependencies":{"daisyui":"5"}}')
      seed('plugins/owned/README.md', 'Not executable')
      seed('plugins/other/src/View.svelte')
      seed('storybook/shared/Frame.svelte')
      seed('storybook/shared/Other.svelte')
      const sources = readLegacyUiSources(root, {
        roots: ['plugins/owned', 'storybook/shared/Frame.svelte'],
      })
      expect(sources).toEqual([
        { path: 'plugins/owned/package.json', contents: '{"dependencies":{"daisyui":"5"}}' },
        { path: 'plugins/owned/src/classes.ts', contents: 'export const paint = "text-error"' },
        { path: 'plugins/owned/src/nested/New.svelte', contents: '<div />' },
        { path: 'storybook/shared/Frame.svelte', contents: '<div />' },
      ])
    })
  })
  it('filters owner exclusions before reading and never traverses unrelated directories', () => {
    withFixture(({ root, seed }) => {
      seed('src/nested/Owned.svelte')
      seed('src/nested/Owned.test.ts', 'throw new Error("not presentation")')
      seed('plugins/other/View.svelte')
      readFileSync.mockClear()
      readdirSync.mockClear()
      const sources = readLegacyUiSources(root, {
        roots: ['src'],
        include: path => !path.endsWith('.test.ts'),
      })
      expect(sources).toEqual([{ path: 'src/nested/Owned.svelte', contents: '<div />' }])
      expect(readFileSync.mock.calls.map(([path]) => path)).toEqual([resolve(root, 'src/nested/Owned.svelte')])
      expect(readdirSync.mock.calls.map(([path]) => path)).toEqual([
        resolve(root, 'src'), resolve(root, 'src/nested'),
      ])
    })
  })
  it('preserves source formats and skips generated directories in recursive discovery', () => {
    withFixture(({ root, seed }) => {
      const paths = ['plugins/owned/package.json', ...['svelte', 'css', 'html', 'js', 'jsx', 'ts', 'tsx', 'cjs', 'mjs', 'cts', 'mts']
        .map(extension => `plugins/owned/nested/source.${extension}`)]
      for (const path of paths) seed(path, '')
      for (const directory of ['node_modules', 'dist', 'build', 'coverage', '.git', '.svelte-kit', 'target', 'storybook-static']) {
        seed(`plugins/owned/${directory}/Hidden.svelte`)
      }
      seed('plugins/owned/nested/README.md', 'Not executable')
      expect(readLegacyUiSources(root, { roots: ['plugins/owned'] }).map(source => source.path))
        .toEqual(paths.sort((a, b) => a.localeCompare(b)))
    })
  })

  it('keeps repository-wide defaults and root build inputs without adding new root formats', () => {
    withFixture(({ root, seed }) => {
      for (const directory of ['src', 'packages', 'plugins', 'storybook', 'scripts', 'tests']) seed(`${directory}/View.svelte`)
      seed('package.json', '{}')
      seed('vite.config.ts', 'export default {}')
      seed('index.html', '<div />')
      seed('root.css', '.text-error {}')
      seed('root.jsx', 'export default <div />')
      seed('apps/other/View.svelte')
      expect(readLegacyUiSources(root).map(source => source.path)).toEqual([
        'index.html', 'package.json', 'packages/View.svelte', 'plugins/View.svelte',
        'scripts/View.svelte', 'src/View.svelte', 'storybook/View.svelte', 'tests/View.svelte', 'vite.config.ts',
      ])
      expect(readLegacyUiSources(root, { roots: [] })).toEqual([])
    })
  })

  it('retains owned-source diagnostics for new nested files, parse failures, and build inputs', () => {
    withFixture(({ root, seed }) => {
      seed('plugins/owned/src/new/View.svelte', '<div class="text-error" />')
      seed('plugins/owned/src/new/broken.ts', 'const =')
      seed('plugins/owned/package.json', '{"dependencies":{"daisyui":"5"}}')
      seed('storybook/shared/Frame.svelte', '<div class={external} />')
      const records = inventoryLegacyUiConsumers(readLegacyUiSources(root, {
        roots: ['plugins/owned', 'storybook/shared/Frame.svelte'],
      }))
      expect(records).toEqual([
        expect.objectContaining({ path: 'plugins/owned/package.json', kind: 'build-input', token: 'daisyui', line: 1 }),
        expect.objectContaining({ path: 'plugins/owned/src/new/broken.ts', kind: 'unresolved', token: expect.stringContaining('Parse error:'), line: 1 }),
        expect.objectContaining({ path: 'plugins/owned/src/new/View.svelte', kind: 'color', token: 'text-error', replacement: 'text-of-danger', line: 1 }),
        expect.objectContaining({ path: 'storybook/shared/Frame.svelte', kind: 'unresolved', token: 'class={external}', line: 1 }),
      ])
    })
  })
})
