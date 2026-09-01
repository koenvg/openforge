import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { THEME_TOKEN_CSS_PROPERTIES } from '../../../../src/lib/themeContract'

const componentNames = [
  'Badge',
  'Button',
  'Checkbox',
  'IconButton',
  'Panel',
  'Switch',
  'TextField',
  'Textarea',
] as const

const interactiveComponentNames = [
  'Button',
  'Checkbox',
  'IconButton',
  'Switch',
  'TextField',
  'Textarea',
] as const

function componentSource(componentName: typeof componentNames[number]): string {
  return readFileSync(resolve(import.meta.dirname, `${componentName}.svelte`), 'utf8')
}

describe('plugin-sdk core control styling contract', () => {
  it.each(componentNames)('%s uses scoped OpenForge token styles without utility framework coupling', (componentName) => {
    const source = componentSource(componentName)

    expect(source).toContain('<style>')
    expect(source).toContain('var(--of-')
    expect(source).not.toMatch(/\bbtn(?:-|\b)|--color-/)
  })

  it.each(interactiveComponentNames)('%s keeps focus visible and removes transitions for reduced motion', (componentName) => {
    const source = componentSource(componentName)

    expect(source).toContain(':focus-visible')
    expect(source).toContain('@media (prefers-reduced-motion: reduce)')
    expect(source).toMatch(/transition:\s*none/)
  })

  it('references only canonical OpenForge theme properties', () => {
    const canonicalProperties = new Set<string>(Object.values(THEME_TOKEN_CSS_PROPERTIES))
    const referencedProperties = componentNames.flatMap((componentName) =>
      [...componentSource(componentName).matchAll(/var\((--of-[a-z0-9-]+)/g)]
        .map((match) => ({ componentName, property: match[1] })),
    )

    expect(referencedProperties.filter(({ property }) => !canonicalProperties.has(property as `--of-${string}`)))
      .toEqual([])
  })

  it('keeps primary and danger IconButton interaction states semantic', () => {
    const source = componentSource('IconButton')

    expect(source).toContain("button[data-variant='primary']:active:not(:disabled)")
    expect(source).toContain("button[data-variant='danger']:hover:not(:disabled)")
    expect(source).toContain("button[data-variant='danger']:active:not(:disabled)")
  })

  it.each(['TextField', 'Textarea'] as const)('%s keeps the normal field background when invalid', (componentName) => {
    const source = componentSource(componentName)
    const invalidRule = source.match(/\[aria-invalid='true'\]\s*\{([^}]*)\}/)?.[1] ?? ''

    expect(invalidRule).toContain('border-color: var(--of-field-invalid)')
    expect(invalidRule).not.toContain('background:')
  })

  it('leaves Panel overflow policy to the caller', () => {
    expect(componentSource('Panel')).not.toContain('overflow: hidden')
  })
})
