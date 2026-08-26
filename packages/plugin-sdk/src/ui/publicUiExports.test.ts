import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  OPENFORGE_PLUGIN_SDK_PUBLIC_UI_EXPORTS,
  assertOpenForgePluginSdkPublicUiPackageExports,
  createOpenForgePluginSdkPublicUiPackageExports,
} from '../publicUiExports.mjs'
import { createOpenForgePluginSdkSourceAliasRecord } from '../vite'

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
      'PluginViewState',
      'PluginSidebarLink',
      'FileTypeIcon',
      'CollapsibleSection',
    ])

    for (const registration of OPENFORGE_PLUGIN_SDK_PUBLIC_UI_EXPORTS) {
      expect(existsSync(resolve(packageRoot, registration.sourcePath)), registration.sourcePath).toBe(true)
    }
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
    expect(() => assertOpenForgePluginSdkPublicUiPackageExports(exportsWithoutFileTypeIcon)).toThrow(
      'missing or mismatched: ./ui/FileTypeIcon.svelte -> ./dist/ui/FileTypeIcon.svelte',
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
