import { describe, expect, it } from 'vitest'
import { getTaskTitle } from './taskTitle'

const baseTask = {
  id: 'T-123',
  title: '',
  prompt: '',
}

describe('getTaskTitle', () => {
  it('uses the first non-empty line of the canonical prompt', () => {
    expect(getTaskTitle({ ...baseTask, prompt: '\n  \nFix the bug\nIt is broken' })).toBe('Fix the bug')
  })

  it('handles carriage returns in the canonical prompt', () => {
    expect(getTaskTitle({ ...baseTask, prompt: '\r\n\r\nHello\r\nWorld' })).toBe('Hello')
  })

  it('falls back to the Task id when title and prompt are empty', () => {
    expect(getTaskTitle(baseTask)).toBe('T-123')
    expect(getTaskTitle({ ...baseTask, title: '  ', prompt: '\n \n' })).toBe('T-123')
  })

  it('prefers and trims an explicit title', () => {
    expect(getTaskTitle({ ...baseTask, prompt: 'Prompt', title: '  My Title  ' })).toBe('My Title')
  })

  it('falls back to the prompt when the title is empty', () => {
    expect(getTaskTitle({ ...baseTask, prompt: 'Derived from prompt' })).toBe('Derived from prompt')
  })
})
