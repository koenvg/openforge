#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertOpenForgePluginSdkEntrypointRegistries } from '../src/publicEntrypoints.mjs'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const workspaceRoot = resolve(packageRoot, '../..')

const packageJson = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'))
const typeScriptConfig = JSON.parse(
  (await readFile(resolve(workspaceRoot, 'tsconfig.json'), 'utf8')).replace(/\/\*[\s\S]*?\*\//g, ''),
)
const pluginSdkTypeScriptPaths = Object.fromEntries(
  Object.entries(typeScriptConfig.compilerOptions.paths)
    .filter(([specifier]) => specifier === '@openforge-app/plugin-sdk' || specifier.startsWith('@openforge-app/plugin-sdk/')),
)

assertOpenForgePluginSdkEntrypointRegistries({
  packageExports: packageJson.exports,
  typeScriptPaths: pluginSdkTypeScriptPaths,
})

console.log('Plugin SDK package exports and root TypeScript paths match the canonical entrypoint manifest.')
