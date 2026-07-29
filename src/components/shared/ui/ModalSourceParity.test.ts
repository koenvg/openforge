import { readdirSync, readFileSync } from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const CANONICAL_MODAL_IMPORT = '@openforge-app/plugin-sdk/ui/Modal.svelte'

function findSvelteFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory()
      ? findSvelteFiles(path)
      : entry.isFile() && entry.name.endsWith('.svelte')
        ? [path]
        : []
  })
}

describe('renderer Modal source parity', () => {
  const workspaceRoot = resolve(import.meta.dirname, '../../../..')
  const rendererRoot = join(workspaceRoot, 'src')
  const rendererSvelteFiles = findSvelteFiles(rendererRoot)

  it('has no renderer-local Modal implementation that can drift from the plugin SDK', () => {
    expect(rendererSvelteFiles
      .filter((path) => basename(path) === 'Modal.svelte')
      .map((path) => relative(workspaceRoot, path)),
    ).toEqual([])
  })

  it('routes every renderer Modal consumer through the canonical plugin SDK export', () => {
    const modalImports = rendererSvelteFiles.flatMap((path) => {
      const source = readFileSync(path, 'utf8')
      return Array.from(source.matchAll(/\bfrom\s+['"]([^'"]+\.svelte)['"]/g), ([, specifier]) => ({
        importer: relative(workspaceRoot, path),
        specifier,
      })).filter(({ specifier }) => basename(specifier) === 'Modal.svelte')
    })

    expect(modalImports.length).toBeGreaterThan(0)
    expect(modalImports).toEqual(modalImports.map(({ importer }) => ({
      importer,
      specifier: CANONICAL_MODAL_IMPORT,
    })))
  })
})
