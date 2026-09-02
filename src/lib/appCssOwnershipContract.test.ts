import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function stylesheet(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const appCss = stylesheet('src/app.css')

const ownedStylesheets = [
  {
    importRule: '@import "./styles/markdown-and-file-previews.css";',
    source: stylesheet('src/styles/markdown-and-file-previews.css'),
    markers: ['.markdown-body {', '.mermaid-diagram-preview-viewport {', '.file-preview-code {'],
  },
  {
    importRule: '@import "./styles/terminal-presentation.css";',
    source: stylesheet('src/styles/terminal-presentation.css'),
    markers: ['--term-background:', '.zen-cloud-backdrop {', '.shell-terminal-wrapper .xterm,'],
  },
  {
    importRule: '@import "./styles/task-status-states.css";',
    source: stylesheet('src/styles/task-status-states.css'),
    markers: ['--chip-running-bg:', '.running::before {', '.ready-to-merge {', '.vim-focus {'],
  },
  {
    importRule: '@import "./styles/animation-utilities.css";',
    source: stylesheet('src/styles/animation-utilities.css'),
    markers: ['@keyframes border-glow-spin', '@keyframes slide-in-right', '@keyframes zen-cloud-drift', '.recording-pulse {'],
  },
] as const

describe('app stylesheet ownership contract', () => {
  it('imports feature styles after the theme adapter in the declared order', () => {
    const imports = [
      '@import "./styles/theme-adapter.css";',
      ...ownedStylesheets.map(({ importRule }) => importRule),
    ]

    const importIndexes = imports.map(importRule => appCss.indexOf(importRule))
    expect(importIndexes.every(index => index >= 0)).toBe(true)
    expect(importIndexes).toEqual([...importIndexes].sort((left, right) => left - right))
    expect(importIndexes.at(-1)).toBeLessThan(appCss.indexOf('@plugin "daisyui";'))
  })

  it.each(ownedStylesheets)('keeps $importRule rules in its owned stylesheet', ({ source, markers }) => {
    for (const marker of markers) {
      expect(source).toContain(marker)
      expect(appCss).not.toContain(marker)
    }
  })
})
