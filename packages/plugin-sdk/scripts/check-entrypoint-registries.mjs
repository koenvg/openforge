#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertOpenForgePluginSdkEntrypointRegistries,
  loadOpenForgePluginSdkTypeScriptPaths,
} from '../src/publicEntrypoints.mjs'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const workspaceRoot = resolve(packageRoot, '../..')

const packageJson = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'))
const pluginSdkTypeScriptPaths = await loadOpenForgePluginSdkTypeScriptPaths(workspaceRoot)

assertOpenForgePluginSdkEntrypointRegistries({
  packageExports: packageJson.exports,
  typeScriptPaths: pluginSdkTypeScriptPaths,
})

console.log('Plugin SDK package exports and root TypeScript paths match the canonical entrypoint manifest.')
