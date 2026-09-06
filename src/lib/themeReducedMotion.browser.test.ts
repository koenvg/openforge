// @vitest-environment node
import { readFileSync } from 'node:fs'
import { chromium, type Browser } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const themeAdapterCss = readFileSync(new URL('../styles/theme-adapter.css', import.meta.url), 'utf8')
let browser: Browser

beforeAll(async () => {
  browser = await chromium.launch({ headless: true })
})

afterAll(async () => {
  await browser?.close()
})

describe('global reduced motion in Chromium', () => {
  it.each(['no-preference', 'reduce'] as const)(
    'applies plain element color changes immediately with %s motion',
    async (reducedMotion) => {
      const page = await browser.newPage({ reducedMotion })
      try {
        await page.setContent('<div>Theme token probe</div>')
        await page.addStyleTag({ content: themeAdapterCss })
        const colors = await page.locator('div').evaluate((element) => {
          element.style.color = 'rgb(255, 0, 0)'
          const initial = getComputedStyle(element).color
          element.style.color = 'rgb(0, 0, 255)'
          const updated = getComputedStyle(element).color
          element.style.color = 'rgb(0, 128, 0)'
          return [initial, updated, getComputedStyle(element).color]
        })
        expect(colors).toEqual(['rgb(255, 0, 0)', 'rgb(0, 0, 255)', 'rgb(0, 128, 0)'])
      } finally {
        await page.close()
      }
    },
  )

  it.each(['no-preference', 'reduce'] as const)(
    'preserves control motion preferences with %s motion',
    async (reducedMotion) => {
      const page = await browser.newPage({ reducedMotion })
      try {
        await page.setContent(`
          <style>
            @keyframes pulse { to { transform: scale(1.1); } }
            button, button::before, button::after {
              content: '';
              display: block;
              transition: opacity 2s 1s;
              animation: pulse 2s 1s infinite both;
              scroll-behavior: smooth;
            }
          </style>
          <button>Animated control</button>
        `)
        await page.addStyleTag({ content: themeAdapterCss })
        const styles = await page.getByRole('button').evaluate((element) =>
          [null, '::before', '::after'].map((pseudo) => {
            const style = getComputedStyle(element, pseudo)
            return {
              transitionDuration: parseFloat(style.transitionDuration),
              transitionDelay: parseFloat(style.transitionDelay),
              animationDuration: parseFloat(style.animationDuration),
              animationDelay: parseFloat(style.animationDelay),
              animationIterations: style.animationIterationCount,
              scrollBehavior: style.scrollBehavior,
            }
          }),
        )
        const reduced = reducedMotion === 'reduce'
        for (const style of styles) {
          expect(style).toEqual({
            transitionDuration: reduced ? 0 : 2,
            transitionDelay: reduced ? 0 : 1,
            animationDuration: reduced ? 0.00001 : 2,
            animationDelay: reduced ? 0 : 1,
            animationIterations: reduced ? '1' : 'infinite',
            scrollBehavior: reduced ? 'auto' : 'smooth',
          })
        }
        if (reduced) {
          // Keep a finite animation so completion-dependent controls can still finish.
          expect(await page.getByRole('button').evaluate(async (element) => {
            const animations = element.getAnimations({ subtree: true })
            await Promise.all(animations.map((animation) => animation.finished))
            return animations.length === 3 && animations.every((animation) => animation.playState === 'finished')
          })).toBe(true)
        }
      } finally {
        await page.close()
      }
    },
  )
})
