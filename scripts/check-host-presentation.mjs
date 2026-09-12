import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { baselineThemeIds, installBaselineThemes, selectBaselineTheme } from './ui-migration-theme-fixtures.mjs'

// Compare the same mounted host views before/after a presentation-only migration.
const url = process.env.STORYBOOK_URL
assert.ok(url, 'Set STORYBOOK_URL to this worktree’s pages Storybook')
const dir = resolve(process.env.HOST_PRESENTATION_ARTIFACTS ?? 'artifacts/storybook-visual/host-presentation')
mkdirSync(dir, { recursive: true })
const baselinePath = resolve(process.env.HOST_PRESENTATION_BASELINE ?? `${dir}/before.json`)
const capture = process.argv.includes('--capture')
const cases = [
  ['pages-global-settings--loading', 'main [aria-live="polite"]'],
  ['pages-project-settings--saving', 'main [aria-live="polite"]'],
  ['pages-action-palette--populated', '[role="dialog"]'],
  ['pages-command-palette--populated', '[role="dialog"]'],
  ['pages-focus-board--populated', 'main'],
]
const browser = await chromium.launch({ headless: true })
const reports = []
try {
  for (const [story, selector] of cases) {
    for (const width of [1280, 1000]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' })
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      try {
        await page.goto(`${url}/iframe.html?id=${story}&viewMode=story&globals=openforgeTheme:openforge-light;openforgeMotion:reduced`)
        await page.waitForFunction(() => ['finished', 'errored'].includes(window.__STORYBOOK_PREVIEW__?.currentRender?.phase))
        assert.equal(await page.evaluate(() => window.__STORYBOOK_PREVIEW__.currentRender.phase), 'finished', story)
        const target = page.locator(selector).first()
        await target.waitFor()
        await page.evaluate(() => document.fonts.ready)
        await page.addStyleTag({ content: '* { transition: none !important; }' })
        await installBaselineThemes(page)
        const mounted = await target.elementHandle()
        for (const theme of baselineThemeIds) {
          await selectBaselineTheme(page, theme)
          assert.ok(await mounted.evaluate(node => node.isConnected), 'Theme selection must preserve mounted views')
          const measurements = await target.evaluate(root => {
            const measure = element => {
              const box = element.getBoundingClientRect(), css = getComputedStyle(element)
              return { x: box.x, y: box.y, width: box.width, height: box.height, color: css.color, background: css.backgroundColor,
                borderColor: css.borderTopColor, borderWidth: css.borderTopWidth, radius: css.borderTopLeftRadius,
                font: css.fontFamily, fontSize: css.fontSize, animation: css.animationName }
            }
            return { root: measure(root), spinner: [...root.querySelectorAll('.loading, [data-size]')].filter(el => el.tagName === 'SPAN').map(measure),
              hints: [...root.querySelectorAll('kbd')].map(measure),
              controls: [...root.querySelectorAll('button, input, [role="option"]')].map(measure) }
          })
          reports.push({ story, width, theme, measurements })
          if (theme === 'com.example.ink:ink') await page.screenshot({ path: `${dir}/${capture ? 'before' : 'after'}-${story}-${width}.png` })
        }
        assert.deepEqual(errors, [], story)
      } finally { await page.close() }
    }
  }
  if (capture) writeFileSync(baselinePath, JSON.stringify(reports, null, 2) + '\n')
  else {
    const before = JSON.parse(readFileSync(baselinePath, 'utf8'))
    assert.equal(reports.length, before.length)
    const compare = (actual, expected, location) => {
      // The SDK replaces a masked fill with a currentColor ring. Compare its
      // visible ink and bounds, not the old mask's background/border mechanism.
      if (/\.spinner\.\d+\.(background|borderColor|borderWidth|radius|animation)$/.test(location)) return
      if (typeof expected === 'number') assert.ok(Math.abs(actual - expected) <= 1, `${location}: ${actual} vs ${expected}`)
      else if (expected && typeof expected === 'object') {
        // Earlier color-migration captures predate the separate keyboard-hint baseline.
        if (location.endsWith('.measurements') && !Object.hasOwn(expected, 'hints')) {
          const { hints, ...originalMeasurements } = actual
          actual = originalMeasurements
        }
        assert.deepEqual(Object.keys(actual), Object.keys(expected), location)
        for (const key of Object.keys(expected)) compare(actual[key], expected[key], `${location}.${key}`)
      } else assert.equal(actual, expected, location)
    }
    reports.forEach((report, index) => compare(report, before[index], `${report.story}/${report.width}/${report.theme}`))
    writeFileSync(`${dir}/after.json`, JSON.stringify(reports, null, 2) + '\n')
  }
  console.log(`${capture ? 'Captured' : 'Verified'} ${reports.length} host presentation cases; geometry tolerance 1 CSS px; ${dir}`)
} finally { await browser.close() }
