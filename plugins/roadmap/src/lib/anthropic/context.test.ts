import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { clearRepoContextCache, loadRepoContext, truncate } from './context'

function apiWith(readFile: ReturnType<typeof vi.fn>) {
  return { fs: { readFile } } as unknown as Parameters<typeof loadRepoContext>[0]
}

function textFile(content: string) {
  return { type: 'text' as const, content, mimeType: 'text/markdown', size: content.length }
}

const REQUEST = { projectId: 'p1', repo: 'acme/app', repoLabels: ['bug', 'ui'] }

beforeEach(() => {
  clearRepoContextCache()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('truncate', () => {
  it('leaves short text alone', () => {
    expect(truncate('hello', 100)).toBe('hello')
  })

  it('marks text it cuts so the model knows the excerpt is partial', () => {
    const out = truncate('x'.repeat(200), 50)
    expect(out).toContain('…(truncated)')
    expect(out.length).toBeLessThan(200)
  })
})

describe('loadRepoContext', () => {
  it('passes the repo and labels through to the context', async () => {
    const readFile = vi.fn().mockResolvedValue(textFile('# Acme'))
    const ctx = await loadRepoContext(apiWith(readFile), REQUEST)
    expect(ctx.repo).toBe('acme/app')
    expect(ctx.labels).toEqual(['bug', 'ui'])
  })

  it('reads the README off disk rather than over the network', async () => {
    const readFile = vi.fn().mockResolvedValue(textFile('# Acme\nThemeProvider owns theming.'))
    const ctx = await loadRepoContext(apiWith(readFile), REQUEST)
    expect(readFile).toHaveBeenCalledWith({ projectId: 'p1', path: 'README.md' })
    expect(ctx.readme).toContain('ThemeProvider owns theming.')
  })

  it('truncates a long README to keep the prompt bounded', async () => {
    const readFile = vi.fn().mockResolvedValue(textFile('x'.repeat(5000)))
    const ctx = await loadRepoContext(apiWith(readFile), REQUEST)
    expect(ctx.readme).toContain('…(truncated)')
    expect(ctx.readme.length).toBeLessThan(2600)
  })

  it('falls through to other README spellings', async () => {
    const readFile = vi.fn()
      .mockRejectedValueOnce(new Error('not found'))
      .mockResolvedValueOnce(textFile('# lowercase'))
    const ctx = await loadRepoContext(apiWith(readFile), REQUEST)
    expect(ctx.readme).toContain('lowercase')
  })

  it('degrades to an empty README rather than failing the refine', async () => {
    const readFile = vi.fn().mockRejectedValue(new Error('no readme anywhere'))
    const ctx = await loadRepoContext(apiWith(readFile), REQUEST)
    expect(ctx.readme).toBe('')
    expect(ctx.repo).toBe('acme/app')
  })

  it('ignores a README that is not text', async () => {
    const readFile = vi.fn().mockResolvedValue({ type: 'binary', content: '', mimeType: null, size: 10 })
    const ctx = await loadRepoContext(apiWith(readFile), REQUEST)
    expect(ctx.readme).toBe('')
  })

  it('caches the README so a refine and its revisions do not re-read it', async () => {
    const readFile = vi.fn().mockResolvedValue(textFile('# Acme'))
    const api = apiWith(readFile)
    await loadRepoContext(api, REQUEST)
    await loadRepoContext(api, REQUEST)
    expect(readFile).toHaveBeenCalledTimes(1)
  })

  it('re-reads once the cache goes stale', async () => {
    const readFile = vi.fn().mockResolvedValue(textFile('# Acme'))
    const api = apiWith(readFile)
    await loadRepoContext(api, REQUEST)
    vi.advanceTimersByTime(11 * 60 * 1000)
    await loadRepoContext(api, REQUEST)
    expect(readFile).toHaveBeenCalledTimes(2)
  })

  it('keeps a separate README per project', async () => {
    const readFile = vi.fn().mockResolvedValue(textFile('# Acme'))
    const api = apiWith(readFile)
    await loadRepoContext(api, REQUEST)
    await loadRepoContext(api, { ...REQUEST, projectId: 'p2' })
    expect(readFile).toHaveBeenCalledTimes(2)
  })
})
