import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const appCss = readFileSync(resolve(process.cwd(), 'src/app.css'), 'utf8')
const globalPath = resolve(process.cwd(), 'src/styles/global-presentation.css')
const globalCss = existsSync(globalPath) ? readFileSync(globalPath, 'utf8') : ''

describe('dependency-free global theme contract', () => {
  it('loads semantic global presentation without the removed adapter or plugin', () => {
    expect(appCss).toContain('@import "./styles/global-presentation.css";')
    expect(appCss).not.toMatch(/@plugin\s+["']daisyui/)
    expect(existsSync(resolve(process.cwd(), 'src/styles/theme-adapter.css'))).toBe(false)
  })

  it('retains the documented font aliases, focus, and reduced-motion policy', () => {
    expect(globalCss).toContain('--font-sans: var(--of-font-sans);')
    expect(globalCss).toContain('--font-mono: var(--of-font-mono);')
    expect(globalCss).toContain('outline: var(--of-focus-width) solid var(--of-focus-ring);')
    expect(globalCss).toContain('outline-offset: var(--of-space1);')
    expect(globalCss).toContain('@media (prefers-reduced-motion: reduce)')
    expect(globalCss).toContain('transition-duration: 0ms !important;')
    expect(globalCss).toContain('animation-duration: 0.01ms !important;')
    expect(appCss).not.toMatch(/:where\([^)]*(?:button|input|select|textarea)[^)]*\):focus-visible/)
    expect(appCss).not.toContain('@media (prefers-reduced-motion: reduce)')
  })
})
