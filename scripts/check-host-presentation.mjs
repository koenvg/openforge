import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import {
  compareBaseline,
  cycleThemes,
  loadStory,
  samplePresentationTree,
  writeJsonArtifact,
  writeScreenshotArtifact,
} from './storybook-migration-browser-harness.mjs'

// Compare the same mounted host views before/after a presentation-only migration.
const url = process.env.STORYBOOK_URL
assert.ok(url, 'Set STORYBOOK_URL to this worktree’s pages Storybook')
const dir = resolve(process.env.HOST_PRESENTATION_ARTIFACTS ?? 'artifacts/storybook-visual/host-presentation')
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
      const { page, pageErrors } = await loadStory(browser, { storybookUrl: url, story, width })
      try {
        const target = page.locator(selector).first()
        await target.waitFor()
        const mounted = await target.elementHandle()
        const samples = await cycleThemes(page, {
          mounted,
          sample: async (_page, theme) => {
            const measurements = await samplePresentationTree(target)
            if (theme === 'com.example.ink:ink') {
              await writeScreenshotArtifact(page, `${dir}/${capture ? 'before' : 'after'}-${story}-${width}.png`)
            }
            return measurements
          },
        })
        for (const { theme, snapshot: measurements } of samples) reports.push({ story, width, theme, measurements })
        assert.deepEqual(pageErrors, [], story)
      } finally { await page.close() }
    }
  }
  if (capture) writeJsonArtifact(baselinePath, reports)
  else {
    const before = JSON.parse(readFileSync(baselinePath, 'utf8'))
    assert.equal(reports.length, before.length)
    reports.forEach((report, index) => {
      const comparable = structuredClone(report)
      if (!Object.hasOwn(before[index].measurements, 'hints')) delete comparable.measurements.hints
      compareBaseline(comparable, before[index], `${report.story}/${report.width}/${report.theme}`, {
        requireSameKeys: true,
        ignorePath: path => /\.spinner\.\d+\.(background|borderColor|borderWidth|radius|animation)$/.test(path),
      })
    })
    writeJsonArtifact(`${dir}/after.json`, reports)
  }
  console.log(`${capture ? 'Captured' : 'Verified'} ${reports.length} host presentation cases; geometry tolerance 1 CSS px; ${dir}`)
} finally { await browser.close() }
