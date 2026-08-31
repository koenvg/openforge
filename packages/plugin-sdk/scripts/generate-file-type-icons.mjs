// Copies the curated set of Material icons from the (dev-only) vscode-material-icons
// package into src/ui/icons/ so the SDK is self-contained (no runtime asset URLs).
//
// NAMES must stay in sync with BUNDLED_ICON_NAMES in src/fileIcons.ts. The
// "vendors exactly the bundled set" test in src/fileIcons.test.ts fails loudly
// if they drift. Re-run after editing the icon maps:
//   pnpm --filter @openforge-app/plugin-sdk run icons:generate
import { createRequire } from 'node:module'
import { copyFile, mkdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Keep alphabetically sorted; mirrors BUNDLED_ICON_NAMES.
const NAMES = [
  'c', 'console', 'cpp', 'csharp', 'css', 'database', 'docker', 'document',
  'file', 'folder', 'folder-open', 'git', 'go', 'graphql', 'h', 'html',
  'image', 'java', 'javascript', 'json', 'kotlin', 'lock', 'markdown',
  'nodejs', 'npm', 'pdf', 'php', 'python', 'react', 'react_ts', 'readme',
  'ruby', 'rust', 'sass', 'settings', 'svelte', 'svg', 'swift', 'tune',
  'typescript', 'typescript-def', 'video', 'vue', 'xml', 'yaml', 'zip',
]

const require = createRequire(import.meta.url)
// exports only "." -> resolve the main entry, then walk up to the package root.
const pkgRoot = dirname(dirname(require.resolve('vscode-material-icons')))
const srcIconsDir = join(pkgRoot, 'generated', 'icons')

const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const outDir = join(packageRoot, 'src', 'ui', 'icons')

await rm(outDir, { recursive: true, force: true })
await mkdir(outDir, { recursive: true })
for (const name of NAMES) {
  await copyFile(join(srcIconsDir, `${name}.svg`), join(outDir, `${name}.svg`))
}
console.log(`Copied ${NAMES.length} icons to ${outDir}`)
