import { describe, expect, it } from 'vitest'

import { shouldRunMarkdownVisuals } from './markdownVisualExecution'

describe('Markdown visual execution', () => {
  it('runs on Linux when visual capture is explicitly enabled', () => {
    expect(shouldRunMarkdownVisuals({ RUN_MARKDOWN_VISUALS: '1' }, 'linux')).toBe(true)
  })

  it('stays skipped in normal unit runs on every platform', () => {
    expect(shouldRunMarkdownVisuals({}, 'linux')).toBe(false)
    expect(shouldRunMarkdownVisuals({}, 'darwin')).toBe(false)
  })
})
