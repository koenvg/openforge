import { describe, expect, it } from 'vitest'
import { buildTaskPromptPreview, resolveTaskProjectionTitle } from './taskDetail'

describe('Task projection text', () => {
  it('matches Rust preview and fallback-title boundaries', () => {
    const unicode = `${'a'.repeat(119)}😀z`
    expect([...buildTaskPromptPreview(unicode)]).toHaveLength(120)
    expect(buildTaskPromptPreview(unicode).endsWith('😀')).toBe(true)

    const prompt = [
      '[image#1]: data:image/png,not-base64',
      '[image#2]: data:image/png;base64,aaaa',
      'Visible',
      '',
      '   ',
    ].join('\n')
    expect(buildTaskPromptPreview(prompt)).toBe('[image#1]: data:image/png,not-base64\nVisible')
    expect(resolveTaskProjectionTitle('T-1', null, '\nHeading\nBody')).toBe('Heading')
  })
})
