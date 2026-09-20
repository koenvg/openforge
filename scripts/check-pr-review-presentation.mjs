import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { compareBaseline, sampleTargets, writeJsonArtifact, writeScreenshotArtifact } from './storybook-migration-browser-harness.mjs'
import { baselineThemeIds, installBaselineThemes, selectBaselineTheme } from './ui-migration-theme-fixtures.mjs'

const pagesStorybookUrl = process.env.PAGES_STORYBOOK_URL ?? process.env.STORYBOOK_URL
const componentsStorybookUrl = process.env.COMPONENTS_STORYBOOK_URL
assert.ok(pagesStorybookUrl, 'Set PAGES_STORYBOOK_URL to this worktree pages Storybook')
assert.ok(componentsStorybookUrl, 'Set COMPONENTS_STORYBOOK_URL to this worktree components Storybook')
const cdpUrl = process.env.ARC_CDP_URL ?? 'http://127.0.0.1:9222'
const outputDir = resolve(process.env.PR_REVIEW_ARTIFACTS ?? 'artifacts/pr-review-presentation')
const baseline = JSON.parse(readFileSync(resolve('docs/ui-migration-baseline.json'), 'utf8'))
assert.equal(baseline.geometryToleranceCssPx, 1)

const browser = await chromium.connectOverCDP(cdpUrl)
const context = browser.contexts()[0]
assert.ok(context, `Arc did not expose a browser context at ${cdpUrl}`)
const reports = []
const productionStatic = process.env.STATIC_STORYBOOK === '1'
const themeIds = productionStatic ? ['openforge-light'] : baselineThemeIds

