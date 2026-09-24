import assert from 'node:assert/strict'
import { cpSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { chromium } from 'playwright'
import { build, preview } from 'vite'

export async function checkPackedSdkViews({ packageRoot, consumerRoot, installedPackageRoot }) {
  const root = join(consumerRoot, 'sdk-views')
  mkdirSync(root)
  cpSync(join(packageRoot, 'scripts/fixtures/sdk-views/App.svelte'), join(root, 'SdkViewsFixture.svelte'))
  writeFileSync(join(root, 'index.html'), '<div id="app"></div><script type="module">import { mount } from "svelte"; import App from "./SdkViewsFixture.svelte"; mount(App, {target:document.querySelector("#app"), props:{themes:window.sdkViewThemes}})</script>')
  await build({ root, configFile: false, logLevel: 'silent', plugins: [svelte()] })

  const { THEME_TOKEN_CSS_PROPERTIES } = await import(pathToFileURL(join(installedPackageRoot, 'dist/index.js')).href)
  const { default: tokens } = await import(pathToFileURL(join(packageRoot, '../../src/lib/plugin/fixtures/selected-theme/tokens.js')).href)
  const properties = Object.fromEntries(Object.entries(tokens).map(([key, value]) => [THEME_TOKEN_CSS_PROPERTIES[key], value]))
  const themes = [
    { id: 'com.example.ink:ink', properties },
    { id: 'com.example.copper:copper', properties: { ...properties, '--of-surface': '#182337', '--of-border': '#ec72b4', '--of-radius-control': '17px' } },
  ]
  const server = await preview({ root, configFile: false, logLevel: 'silent', preview: { host: '127.0.0.1', port: 0 } })
  let browser
  try {
    browser = await chromium.launch()
    const page = await browser.newPage({ viewport: { width: 640, height: 700 } })
    await page.addInitScript(value => { window.sdkViewThemes = value }, themes)
    await page.goto(server.resolvedUrls.local[0])
    await page.getByRole('heading', { name: 'SDK workspace' }).waitFor()
    assert.equal(await page.getByRole('heading', { name: 'SDK workspace' }).count(), 1)
    assert.equal(await page.getByRole('treeitem', { name: /index.ts/ }).count(), 1)
    await page.getByRole('textbox', { name: 'Draft' }).fill('Preserved draft')
    await page.getByLabel('Theme').selectOption(themes[1].id)
    assert.equal(await page.getByRole('textbox', { name: 'Draft' }).inputValue(), 'Preserved draft')
    assert.equal(await page.locator('.of-page-header').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(24, 35, 55)')
    assert.equal(await page.locator('[data-task-info-card]').evaluate(el => getComputedStyle(el).borderTopLeftRadius), '17px')
    await page.getByRole('treeitem', { name: /index.ts/ }).click()
    assert.equal(await page.getByRole('treeitem', { name: /index.ts/ }).getAttribute('aria-selected'), 'true')
    await page.getByRole('button', { name: 'Details' }).click()
    assert.equal(await page.getByRole('button', { name: 'Details' }).getAttribute('aria-expanded'), 'false')
    assert.ok((await page.locator('.of-page-header').boundingBox()).height >= 40)
    console.log('Packed SDK views render and switch themes without host utility CSS; tree and collapse actions remain usable.')
  } finally {
    await browser?.close()
    await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()))
  }
}
