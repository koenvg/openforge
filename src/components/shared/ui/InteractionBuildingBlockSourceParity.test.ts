import { readdirSync, readFileSync } from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const CANONICAL_ANCHORED_MENU_IMPORT = '@openforge-app/plugin-sdk/ui/AnchoredMenu.svelte'
const CANONICAL_TOOLTIP_IMPORT = '@openforge-app/plugin-sdk/ui/Tooltip.svelte'

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

describe('renderer interaction building block source parity', () => {
  const workspaceRoot = resolve(import.meta.dirname, '../../../..')
  const rendererRoot = join(workspaceRoot, 'src')
  const rendererSvelteFiles = findSvelteFiles(rendererRoot)

  it('routes anchored-menu callers through the canonical plugin SDK export', () => {
    expect(rendererSvelteFiles
      .filter((path) => basename(path) === 'AnchoredMenu.svelte')
      .map((path) => relative(workspaceRoot, path)),
    ).toEqual([])

    const imports = rendererSvelteFiles.flatMap((path) => {
      const source = readFileSync(path, 'utf8')
      return Array.from(source.matchAll(/\bfrom\s+['"]([^'"]+\.svelte)['"]/g), ([, specifier]) => ({
        importer: relative(workspaceRoot, path),
        specifier,
      })).filter(({ specifier }) => basename(specifier) === 'AnchoredMenu.svelte')
    })

    expect(imports.length).toBeGreaterThan(0)
    expect(imports).toEqual(imports.map(({ importer }) => ({
      importer,
      specifier: CANONICAL_ANCHORED_MENU_IMPORT,
    })))
  })

  it('routes tooltip callers through the canonical plugin SDK export', () => {
    expect(rendererSvelteFiles
      .filter((path) => basename(path) === 'HoverTooltip.svelte')
      .map((path) => relative(workspaceRoot, path)),
    ).toEqual([])

    const imports = rendererSvelteFiles.flatMap((path) => {
      const source = readFileSync(path, 'utf8')
      return Array.from(source.matchAll(/\bfrom\s+['"]([^'"]+\.svelte)['"]/g), ([, specifier]) => ({
        importer: relative(workspaceRoot, path),
        specifier,
      })).filter(({ specifier }) => basename(specifier) === 'Tooltip.svelte')
    })

    expect(imports.length).toBeGreaterThan(0)
    expect(imports).toEqual(imports.map(({ importer }) => ({
      importer,
      specifier: CANONICAL_TOOLTIP_IMPORT,
    })))
  })

  it('keeps renderer callers independent of the private headless dependency', () => {
    const directImports = rendererSvelteFiles.flatMap((path) => {
      const source = readFileSync(path, 'utf8')
      return Array.from(source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g), ([, specifier]) => ({
        importer: relative(workspaceRoot, path),
        specifier,
      })).filter(({ specifier }) => specifier === 'bits-ui' || specifier.startsWith('bits-ui/'))
    })

    expect(directImports).toEqual([])
  })
})
