import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compile } from 'svelte/compiler'
import { describe, expect, it } from 'vitest'

describe('headless component style boundaries', () => {
  it.each([
    ['Modal.svelte', ['of-modal-overlay', 'of-modal-layer', 'of-modal-close']],
    ['Select.svelte', ['of-select-trigger', 'of-select-content', 'of-select-viewport', 'of-select-option']],
    ['Tabs.svelte', ['of-tabs-root', 'of-tabs-list', 'of-tabs-content']],
  ] as const)('keeps classes forwarded to child primitives global in %s', (filename, forwardedClasses) => {
    const source = readFileSync(resolve(import.meta.dirname, filename), 'utf8')
    const css = compile(source, { filename, generate: 'client' }).css?.code ?? ''

    for (const className of forwardedClasses) {
      expect(css, className).toContain(`.${className}`)
      expect(css, className).not.toContain(`.${className}.svelte-`)
      expect(css, className).not.toContain(`(unused) .${className}`)
    }
  })
})
