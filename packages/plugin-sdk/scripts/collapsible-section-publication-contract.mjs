import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { compile } from 'svelte/compiler'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { chromium } from 'playwright'
import { build, preview } from 'vite'

// Build outside the workspace, using the installed tarball and its public exports.
// This is also a normal installable plugin for desktop-release acceptance testing.
export async function buildCollapsibleSectionPlugin({ packageRoot, consumerRoot, installedPackageRoot }) {
  const root = join(consumerRoot, 'collapsible-section-plugin')
  mkdirSync(root)
  cpSync(join(packageRoot, 'scripts/fixtures/collapsible-section'), root, { recursive: true })
  const { openforgePluginViteExternals } = await import(pathToFileURL(join(installedPackageRoot, 'dist/vite.js')).href)
  await build({
    root, configFile: false, logLevel: 'silent', plugins: [svelte()],
    build: {
      lib: { entry: join(root, 'frontend.ts'), formats: ['es'], fileName: 'frontend', cssFileName: 'spacing-contract' },
      rolldownOptions: { external: openforgePluginViteExternals },
    },
  })
  const manifest = {
    name: '@openforge-test/sdk-spacing-contract', version: '1.0.0', type: 'module',
    openforge: {
      id: 'com.openforge.sdk-spacing-contract', apiVersion: 1,
      displayName: 'SDK spacing contract', description: 'Isolated packed SDK spacing acceptance fixture',
      icon: 'notebook-text', frontend: './dist/frontend.js', frontendStyles: ['./dist/spacing-contract.css'],
      requires: ['views', 'taskPane'],
    },
  }
  writeFileSync(join(root, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  assert.ok(existsSync(join(root, 'dist/spacing-contract.css')), 'Packed CollapsibleSection must emit plugin-owned CSS, not depend on host Tailwind utilities')
  assert.ok(readFileSync(join(root, 'dist/spacing-contract.css'), 'utf8').length > 0, 'Plugin must ship its component CSS')
  return root
}

export async function assertCollapsibleSectionSpacing(section, inset, bodyInset) {
  const toggle = section.getByRole('button').first()
  const body = section.locator(`[id="${await toggle.getAttribute('aria-controls')}"]`)
  const padding = element => element.evaluate(node => {
    const style = getComputedStyle(node)
    return [style.paddingLeft, style.paddingRight]
  })
  assert.deepEqual(await padding(toggle), [inset, inset], 'Header indentation must come from plugin CSS')
  assert.deepEqual(await padding(body), [bodyInset, inset], 'Body indentation must come from plugin CSS')
}

export async function checkPackedCollapsibleSection(options) {
  const pluginRoot = await buildCollapsibleSectionPlugin(options)
  const root = join(options.consumerRoot, 'collapsible-section-host')
  mkdirSync(root)
  // Use the exact built plugin JS/CSS. The browser host supplies only Svelte and theme tokens.
  writeFileSync(join(root, 'index.html'), `<div id="default"></div><div id="inspector" class="task-inspector sdk-inspector-contract"></div><script type="module">
import { mount } from 'svelte'
import { Section } from '../collapsible-section-plugin/dist/frontend.js'
import '../collapsible-section-plugin/dist/spacing-contract.css'
mount(Section, {target:document.querySelector('#default'), props:{title:'Default spacing'}})
mount(Section, {target:document.querySelector('#inspector'), props:{title:'Inspector spacing'}})
</script>`)
  await build({ root, configFile: false, logLevel: 'silent' })
  // Compile the real inspector's scoped overrides, not a handwritten approximation.
  const inspectorSource = readFileSync(join(options.packageRoot, '../../src/components/task-detail/TaskInspectorPanel.svelte'), 'utf8')
  const inspectorCss = compile(inspectorSource, { cssHash: () => 'sdk-inspector-contract' }).css.code
  const server = await preview({ root, configFile: false, logLevel: 'silent', preview: { host: '127.0.0.1', port: 0 } })
  let browser
  try {
    browser = await chromium.launch()
    const page = await browser.newPage({ viewport: { width: 640, height: 700 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(server.resolvedUrls.local[0])
    await page.getByRole('button', { name: 'Default spacing' }).waitFor()
    await page.addStyleTag({ content: ':root { font-size:16px; --of-space4:.5rem; --of-border-width:1px; --of-control-height-touch:44px; }' })
    await page.addStyleTag({ content: inspectorCss })
    const normal = page.getByRole('region', { name: 'Default spacing' })
    const inspector = page.getByRole('region', { name: 'Inspector spacing' })
    for (const width of [640, 320]) {
      await page.setViewportSize({ width, height: 700 })
      await assertCollapsibleSectionSpacing(normal, '12px', '32px')
      await assertCollapsibleSectionSpacing(inspector, '16px', '36px')
    }
    const toggle = inspector.getByRole('button', { name: 'Inspector spacing' })
    await toggle.focus()
    await page.keyboard.press('Enter')
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false')
    assert.equal(await inspector.getByText('SDK spacing body').count(), 0)
    await page.keyboard.press('Space')
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true')
    await assertCollapsibleSectionSpacing(inspector, '16px', '36px')
    assert.deepEqual(errors, [])
    console.log('Packed CollapsibleSection plugin preserves default and inspector indentation without host utility CSS.')
  } finally {
    await browser?.close()
    await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()))
  }
  return pluginRoot
}
