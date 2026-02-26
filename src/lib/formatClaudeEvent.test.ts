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

  it('formats assistant event with text content', () => {
    const data = JSON.stringify({
      type: 'assistant',
      content: [{ type: 'text', text: 'Hello world' }],
    })
    const result = formatClaudeEvent('assistant', data)
    expect(result).toContain('Hello world')
    expect(result).toContain('\r\n')
  })

  it('formats assistant event with multiline text', () => {
    const data = JSON.stringify({
      type: 'assistant',
      content: [{ type: 'text', text: 'line1\nline2' }],
    })
    const result = formatClaudeEvent('assistant', data)
    expect(result).toContain('line1\r\nline2')
  })

  it('returns null for assistant event with no text content', () => {
    const data = JSON.stringify({
      type: 'assistant',
      content: [{ type: 'tool_use', name: 'foo' }],
    })
    const result = formatClaudeEvent('assistant', data)
    expect(result).toBeNull()
  })

  it('returns null for assistant event with non-array content', () => {
    const data = JSON.stringify({ type: 'assistant', content: 'not an array' })
    const result = formatClaudeEvent('assistant', data)
    expect(result).toBeNull()
  })

  it('formats tool_use event with name and input preview', () => {
    const data = JSON.stringify({
      type: 'tool_use',
      name: 'Read',
      input: { file_path: '/src/main.ts' },
    })
    const result = formatClaudeEvent('tool_use', data)
    expect(result).toContain('Read')
    expect(result).toContain('file_path=/src/main.ts')
  })

  it('formats tool_use event with no input', () => {
    const data = JSON.stringify({ type: 'tool_use', name: 'Bash' })
    const result = formatClaudeEvent('tool_use', data)
    expect(result).toContain('Bash')
  })

  it('truncates long tool input values', () => {
    const longVal = 'a'.repeat(100)
    const data = JSON.stringify({
      type: 'tool_use',
      name: 'Write',
      input: { content: longVal },
    })
    const result = formatClaudeEvent('tool_use', data)
    expect(result).toContain('...')
    // Should be truncated to 60 chars + ...
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

  it('returns null for unknown event types', () => {
    const data = JSON.stringify({ type: 'result', subtype: 'success' })
    expect(formatClaudeEvent('result', data)).toBeNull()
  })

  it('returns null for invalid JSON', () => {
    expect(formatClaudeEvent('assistant', 'not json')).toBeNull()
  })

  it('returns null for empty data', () => {
    expect(formatClaudeEvent('assistant', '')).toBeNull()
  })
})
