import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { build } from 'vite'

// Compile and render the shipped example against the installed tarball, not workspace aliases.
export async function assertPackedTextFieldDocumentation(consumerRoot, readme) {
  const example = readme.match(/## Compact toolbar field\s+[\s\S]*?```svelte\n([\s\S]*?)```/)?.[1]
  assert.ok(example, 'Packed README must include the compact toolbar TextField example.')
  const fixtureRoot = join(consumerRoot, 'text-field-documentation')
  mkdirSync(fixtureRoot)
  writeFileSync(join(fixtureRoot, 'Example.svelte'), example)
  writeFileSync(join(fixtureRoot, 'entry.js'), `
import { render } from 'svelte/server'
import Example from './Example.svelte'
export default render(Example).body
`)

  await build({
    root: fixtureRoot,
    configFile: false,
    logLevel: 'silent',
    plugins: [svelte()],
    ssr: { noExternal: ['@openforge-app/plugin-sdk'] },
    build: {
      ssr: join(fixtureRoot, 'entry.js'),
      outDir: join(fixtureRoot, 'dist'),
      rolldownOptions: { output: { entryFileNames: 'example.js' } },
    },
  })
  const { default: html } = await import(pathToFileURL(join(fixtureRoot, 'dist', 'example.js')).href)
  const dom = new JSDOM(html)
  try {
    const input = dom.window.document.querySelector('input')
    assert.ok(input, 'The documented field must render a native input.')
    assert.equal(input.labels?.[0]?.textContent, 'Filter tasks')
    assert.equal(input.labels[0].hidden, false)
    assert.equal(input.name, 'query')
    assert.equal(input.hasAttribute('labelHidden'), false)
    assert.equal(input.hasAttribute('size'), false)
    assert.equal(dom.window.document.querySelector('svg')?.getAttribute('aria-hidden'), 'true')
    const clear = dom.window.document.querySelector('button')
    assert.equal(clear?.textContent.trim(), 'Clear')
    assert.equal(clear?.type, 'button')
    assert.equal(clear?.getAttribute('aria-label'), 'Clear filter')
  } finally {
    dom.window.close()
  }
}
