import { copyFile, cp, mkdir, readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  OPENFORGE_PLUGIN_SDK_PUBLIC_UI_EXPORTS,
  assertOpenForgePluginSdkPublicUiPackageExports,
} from '../src/publicUiExports.mjs'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const packageJson = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
assertOpenForgePluginSdkPublicUiPackageExports(packageJson.exports)

const rootModuleAssetPaths = (await readdir(join(packageRoot, 'src'), { withFileTypes: true }))
  .filter((entry) => entry.isFile() && (entry.name.endsWith('.mjs') || entry.name.endsWith('.d.mts')))
  .map(({ name }) => `src/${name}`)
  .sort()

const assetPaths = [
  ...rootModuleAssetPaths,
  ...OPENFORGE_PLUGIN_SDK_PUBLIC_UI_EXPORTS.map(({ sourcePath }) => sourcePath),
]
await Promise.all(assetPaths.map(async (assetPath) => {
  const relativeOutputPath = assetPath.replace(/^src\//, '')
  const from = join(packageRoot, assetPath)
  const to = join(packageRoot, 'dist', relativeOutputPath)

  await mkdir(dirname(to), { recursive: true })
  await copyFile(from, to)
}))

// FileTypeIcon.svelte inlines these vendored SVGs via a relative `?raw` glob,
// so the built package must ship them alongside the component.
await cp(
  join(packageRoot, 'src/ui/icons'),
  join(packageRoot, 'dist/ui/icons'),
  { recursive: true },
)
