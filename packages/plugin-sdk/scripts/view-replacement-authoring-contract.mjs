import { cpSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { build } from 'vite'

const components = [
  ['Dashboard', 'PluginProjectDashboardReplacementProps'],
  ['TaskDetail', 'PluginTaskDetailReplacementProps'],
]

export async function buildReplacementAuthoringContract({ repoRoot, consumerRoot, external }) {
  const sourceRoot = join(repoRoot, 'packages/plugin-sdk/scripts/fixtures/view-replacements')
  const root = join(consumerRoot, 'view-replacements')
  const documentation = readFileSync(join(repoRoot, 'docs/plugins/view-replacements.md'), 'utf8')
  cpSync(sourceRoot, root, { recursive: true })

  // Documentation is executable fixture source, not a second untested example.
  for (const file of ['metadata.ts', 'frontend.ts', ...components.map(([name]) => `${name}.svelte`)]) {
    const source = readFileSync(join(root, file), 'utf8')
    const language = file.endsWith('.svelte') ? 'svelte' : 'ts'
    if (!documentation.includes(`\`\`\`${language}\n${source}\`\`\``)) {
      throw new Error(`Replacement authoring documentation must contain the current ${file} example.`)
    }
  }

  // Check each Svelte script against the installed public types as well as compiling
  // its template below. Plain tsc does not inspect script blocks in .svelte files.
  for (const [name, props] of components) {
    const source = readFileSync(join(root, `${name}.svelte`), 'utf8')
    const script = source.match(/<script lang="ts">([\s\S]*?)<\/script>/)?.[1]
    if (!script) throw new Error(`Missing typed script in ${name}.svelte`)
    writeFileSync(join(root, `${name}.script.ts`), script)
    writeFileSync(join(root, `${name}.svelte.d.ts`), `import type { Component } from 'svelte'
import type { ${props} } from '@openforge-app/plugin-sdk/frontend'
declare const component: Component<${props}>
export default component
`)
  }

  await build({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [svelte()],
    build: {
      lib: { entry: join(root, 'frontend.ts'), formats: ['es'], fileName: 'frontend' },
      rolldownOptions: { external },
    },
  })
  return [
    './view-replacements/frontend.ts',
    './view-replacements/metadata.ts',
    ...components.map(([name]) => `./view-replacements/${name}.script.ts`),
  ]
}
