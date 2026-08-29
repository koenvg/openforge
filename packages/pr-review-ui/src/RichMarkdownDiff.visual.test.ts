import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import pixelmatch from 'pixelmatch'
import { chromium, type Browser } from 'playwright'
import { PNG } from 'pngjs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type ViteDevServer } from 'vite'
import { createOpenForgePluginSdkSourceAliases } from '../../plugin-sdk/src/vite'
import { createDaisyUiTailwindPluginAliases } from '../../../src/lib/viteDaisyUi'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const harnessPath = '/packages/pr-review-ui/src/visual/index.html'
const baselineDirectory = join(repoRoot, 'packages/pr-review-ui/src/visual-baselines')
const artifactDirectory = join(repoRoot, 'screenshots/markdown-visual')
const updateBaselines = process.env.UPDATE_MARKDOWN_VISUALS === '1'
const runsMarkdownVisuals = process.platform === 'darwin' && process.env.RUN_MARKDOWN_VISUALS === '1'

let server: ViteDevServer
let browser: Browser
let origin: string

beforeAll(async () => {
  if (!runsMarkdownVisuals) return
  server = await createServer({
    configFile: false,
    root: repoRoot,
    logLevel: 'error',
    plugins: [tailwindcss(), svelte()],
    resolve: {
      alias: [
        ...createOpenForgePluginSdkSourceAliases(new URL('../../../', import.meta.url)),
        ...createDaisyUiTailwindPluginAliases(),
      ],
    },
    server: { host: '127.0.0.1', port: 0 },
  })
  await server.listen()

  const localUrl = server.resolvedUrls?.local[0]
  if (!localUrl) throw new Error('Markdown visual test server did not expose a local URL')
  origin = localUrl.replace(/\/$/, '')
  browser = await chromium.launch({ headless: true })
}, 60_000)

afterAll(async () => {
  await browser?.close()
  await server?.close()
})

describe.skipIf(!runsMarkdownVisuals)('Rich Markdown diff visuals', () => {
  it('preserves document spacing for prose and lists', async () => {
    await expectVisualFixture('prose-and-lists', 'light')
  }, 30_000)

  it('preserves structured Markdown in the dark theme', async () => {
    await expectVisualFixture('structured-content', 'dark')
  }, 30_000)

  it('preserves multiple Markdown table layouts', async () => {
    await expectVisualFixture('tables', 'light')
  }, 30_000)
})

async function expectVisualFixture(fixture: string, theme: 'light' | 'dark') {
  const page = await browser.newPage({
    deviceScaleFactor: 1,
    viewport: { width: 1024, height: 900 },
    colorScheme: theme,
    reducedMotion: 'reduce',
  })

  try {
    await page.goto(`${origin}${harnessPath}?fixture=${fixture}&theme=${theme}`)
    await page.evaluate(() => document.fonts.ready)
    const screenshot = await page.getByTestId('markdown-visual').screenshot({
      animations: 'disabled',
      caret: 'hide',
    })
    compareScreenshot(`${fixture}-${theme}`, screenshot)
  } finally {
    await page.close()
  }
}

function compareScreenshot(name: string, actualBuffer: Buffer) {
  const baselinePath = join(baselineDirectory, `${name}.png`)
  if (updateBaselines) {
    mkdirSync(baselineDirectory, { recursive: true })
    writeFileSync(baselinePath, actualBuffer)
    return
  }

  expect(
    existsSync(baselinePath),
    `Missing ${baselinePath}. Run UPDATE_MARKDOWN_VISUALS=1 pnpm markdown:visual to review and create it.`,
  ).toBe(true)

  const actual = PNG.sync.read(actualBuffer)
  const expected = PNG.sync.read(readFileSync(baselinePath))
  const actualDimensions = { width: actual.width, height: actual.height }
  const expectedDimensions = { width: expected.width, height: expected.height }
  if (actual.width !== expected.width || actual.height !== expected.height) {
    mkdirSync(artifactDirectory, { recursive: true })
    writeFileSync(join(artifactDirectory, `${name}-actual.png`), actualBuffer)
  }
  expect(actualDimensions, `Visual dimensions changed for ${name}`).toEqual(expectedDimensions)

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