async function loadStory(storybookUrl, story, width) {
  const page = await context.newPage()
  await page.setViewportSize({ width, height: 900 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.goto(`${storybookUrl}/iframe.html?id=${story}&viewMode=story&globals=openforgeTheme:openforge-light;openforgeMotion:reduced`)
  await page.waitForFunction(() => ['finished', 'errored'].includes(window.__STORYBOOK_PREVIEW__?.currentRender?.phase))
  assert.equal(await page.evaluate(() => window.__STORYBOOK_PREVIEW__.currentRender.phase), 'finished', story)
  await page.evaluate(() => document.fonts.ready)
  await page.addStyleTag({ content: '* { transition: none !important; }' })
  return { page, pageErrors }
}

async function semanticPaint(locator) {
  return locator.evaluate(element => {
    const style = getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    return {
      bounds: { width: rect.width, height: rect.height },
      color: style.color,
      background: style.backgroundColor,
      border: style.borderTopColor,
      radius: style.borderTopLeftRadius,
      opacity: style.opacity,
    }
  })
}

async function tokenValues(page) {
  return page.evaluate(() => {
    const root = getComputedStyle(document.documentElement)
    const color = name => {
      const sample = document.createElement('span')
      sample.style.color = `var(${name})`
      document.body.append(sample)
      const value = getComputedStyle(sample).color
      sample.remove()
      return value
    }
    return {
      surface: color('--of-surface'),
      surfaceSubtle: color('--of-surface-subtle'),
      text: color('--of-text'),
      border: color('--of-border'),
      accent: color('--of-accent'),
      radiusContainer: root.getPropertyValue('--of-radius-container').trim(),
      radiusControl: root.getPropertyValue('--of-radius-control').trim(),
    }
  })
}

async function verifyDiffView(width) {
  const story = 'pages-task-detail--review'
  const { page, pageErrors } = await loadStory(pagesStorybookUrl, story, width)
  try {
    const target = { id: 'review-file', selector: '[role="treeitem"][aria-label="Select file src/greet.ts"]' }
    const mounted = await page.locator(target.selector).elementHandle()
    assert.ok(mounted)
    if (!productionStatic) await installBaselineThemes(page)
    for (const theme of themeIds) {
      if (!productionStatic) await selectBaselineTheme(page, theme)
      assert.ok(await mounted.evaluate(element => element.isConnected), 'Theme selection replaced the mounted review file')
      const snapshot = await sampleTargets(page, [target])
      const expected = baseline.reports.find(report => report.story === story && report.viewport.width === width && report.theme === theme)
      assert.ok(expected, `Missing approved ${story}/${width}/${theme} baseline`)
      const actualElement = snapshot.elements[0]
      const expectedElement = expected.snapshot.elements[0]
      compareBaseline(actualElement.bounds.width, expectedElement.bounds.width, `${story}/${width}/${theme}/bounds.width`)
      compareBaseline(actualElement.bounds.height, expectedElement.bounds.height, `${story}/${width}/${theme}/bounds.height`)
      for (const property of ['color', 'background', 'border', 'radius', 'font', 'fontSize', 'lineHeight', 'opacity', 'display']) {
        compareBaseline(actualElement[property], expectedElement[property], `${story}/${width}/${theme}/${property}`)
      }
      const beforePoison = await semanticPaint(page.locator(target.selector))
      const poison = await page.addStyleTag({ content: `${target.selector} { --color-base-100: #ff00ff !important; --color-base-content: #ff00ff !important; --color-primary: #ff00ff !important; --chip-running-bg: #ff00ff !important; }` })
      assert.deepEqual(await semanticPaint(page.locator(target.selector)), beforePoison, `${theme}: review file still depends on legacy variables`)
      await poison.evaluate(element => element.remove())
      reports.push({ story, width, theme, snapshot })
    }
    assert.equal(await page.getByRole('button', { name: 'Collapse diff for src/greet.ts' }).getAttribute('aria-expanded'), 'true')
    await page.getByRole('button', { name: 'Unified diff view' }).click()
    assert.equal(await page.getByRole('button', { name: 'Unified diff view' }).getAttribute('aria-pressed'), 'true')
    await page.getByRole('button', { name: 'Split diff view' }).click()
    assert.equal(await page.getByRole('button', { name: 'Split diff view' }).getAttribute('aria-pressed'), 'true')
    assert.deepEqual(pageErrors, [], `${story} browser errors`)
  } finally {
    await page.close()
  }
}

async function verifyOverview(width) {
  const story = 'components-pr-review-overview--populated'
  const { page, pageErrors } = await loadStory(componentsStorybookUrl, story, width)
  try {
    const author = page.getByText('opened this pull request', { exact: true })
    await author.waitFor()
    const overview = author.locator('xpath=../../..')
    const mounted = await overview.elementHandle()
    assert.ok(mounted)
    if (!productionStatic) await installBaselineThemes(page)
    for (const theme of themeIds) {
      if (!productionStatic) await selectBaselineTheme(page, theme)
      assert.ok(await mounted.evaluate(element => element.isConnected), 'Theme selection replaced the mounted review overview')
      const tokens = await tokenValues(page)
      const paint = await semanticPaint(overview)
      assert.equal(paint.background, tokens.surface, `${theme}: overview surface`)
      assert.equal(paint.border, tokens.border, `${theme}: overview border`)
      assert.equal(paint.radius, tokens.radiusContainer, `${theme}: overview radius`)
      assert.ok(paint.bounds.width > 0 && paint.bounds.height > 0, `${theme}: overview bounds`)
      assert.equal(await page.getByText('Please keep the inline comment shortcut readable.', { exact: true }).count(), 1)
      const root = page.locator('[data-testid="pr-review-story-frame"]')
      if (await root.count()) assert.equal(await root.evaluate(element => element.scrollWidth <= element.clientWidth), true, `${theme}: overview horizontal overflow`)
      reports.push({ story, width, theme, paint })
    }
    await writeScreenshotArtifact(page, resolve(outputDir, `overview-${width}.png`))
    assert.deepEqual(pageErrors, [], `${story} browser errors`)
  } finally {
    await page.close()
  }
}

async function verifyInlineComment(width) {
  const story = 'components-pr-review-inline-comment-form--populated'
  const { page, pageErrors } = await loadStory(componentsStorybookUrl, story, width)
  try {
    const form = page.locator('.review-inline-comment-form')
    await form.waitFor()
    const mounted = await form.elementHandle()
    const textbox = page.getByRole('textbox', { name: 'Inline review comment for src/greet.ts line 12' })
    await textbox.fill('Mounted draft')
    if (!productionStatic) await installBaselineThemes(page)
    for (const theme of themeIds) {
      if (!productionStatic) await selectBaselineTheme(page, theme)
      assert.ok(await mounted.evaluate(element => element.isConnected), 'Theme selection replaced the inline comment form')
      assert.equal(await textbox.inputValue(), 'Mounted draft', `${theme}: edited comment was lost`)
      const tokens = await tokenValues(page)
      const paint = await semanticPaint(form)
      assert.equal(paint.background, tokens.surface, `${theme}: inline comment surface`)
      assert.equal(paint.border, tokens.border, `${theme}: inline comment border`)
      const hints = await page.locator('kbd.key-hint').evaluateAll(elements => elements.map(element => {
        const rect = element.getBoundingClientRect()
        const style = getComputedStyle(element)
        return { tag: element.tagName, width: rect.width, height: rect.height, radius: style.borderTopLeftRadius }
      }))
      assert.equal(hints.length, 2)
      assert.ok(hints.every(hint => hint.tag === 'KBD' && hint.width >= hint.height && hint.height > 0), `${theme}: native keyboard hint geometry`)
      assert.ok(hints.every(hint => hint.radius === tokens.radiusControl), `${theme}: keyboard hint radius`)
      assert.equal(await form.evaluate(element => element.scrollWidth <= element.clientWidth), true, `${theme}: inline comment horizontal overflow`)
      reports.push({ story, width, theme, paint, hints })
    }
    await textbox.focus()
    await page.keyboard.press('Control+Enter')
    await writeScreenshotArtifact(page, resolve(outputDir, `inline-comment-${width}.png`))
    assert.deepEqual(pageErrors, [], `${story} browser errors`)
  } finally {
    await page.close()
  }
}

for (const width of [1280, 1000]) await verifyDiffView(width)
for (const width of [1000, 420]) {
  await verifyOverview(width)
  await verifyInlineComment(width)
}
writeJsonArtifact(resolve(outputDir, 'report.json'), { browser: browser.version(), cdpUrl, geometryToleranceCssPx: 1, reports })
console.log(`Verified ${reports.length} PR review presentation cases in Arc across ${themeIds.length} themes${productionStatic ? ' using production-static Storybook' : ''}`)
process.exit(0)
