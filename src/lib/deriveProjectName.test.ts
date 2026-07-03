import { describe, it, expect } from 'vitest'
import { deriveProjectNameFromPath } from './deriveProjectName'

describe('deriveProjectNameFromPath', () => {
  it('returns the final path segment as the project name', () => {
    expect(deriveProjectNameFromPath('/Users/you/workspace/my-project')).toBe('my-project')
  })

  it('ignores a trailing slash', () => {
    expect(deriveProjectNameFromPath('/Users/you/workspace/my-project/')).toBe('my-project')
  })

  it('ignores multiple trailing slashes', () => {
    expect(deriveProjectNameFromPath('/Users/you/workspace/my-project///')).toBe('my-project')
  })

  it('handles Windows-style backslash separators', () => {
    expect(deriveProjectNameFromPath('C:\\Users\\you\\my-project')).toBe('my-project')
  })

  it('returns an empty string for the filesystem root', () => {
    expect(deriveProjectNameFromPath('/')).toBe('')
  })

  it('returns an empty string for an empty path', () => {
    expect(deriveProjectNameFromPath('')).toBe('')
  })

  it('trims surrounding whitespace from the path', () => {
    expect(deriveProjectNameFromPath('  /Users/you/my-project  ')).toBe('my-project')
  })
})
