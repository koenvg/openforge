import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import pixelmatch from 'pixelmatch'
import { chromium, type Browser } from 'playwright'
import { PNG } from 'pngjs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createOpenForgePluginSdkSourceAliases } from '../../../../packages/plugin-sdk/src/vite'
import { createDaisyUiTailwindPluginAliases } from '../../../lib/viteDaisyUi'
import { createServer, type ViteDevServer } from 'vite'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const harnessPath = '/src/components/shared/ui/visual/index.html'
const baselineDirectory = join(repoRoot, 'src/components/shared/ui/visual-baselines')
const artifactDirectory = join(repoRoot, 'screenshots/interaction-overlays')
const updateBaselines = process.env.UPDATE_INTERACTION_VISUALS === '1'
const runsInteractionVisuals = process.env.RUN_INTERACTION_VISUALS === '1'

let server: ViteDevServer
let browser: Browser
let origin: string

beforeAll(async () => {
  if (!runsInteractionVisuals) return
  server = await createServer({
    configFile: false,
    root: repoRoot,
    logLevel: 'error',
    plugins: [tailwindcss(), svelte()],
    resolve: {
      alias: [
        ...createOpenForgePluginSdkSourceAliases(repoRoot),
        ...createDaisyUiTailwindPluginAliases(),
      ],
    },
    server: { host: '127.0.0.1', port: 0 },
  })
  await server.listen()

  const localUrl = server.resolvedUrls?.local[0]
  if (!localUrl) throw new Error('Interaction visual test server did not expose a local URL')
  origin = localUrl.replace(/\/$/, '')
  browser = await chromium.launch({ headless: true })
}, 60_000)

afterAll(async () => {
  await browser?.close()
  await server?.close()
})

describe.skipIf(!runsInteractionVisuals)('interaction overlay visuals', () => {
  for (const theme of ['light', 'dark'] as const) {
    it(`covers scrollable and stacked dialogs in the ${theme} theme`, async () => {
      const page = await browser.newPage({
        deviceScaleFactor: 1,
        viewport: { width: 1000, height: 760 },
        colorScheme: theme,
        reducedMotion: 'reduce',
      })

      try {
        await page.goto(`${origin}${harnessPath}?theme=${theme}`)
        await page.evaluate(() => document.fonts.ready)

        const outerDialog = page.getByRole('dialog', { name: 'Scrollable project settings' })
        const outerSurface = outerDialog.locator('.of-modal-box')
        expect(await outerSurface.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
        compareScreenshot(`scrollable-dialog-${theme}`, await page.screenshot({ animations: 'disabled', caret: 'hide' }))

        const nestedOpener = page.getByRole('button', { name: 'Open review confirmation' })
        await nestedOpener.click()
        const nestedDialog = page.getByRole('dialog', { name: 'Review project changes' })
        await nestedDialog.waitFor()
        expect(await page.getByRole('dialog').count()).toBe(2)
        expect(await nestedDialog.getByRole('button', { name: 'Apply changes' }).evaluate((element) => document.activeElement === element)).toBe(true)
        compareScreenshot(`stacked-dialog-${theme}`, await page.screenshot({ animations: 'disabled', caret: 'hide' }))

        await page.keyboard.press('Escape')
        await nestedDialog.waitFor({ state: 'detached' })
        expect(await page.getByRole('dialog').count()).toBe(1)
        expect(await nestedOpener.evaluate((element) => document.activeElement === element)).toBe(true)
      } finally {
        await page.close()
      }
    }, 30_000)
  }
})

function compareScreenshot(name: string, actualBuffer: Buffer) {
  const baselinePath = join(baselineDirectory, `${name}.png`)
  if (updateBaselines) {
    mkdirSync(baselineDirectory, { recursive: true })
    writeFileSync(baselinePath, actualBuffer)
    return
  }

  expect(
    existsSync(baselinePath),
    `Missing ${baselinePath}. Run UPDATE_INTERACTION_VISUALS=1 pnpm interaction:visual to review and create it.`,
  ).toBe(true)

  const actual = PNG.sync.read(actualBuffer)
  const expected = PNG.sync.read(readFileSync(baselinePath))
  expect({ width: actual.width, height: actual.height }).toEqual({ width: expected.width, height: expected.height })

  const diff = new PNG({ width: actual.width, height: actual.height })
  const changedPixels = pixelmatch(expected.data, actual.data, diff.data, actual.width, actual.height, {
    threshold: 0.1,
  })
  const changedRatio = changedPixels / (actual.width * actual.height)

  if (changedRatio > 0.001) {
    mkdirSync(artifactDirectory, { recursive: true })
    writeFileSync(join(artifactDirectory, `${name}-actual.png`), actualBuffer)
    writeFileSync(join(artifactDirectory, `${name}-diff.png`), PNG.sync.write(diff))
  }

  expect(
    changedRatio,
    `${name} changed by ${(changedRatio * 100).toFixed(3)}%. Inspect ${artifactDirectory}.`,
  ).toBeLessThanOrEqual(0.001)
}
