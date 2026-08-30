import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  OPENFORGE_PLUGIN_SDK_PUBLIC_ENTRYPOINTS,
  createOpenForgePluginSdkPackageExports,
  createOpenForgePluginSdkTypeScriptPaths,
} from './publicEntrypoints.mjs'
import { createOpenForgePluginSdkSourceAliasRecord } from './vite'

describe('plugin-sdk public entrypoints', () => {
  const packageRoot = resolve(import.meta.dirname, '..')
  const workspaceRoot = resolve(packageRoot, '../..')

  it('registers every public entrypoint in package exports, TypeScript paths, and Vite aliases', () => {
    const packageJson = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')) as {
      exports: Record<string, unknown>
    }
    const typeScriptConfig = JSON.parse(
      readFileSync(resolve(workspaceRoot, 'tsconfig.json'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''),
    ) as { compilerOptions: { paths: Record<string, string[]> } }

    const pluginSdkTypeScriptPaths = Object.fromEntries(
      Object.entries(typeScriptConfig.compilerOptions.paths)
        .filter(([specifier]) => specifier === '@openforge-app/plugin-sdk' || specifier.startsWith('@openforge-app/plugin-sdk/')),
    )

    expect(packageJson.exports).toEqual(createOpenForgePluginSdkPackageExports())
    expect(pluginSdkTypeScriptPaths).toEqual(createOpenForgePluginSdkTypeScriptPaths())
    expect(createOpenForgePluginSdkSourceAliasRecord(`${workspaceRoot}/`)).toEqual(
      Object.fromEntries(
        OPENFORGE_PLUGIN_SDK_PUBLIC_ENTRYPOINTS.map(({ importSpecifier, workspaceSourcePath }) => [
          importSpecifier,
          resolve(workspaceRoot, workspaceSourcePath),
        ]),
      ),
    )
  })

  it('points every canonical entrypoint at a source file', () => {
    for (const { sourcePath } of OPENFORGE_PLUGIN_SDK_PUBLIC_ENTRYPOINTS) {
      expect(existsSync(resolve(packageRoot, sourcePath)), sourcePath).toBe(true)
    }
  })
})
