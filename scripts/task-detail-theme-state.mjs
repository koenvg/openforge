import assert from 'node:assert/strict'
import { baselineThemeIds, selectBaselineTheme } from './ui-migration-theme-fixtures.mjs'

const terminalModule = `/@fs${new URL('../src/lib/terminalSessionService.ts', import.meta.url).pathname}`
const themeModule = `/@fs${new URL('../src/lib/theme.ts', import.meta.url).pathname}`
const contractModule = `/@fs${new URL('../src/lib/themeContract.ts', import.meta.url).pathname}`

async function terminalContents(page) {
  return page.evaluate(async module => {
    const { terminalDiagnostics } = await import(module)
    return Object.fromEntries(terminalDiagnostics.list().map(key => [key,
      terminalDiagnostics.capturePresentation(key).lines.map(line => line.text).join('\n'),
    ]))
  }, terminalModule)
}

export async function checkMountedTaskState(page, story) {
  const screens = await page.locator('.xterm-screen').elementHandles()
  const contents = screens.length ? await terminalContents(page) : null
  if (story === 'pages-task-detail--active') {
    assert.ok(Object.values(contents).some(text => text.includes('OpenForge agent')), 'The real agent terminal must contain its replay')
  }
  const selected = await page.locator('[aria-selected="true"], [aria-pressed="true"]').allTextContents()
  const diff = page.locator('[aria-label="Code diff panel"]')
  const diffText = await diff.count() ? await diff.textContent() : null
  if (story === 'pages-task-detail--review') assert.ok(diffText?.includes('greet'), 'The mounted diff must contain the reviewed file')
  let input
  if (story === 'pages-task-detail--backlog') {
    await page.getByRole('button', { name: 'Rename task', exact: true }).click()
    input = page.getByRole('textbox', { name: 'Task title', exact: true })
    await input.fill('Keep this unsaved title across themes')
  }
  for (const theme of baselineThemeIds) {
    await selectBaselineTheme(page, theme)
    for (const screen of screens) assert.ok(await screen.evaluate(element => element.isConnected), 'Theme selection must not replace the terminal')
    if (contents) assert.deepEqual(await terminalContents(page), contents, 'Theme selection must preserve terminal contents and session keys')
    if (input) {
      assert.equal(await input.inputValue(), 'Keep this unsaved title across themes')
      assert.ok(await input.evaluate(element => element === document.activeElement), 'Theme selection must retain the editor focus')
    }
    assert.deepEqual(await page.locator('[aria-selected="true"], [aria-pressed="true"]').allTextContents(), selected)
    if (diffText !== null) assert.equal(await diff.textContent(), diffText, 'Theme selection must preserve rendered diff content')
  }
  if (input) await input.press('Escape')

  if (story === 'pages-task-detail--backlog') {
    // The page story mounts TaskDetail directly, so install the app's keyboard listener.
    await page.evaluate(async module => {
      const { setupCommandHeldListeners } = await import(module)
      setupCommandHeldListeners()
    }, `/@fs${new URL('../src/lib/useCommandHeld.svelte.ts', import.meta.url).pathname}`)
    await page.keyboard.down('Meta')
    try {
      const hint = page.locator('kbd').filter({ hasText: /^E$/ })
      await hint.waitFor({ state: 'visible' })
      for (const theme of baselineThemeIds) {
        await selectBaselineTheme(page, theme)
        const comparison = await hint.evaluate(element => {
          const legacy = document.createElement('kbd')
          legacy.className = 'kbd kbd-xs absolute top-2 right-2 bg-base-content/10 text-base-content/40 border-base-content/20 text-[0.55rem] min-w-4 h-4 flex items-center justify-center pointer-events-none z-10'
          legacy.textContent = 'E'
          element.parentElement.append(legacy)
          const measure = node => {
            const style = getComputedStyle(node)
            const bounds = node.getBoundingClientRect()
            return { width: bounds.width, height: bounds.height, color: style.color, background: style.backgroundColor,
              border: style.borderColor, borderWidth: style.borderWidth, radius: style.borderRadius, padding: style.padding, font: style.fontFamily }
          }
          const result = { actual: measure(element), legacy: measure(legacy) }
          legacy.remove()
          return result
        })
        assert.deepEqual(comparison.actual, comparison.legacy, `${theme}: native keyboard hint paint and geometry`)
      }
    } finally { await page.keyboard.up('Meta') }
  }

  const panel = page.getByRole('region', { name: 'Code diff panel', exact: true })
  if (await panel.count()) {
    const before = await panel.evaluate(element => getComputedStyle(element).backgroundColor)
    const mounted = await panel.elementHandle()
    await page.evaluate(async ({ themeModule, contractModule }) => {
      const { themeRegistry } = await import(themeModule)
      const { LIGHT_THEME } = await import(contractModule)
      const id = 'com.example.task-detail:mutable'
      const initial = themeRegistry.registerContributedTheme({ ...LIGHT_THEME, id, label: 'Mutable task theme',
        tokens: { ...LIGHT_THEME.tokens, surface: '#fce5c4' },
      }, { pluginId: 'com.example.task-detail', generation: 1 })
      await themeRegistry.selectTheme(id)
      await initial.dispose()
      themeRegistry.registerContributedTheme({ ...LIGHT_THEME, id, label: 'Mutable task theme',
        tokens: { ...LIGHT_THEME.tokens, surface: '#b0ddd7', accent: '#693f95', radiusControl: '12px' },
      }, { pluginId: 'com.example.task-detail', generation: 2 })
      await themeRegistry.selectTheme(id)
    }, { themeModule, contractModule })
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[aria-label="Code diff panel"]')).backgroundColor === 'rgb(176, 221, 215)')
    assert.notEqual(await panel.evaluate(element => getComputedStyle(element).backgroundColor), before)
    assert.ok(await mounted.evaluate(element => element.isConnected), 'Contributed palette updates must not remount the diff')
  }
}
