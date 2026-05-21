import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))

const assetPaths = [
  'src/svelteHostRuntimeContract.mjs',
  'src/svelteHostRuntimeContract.d.mts',
  'src/ui/MarkdownContent.svelte',
  'src/ui/ResizablePanel.svelte',
]

await Promise.all(assetPaths.map(async (assetPath) => {
  const relativeOutputPath = assetPath.replace(/^src\//, '')
  const from = join(packageRoot, assetPath)
  const to = join(packageRoot, 'dist', relativeOutputPath)

  await mkdir(dirname(to), { recursive: true })
  await copyFile(from, to)
}))
