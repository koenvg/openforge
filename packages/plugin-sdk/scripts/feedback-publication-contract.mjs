import assert from 'node:assert/strict'
import { cpSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { chromium } from 'playwright'
import { build, preview } from 'vite'
import { assertFeedbackBrowserContract } from './feedback-browser-contract.mjs'

export async function checkPackedFeedback({ packageRoot, consumerRoot, installedPackageRoot, readme }) {
  const root = join(consumerRoot, 'feedback')
  cpSync(join(packageRoot, 'scripts/fixtures/feedback'), root, { recursive: true })
  const example = readme.match(/## Theme-aware feedback\s+[\s\S]*?```svelte\n([\s\S]*?)```/)?.[1]
  assert.ok(example, 'Packed README must document the public feedback imports with an executable example')
  writeFileSync(join(root, 'Example.svelte'), example)
  // Build the published documentation in the same standalone consumer.
  writeFileSync(join(root, 'documentation.html'), '<div id="app"></div><script type="module">import { mount } from "svelte"; import Example from "./Example.svelte"; mount(Example, {target:document.querySelector("#app")})</script>')

  const files = []
  for (const name of ['LoadingIndicator', 'Alert', 'Progress']) {
    const source = readFileSync(join(installedPackageRoot, `dist/ui/${name}.svelte`), 'utf8')
    const script = source.match(/<script lang="ts">([\s\S]*?)<\/script>/)?.[1]
    assert.ok(script, `Packed ${name} must expose typed props`)
    writeFileSync(join(root, `${name}.ts`), `${script}\nexport type { Props }\n`)
    files.push(`./feedback/${name}.ts`)
  }
  files.push('./feedback/public-props.ts')

  await build({
    root, configFile: false, logLevel: 'silent', plugins: [svelte()],
    build: { rolldownOptions: { input: { app: join(root, 'index.html'), documentation: join(root, 'documentation.html') } } },
  })
  const { THEME_TOKEN_CSS_PROPERTIES } = await import(pathToFileURL(join(installedPackageRoot, 'dist/index.js')).href)
  const { default: tokens } = await import(pathToFileURL(join(packageRoot, '../../src/lib/plugin/fixtures/selected-theme/tokens.js')).href)
  const properties = Object.fromEntries(Object.entries(tokens).map(([key, value]) => [THEME_TOKEN_CSS_PROPERTIES[key], value]))
  const themes = [
    { id: 'com.example.ink:ink', properties },
    { id: 'com.example.copper:copper', properties: { ...properties, '--of-accent': '#be551b', '--of-danger': '#dd3311', '--of-radius-container': '0px', '--of-control-height-compact': '32px' } },
  ]
  const server = await preview({ root, configFile: false, logLevel: 'silent', preview: { host: '127.0.0.1', port: 0 } })
  let browser
  try {
    browser = await chromium.launch()
    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } })
    await assertFeedbackBrowserContract(page, server.resolvedUrls.local[0], themes)
    await page.goto(`${server.resolvedUrls.local[0]}documentation.html`)
    await page.getByRole('progressbar', { name: 'Download' }).waitFor()
    assert.equal(await page.getByRole('status').count(), 1)
    assert.equal(await page.getByRole('alert').count(), 0)
    console.log('Packed feedback and README render without Tailwind or daisyUI; mounted theme, motion, native range and retry contracts passed.')
  } finally {
    await browser?.close()
    await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()))
  }
  return files
}
