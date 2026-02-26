import { describe, it, expect } from 'vitest'
import { formatClaudeEvent } from './formatClaudeEvent'

describe('formatClaudeEvent', () => {
  it('formats system.init with session_id', () => {
    const data = JSON.stringify({ type: 'system', subtype: 'init', session_id: 'abc123' })
    const result = formatClaudeEvent('system.init', data)
    expect(result).toContain('Session started')
    expect(result).toContain('abc123')
    expect(result).toContain('\r\n')
  })

  it('formats system.init with unknown session_id when missing', () => {
    const data = JSON.stringify({ type: 'system', subtype: 'init' })
    const result = formatClaudeEvent('system.init', data)
    expect(result).toContain('Session started')
    expect(result).toContain('unknown')
  })

  it('formats assistant event with text content (nested under message)', () => {
    const data = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Hello world' }] },
    })
    const result = formatClaudeEvent('assistant', data)
    expect(result).toContain('Hello world')
    expect(result).toContain('\r\n')
  })

  it('formats assistant event with multiline text', () => {
    const data = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'line1\nline2' }] },
    })
    const result = formatClaudeEvent('assistant', data)
    expect(result).toContain('line1\r\nline2')
  })

  it('formats assistant event with tool_use content block', () => {
    const data = JSON.stringify({
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/src/main.ts' } }],
      },
    })
    const result = formatClaudeEvent('assistant', data)
    expect(result).toContain('Read')
    expect(result).toContain('file_path=/src/main.ts')
  })

  it('formats assistant event with mixed text and tool_use blocks', () => {
    const data = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Let me read that file' },
          { type: 'tool_use', name: 'Read', input: { file_path: '/src/main.ts' } },
        ],
      },
    })
    const result = formatClaudeEvent('assistant', data)
    expect(result).toContain('Let me read that file')
    expect(result).toContain('Read')
  })

  it('skips thinking blocks in assistant events', () => {
    const data = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'thinking', thinking: 'Let me think about this...' },
          { type: 'text', text: 'Here is my answer' },
        ],
      },
    })
    const result = formatClaudeEvent('assistant', data)
    expect(result).not.toContain('Let me think')
    expect(result).toContain('Here is my answer')
  })

  it('returns null for assistant event with only thinking blocks', () => {
    const data = JSON.stringify({
      type: 'assistant',
      message: {
        content: [{ type: 'thinking', thinking: 'Hmm...' }],
      },
    })
    const result = formatClaudeEvent('assistant', data)
    expect(result).toBeNull()
  })

  it('returns null for assistant event with no message field', () => {
    const data = JSON.stringify({ type: 'assistant' })
    const result = formatClaudeEvent('assistant', data)
    expect(result).toBeNull()
  })

  it('returns null for assistant event with non-array content', () => {
    const data = JSON.stringify({ type: 'assistant', message: { content: 'not an array' } })
    const result = formatClaudeEvent('assistant', data)
    expect(result).toBeNull()
  })

  it('truncates long tool input values in tool_use blocks', () => {
    const longVal = 'a'.repeat(100)
    const data = JSON.stringify({
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', name: 'Write', input: { content: longVal } }],
      },
    })
    const result = formatClaudeEvent('assistant', data)
    expect(result).toContain('...')
    expect(result!.length).toBeLessThan(longVal.length + 50)
  })

  it('formats tool_result event with string content', () => {
    const data = JSON.stringify({
      type: 'tool_result',
      content: 'File written successfully',
    })
    const result = formatClaudeEvent('tool_result', data)
    expect(result).toContain('File written successfully')
  })

  it('formats tool_result event with content blocks', () => {
    const data = JSON.stringify({
      type: 'tool_result',
      content: [{ type: 'text', text: 'Result content here' }],
    })
    const result = formatClaudeEvent('tool_result', data)
    expect(result).toContain('Result content here')
  })

  it('formats tool_result event with empty content', () => {
    const data = JSON.stringify({ type: 'tool_result' })
    const result = formatClaudeEvent('tool_result', data)
    expect(result).toContain('(result)')
  })

  it('truncates long tool_result content', () => {
    const longContent = 'x'.repeat(300)
    const data = JSON.stringify({ type: 'tool_result', content: longContent })
    const result = formatClaudeEvent('tool_result', data)
    expect(result).toContain('...')
  })

  it('formats result.success with result text', () => {
    const data = JSON.stringify({ type: 'result', subtype: 'success', result: 'All done!' })
    const result = formatClaudeEvent('result.success', data)
    expect(result).toContain('Done')
    expect(result).toContain('All done!')
  })

  it('formats result.success without result text', () => {
    const data = JSON.stringify({ type: 'result', subtype: 'success' })
    const result = formatClaudeEvent('result.success', data)
    expect(result).toContain('Done')
  })

  it('returns null for unknown event types', () => {
    const data = JSON.stringify({ type: 'unknown' })
    expect(formatClaudeEvent('unknown', data)).toBeNull()
  })

  it('returns null for invalid JSON', () => {
    expect(formatClaudeEvent('assistant', 'not json')).toBeNull()
  })

  it('returns null for empty data', () => {
    expect(formatClaudeEvent('assistant', '')).toBeNull()
  })
})
