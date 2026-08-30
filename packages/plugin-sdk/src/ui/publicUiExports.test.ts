import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  OPENFORGE_PLUGIN_SDK_PUBLIC_UI_EXPORTS,
  assertOpenForgePluginSdkPublicUiPackageExports,
  createOpenForgePluginSdkPublicUiPackageExports,
} from '../publicUiExports.mjs'
import { createOpenForgePluginSdkSourceAliasRecord } from '../vite'

type PublicUiBoundary =
  | 'renderer internals'
  | 'Electron runtime'
  | 'Electron/preload internals'
  | 'Rust sidecar internals'
  | 'undocumented package internals'

function isWithin(parentPath: string, childPath: string): boolean {
  const relativePath = relative(parentPath, childPath)
  return relativePath === ''
    || (relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath))
}

function collectModuleSpecifiers(source: string): string[] {
  const specifiers: string[] = []
  const scriptPattern = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi
  const moduleSpecifierPattern =
    /(?:\b(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?|\b(?:import|require)\s*\(\s*)(['"])([^'"]+)\1/g
  let scriptMatch: RegExpExecArray | null

  while ((scriptMatch = scriptPattern.exec(source)) !== null) {
    const script = scriptMatch[1]
    if (script === undefined) continue

    for (const specifierMatch of script.matchAll(moduleSpecifierPattern)) {
      const importPath = specifierMatch[2]
      if (importPath !== undefined) specifiers.push(importPath)
    }
  }

  return specifiers
}

function forbiddenPublicUiBoundary(
  importPath: string,
  sourcePath: string,
  packageRoot: string,
  workspaceRoot: string,
): PublicUiBoundary | null {
  if (importPath === 'electron' || importPath.startsWith('electron/')) return 'Electron runtime'
  if (importPath === 'src/electron' || importPath.startsWith('src/electron/')) {
    return 'Electron/preload internals'
  }
  if (importPath === 'src' || importPath.startsWith('src/')) return 'renderer internals'
  if (importPath === 'src-tauri' || importPath.startsWith('src-tauri/')) {
    return 'Rust sidecar internals'
  }
  if (/^@openforge-app\/[^/]+\/src(?:\/|$)/.test(importPath)
    || /^packages\/[^/]+\/src(?:\/|$)/.test(importPath)) {
    return 'undocumented package internals'
  }

  if (!importPath.startsWith('.') && !isAbsolute(importPath)) return null

  const importedPath = resolve(dirname(sourcePath), importPath)
  if (isWithin(resolve(workspaceRoot, 'src/electron'), importedPath)) {
    return 'Electron/preload internals'
  }
  if (isWithin(resolve(workspaceRoot, 'src'), importedPath)) return 'renderer internals'
  if (isWithin(resolve(workspaceRoot, 'src-tauri'), importedPath)) return 'Rust sidecar internals'

  const packagesRoot = resolve(workspaceRoot, 'packages')
  if (isWithin(packagesRoot, importedPath) && !isWithin(packageRoot, importedPath)) {
    const packagePathParts = relative(packagesRoot, importedPath).split(sep)
    if (packagePathParts[1] === 'src') return 'undocumented package internals'
  }

  return null
}

function findPublicUiBoundaryViolations(
  source: string,
  sourcePath: string,
  packageRoot: string,
  workspaceRoot: string,
) {
  return collectModuleSpecifiers(source).flatMap((importPath) => {
    const boundary = forbiddenPublicUiBoundary(importPath, sourcePath, packageRoot, workspaceRoot)
    return boundary ? [{ importPath, boundary }] : []
  })
}

describe('plugin-sdk public UI exports', () => {
  const packageRoot = resolve(import.meta.dirname, '../..')
  const workspaceRoot = resolve(packageRoot, '../..')

  it('defines the complete stable Svelte UI surface in one canonical manifest', () => {
    expect(OPENFORGE_PLUGIN_SDK_PUBLIC_UI_EXPORTS.map(({ componentName }) => componentName)).toEqual([
      'Button',
      'Checkbox',
      'MarkdownContent',
      'ResizablePanel',
      'Modal',
      'PluginPageHeader',
      'PluginPageShell',
      'PluginViewState',
      'PluginSidebarLink',
      'FileTypeIcon',
      'ProjectFileTree',
      'CollapsibleSection',
    ])

    for (const registration of OPENFORGE_PLUGIN_SDK_PUBLIC_UI_EXPORTS) {
      expect(existsSync(resolve(packageRoot, registration.sourcePath)), registration.sourcePath).toBe(true)
    }
  })

  it.each([
    ['renderer internals', '../../../../src/lib/ipc', 'renderer internals'],
    ['Electron runtime', 'electron', 'Electron runtime'],
    ['Electron/preload internals', '../../../../src/electron/preloadApi', 'Electron/preload internals'],
    ['Rust sidecar internals', '../../../../src-tauri/src/main', 'Rust sidecar internals'],
    [
      'relative sibling-package internals',
      '../../../pr-review-ui/src/private',
      'undocumented package internals',
    ],
    [
      'named sibling-package internals',
      '@openforge-app/pr-review-ui/src/private',
      'undocumented package internals',
    ],
  ] as const)('rejects %s', (_name, importPath, boundary) => {
    const sourcePath = resolve(packageRoot, 'src/ui/Example.svelte')
    const source = `<script>const forbiddenModule = import('${importPath}')</script>`

    expect(findPublicUiBoundaryViolations(source, sourcePath, packageRoot, workspaceRoot)).toEqual([
      { importPath, boundary },
    ])
  })

  it('allows imports within the Plugin SDK package', () => {
    const sourcePath = resolve(packageRoot, 'src/ui/Example.svelte')
    const source = `<script>import { renderMarkdown } from '../markdown'</script>`

    expect(findPublicUiBoundaryViolations(source, sourcePath, packageRoot, workspaceRoot)).toEqual([])
  })

  it('keeps every public UI component free of host-private imports', () => {
    const violations = OPENFORGE_PLUGIN_SDK_PUBLIC_UI_EXPORTS.flatMap(({ componentName, sourcePath }) => {
      const absoluteSourcePath = resolve(packageRoot, sourcePath)
      const source = readFileSync(absoluteSourcePath, 'utf8')

      return findPublicUiBoundaryViolations(source, absoluteSourcePath, packageRoot, workspaceRoot)
        .map((violation) => ({ componentName, ...violation }))
    })

    expect(violations).toEqual([])
  })

  it('validates package exports against every canonical public UI registration', () => {
    const packageJson = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')) as {
      exports: Record<string, unknown>
    }

    expect(() => assertOpenForgePluginSdkPublicUiPackageExports(packageJson.exports)).not.toThrow()
    expect(Object.fromEntries(
      Object.entries(packageJson.exports).filter(([subpath]) => subpath.startsWith('./ui/')),
    )).toEqual(createOpenForgePluginSdkPublicUiPackageExports())

    const exportsWithoutFileTypeIcon = { ...packageJson.exports }
    delete exportsWithoutFileTypeIcon['./ui/FileTypeIcon.svelte']
    exportsWithoutFileTypeIcon['./ui/Legacy.svelte'] = './dist/ui/Legacy.svelte'
    expect(() => assertOpenForgePluginSdkPublicUiPackageExports(exportsWithoutFileTypeIcon)).toThrow(
      'Plugin SDK public UI exports drifted from the canonical manifest '
        + '(missing or mismatched: ./ui/FileTypeIcon.svelte -> ./dist/ui/FileTypeIcon.svelte; '
        + 'not in the canonical manifest: ./ui/Legacy.svelte)',
    )
  })

  it('derives copied Svelte assets from the canonical manifest', () => {
    const copyScript = readFileSync(resolve(packageRoot, 'scripts/copy-package-assets.mjs'), 'utf8')

    expect(copyScript).toContain('OPENFORGE_PLUGIN_SDK_PUBLIC_UI_EXPORTS')
    expect(copyScript).toContain('.map(({ sourcePath }) => sourcePath)')
    expect(copyScript).not.toContain("'src/ui/FileTypeIcon.svelte'")
  })

  it('derives source aliases from every canonical public UI registration', () => {
    const aliases = createOpenForgePluginSdkSourceAliasRecord(`${workspaceRoot}/`)

    for (const { importSpecifier, workspaceSourcePath } of OPENFORGE_PLUGIN_SDK_PUBLIC_UI_EXPORTS) {
      expect(aliases[importSpecifier]).toBe(resolve(workspaceRoot, workspaceSourcePath))
    }
  })
})
