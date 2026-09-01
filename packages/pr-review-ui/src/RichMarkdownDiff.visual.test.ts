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
        ...createOpenForgePluginSdkSourceAliases(repoRoot),
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

  it('keeps list comment controls inside the document comment gutter', async () => {
    const page = await browser.newPage({
      deviceScaleFactor: 1,
      viewport: { width: 1024, height: 900 },
      colorScheme: 'light',
      reducedMotion: 'reduce',
    })

    try {
      await page.goto(`${origin}${harnessPath}?fixture=prose-and-lists&theme=light&surface=rich-diff`)
      const listBlock = page.locator('.rich-markdown-block-list').first()
      const list = listBlock.locator(':scope > ul, :scope > ol').first()
      const listItem = list.locator(':scope > li').first()
      const commentButton = listBlock.getByRole('button', { name: /Add comment/ }).first()

      const [blockBox, listBox, listItemBox, buttonBox] = await Promise.all([
        listBlock.boundingBox(),
        list.boundingBox(),
        listItem.boundingBox(),
        commentButton.boundingBox(),
      ])

      expect(blockBox).not.toBeNull()
      expect(listBox).not.toBeNull()
      expect(listItemBox).not.toBeNull()
      expect(buttonBox).not.toBeNull()
      expect(buttonBox!.width).toBe(36)
      expect(buttonBox!.x).toBeGreaterThanOrEqual(blockBox!.x)
      expect(buttonBox!.x + buttonBox!.width).toBeLessThanOrEqual(listBox!.x)
      const buttonCenterY = buttonBox!.y + buttonBox!.height / 2
      const listItemCenterY = listItemBox!.y + listItemBox!.height / 2
      expect(Math.abs(buttonCenterY - listItemCenterY)).toBeLessThanOrEqual(4)

      await commentButton.hover()
      const screenshot = await page.getByTestId('markdown-visual').screenshot({
        animations: 'disabled',
        caret: 'hide',
      })
      compareScreenshot('prose-and-lists-comment-gutter-light', screenshot)
    } finally {
      await page.close()
    }
  }, 30_000)

  it('keeps nested list comment controls in the same document gutter', async () => {
    const page = await browser.newPage({
      deviceScaleFactor: 1,
      viewport: { width: 1024, height: 900 },
      colorScheme: 'dark',
      reducedMotion: 'reduce',
    })

    try {
      await page.goto(`${origin}${harnessPath}?fixture=structured-content&theme=dark&surface=rich-diff`)
      const listBlock = page.locator('.rich-markdown-block-list').first()
      const list = listBlock.locator(':scope > ul, :scope > ol').first()
      const commentButtons = listBlock.getByRole('button', { name: /Add comment/ })
      const [blockBox, listBox] = await Promise.all([listBlock.boundingBox(), list.boundingBox()])

      expect(blockBox).not.toBeNull()
      expect(listBox).not.toBeNull()
      expect(await commentButtons.count()).toBe(5)

      for (const commentButton of await commentButtons.all()) {
        const buttonBox = await commentButton.boundingBox()
        expect(buttonBox).not.toBeNull()
        expect(buttonBox!.x).toBeGreaterThanOrEqual(blockBox!.x)
        expect(buttonBox!.x + buttonBox!.width).toBeLessThanOrEqual(listBox!.x)
      }
    } finally {
      await page.close()
    }
  }, 30_000)

  it('preserves structured Markdown in the dark theme', async () => {
    await expectVisualFixture('structured-content', 'dark')
  }, 30_000)

  it('preserves multiple Markdown table layouts', async () => {
    await expectVisualFixture('tables', 'light')
  }, 30_000)

  it('renders Mermaid diagrams in a light Markdown preview', async () => {
    await expectVisualFixture('mermaid-diagrams', 'light', 'preview')
  }, 30_000)

  it('renders Mermaid diagrams in a dark Markdown preview', async () => {
    await expectVisualFixture('mermaid-diagrams', 'dark', 'preview')
  }, 30_000)

  it('shows Mermaid zoom controls in an expanded light preview', async () => {
    await expectVisualFixture('mermaid-diagrams', 'light', 'preview', true)
  }, 30_000)

  it('shows Mermaid zoom controls in an expanded dark preview', async () => {
    await expectVisualFixture('mermaid-diagrams', 'dark', 'preview', true)
  }, 30_000)

  it('renders Mermaid diagrams in a light rich diff', async () => {
    await expectVisualFixture('mermaid-diagrams', 'light', 'rich-diff')
  }, 30_000)

  it('renders Mermaid diagrams in a dark rich diff', async () => {
    await expectVisualFixture('mermaid-diagrams', 'dark', 'rich-diff')
  }, 30_000)
})

async function expectVisualFixture(
  fixture: string,
  theme: 'light' | 'dark',
  surface?: 'preview' | 'rich-diff',
  expanded = false,
) {
  const page = await browser.newPage({
    deviceScaleFactor: 1,
    viewport: { width: 1024, height: 900 },
    colorScheme: theme,
    reducedMotion: 'reduce',
  })
  const externalRequests: string[] = []
  page.on('request', (request) => {
    const url = request.url()
    if (/^https?:/i.test(url) && new URL(url).origin !== new URL(origin).origin) externalRequests.push(url)
  })

  try {
    const surfaceQuery = surface ? `&surface=${surface}` : ''
    await page.goto(`${origin}${harnessPath}?fixture=${fixture}&theme=${theme}${surfaceQuery}`)
    await page.evaluate(() => document.fonts.ready)
    if (fixture === 'mermaid-diagrams') {
      await page.waitForFunction(() => (
        document.querySelectorAll('.mermaid-diagram svg').length === 3
        && document.querySelectorAll('.mermaid-diagram-fallback').length === 2
      ))
    }
    const screenshotTarget = expanded
      ? page.getByRole('dialog', { name: 'Mermaid diagram preview' })
      : page.getByTestId('markdown-visual')
    if (expanded) {
      await page.getByRole('button', { name: 'Expand Mermaid diagram' }).first().click()
      await screenshotTarget.getByRole('button', { name: 'Zoom in' }).click()
      await page.waitForFunction(() => {
        const status = document.querySelector('output[aria-live="polite"]')
        return Boolean(status?.textContent && !status.textContent.startsWith('Fit'))
      })
    }
    const screenshot = await screenshotTarget.screenshot({
      animations: 'disabled',
      caret: 'hide',
    })
    expect(externalRequests, 'Sanitized Markdown must not load external resources').toEqual([])
    const baselineName = [fixture, surface, theme, expanded ? 'expanded' : null]
      .filter(Boolean)
      .join('-')
    compareScreenshot(baselineName, screenshot)
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
