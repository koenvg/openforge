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

function componentSource(componentName: typeof componentNames[number]): string {
  return readFileSync(resolve(import.meta.dirname, `${componentName}.svelte`), 'utf8')
}

function buttonControlSource(): string {
  return readFileSync(resolve(import.meta.dirname, 'ButtonControl.svelte'), 'utf8')
}

function componentStyleSource(componentName: typeof componentNames[number]): string {
  return componentName === 'Button' || componentName === 'IconButton'
    ? buttonControlSource()
    : componentSource(componentName)
}

describe('plugin-sdk core control styling contract', () => {
  it('keeps Button and IconButton variant and interaction styles in one private control', () => {
    const buttonSource = componentSource('Button')
    const iconButtonSource = componentSource('IconButton')

    expect(buttonSource).toContain("from './ButtonControl.svelte'")
    expect(iconButtonSource).toContain("from './ButtonControl.svelte'")
    expect(buttonSource).not.toContain('<style>')
    expect(iconButtonSource).not.toContain('<style>')
  })

  it.each(componentNames)('%s uses scoped OpenForge token styles without utility framework coupling', (componentName) => {
    const source = componentStyleSource(componentName)

    expect(source).toContain('<style>')
    expect(source).toContain('var(--of-')
    expect(source).not.toMatch(/\bbtn(?:-|\b)|--color-/)
  })

  it('references only canonical OpenForge theme properties', () => {
    const canonicalProperties = new Set<string>(Object.values(THEME_TOKEN_CSS_PROPERTIES))
    const referencedProperties = componentNames.flatMap((componentName) =>
      [...componentStyleSource(componentName).matchAll(/var\((--of-[a-z0-9-]+)/g)]
        .map((match) => ({ componentName, property: match[1] })),
    )

    expect(referencedProperties.filter(({ property }) => !canonicalProperties.has(property as `--of-${string}`)))
      .toEqual([])
  })

  it('leaves Panel overflow policy to the caller', () => {
    expect(componentSource('Panel')).not.toContain('overflow: hidden')
  })
})
