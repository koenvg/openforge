import { describe, it, expect, vi } from 'vitest'
import { API_KEY_STORAGE_KEY, readApiKey, writeApiKey } from './apiKey'

function storageWith(get = vi.fn(), set = vi.fn(), del = vi.fn()) {
  const storage = { global: { get, set, delete: del } } as unknown as Parameters<typeof readApiKey>[0]
  return { storage, get, set, del }
}

describe('readApiKey', () => {
  it('reads the key from global storage', async () => {
    const { storage, get } = storageWith(vi.fn().mockResolvedValue('sk-ant-123'))
    expect(await readApiKey(storage)).toBe('sk-ant-123')
    expect(get).toHaveBeenCalledWith(API_KEY_STORAGE_KEY)
  })

  it('reports an unset key as empty rather than null', async () => {
    const { storage } = storageWith(vi.fn().mockResolvedValue(null))
    expect(await readApiKey(storage)).toBe('')
  })

  it('trims stray whitespace from a pasted key', async () => {
    const { storage } = storageWith(vi.fn().mockResolvedValue('  sk-ant-123\n'))
    expect(await readApiKey(storage)).toBe('sk-ant-123')
  })

  it('treats a whitespace-only key as absent, so Refine stays gated', async () => {
    const { storage } = storageWith(vi.fn().mockResolvedValue('   '))
    expect(await readApiKey(storage)).toBe('')
  })

  it('treats an unreadable store as no key rather than throwing into the UI', async () => {
    const { storage } = storageWith(vi.fn().mockRejectedValue(new Error('store down')))
    expect(await readApiKey(storage)).toBe('')
  })
})

describe('writeApiKey', () => {
  it('stores a trimmed key', async () => {
    const { storage, set } = storageWith(vi.fn(), vi.fn(), vi.fn())
    await writeApiKey(storage, '  sk-ant-123  ')
    expect(set).toHaveBeenCalledWith(API_KEY_STORAGE_KEY, 'sk-ant-123')
  })

  it('clearing the field removes the key instead of storing an empty one', async () => {
    const { storage, set, del } = storageWith(vi.fn(), vi.fn(), vi.fn())
    await writeApiKey(storage, '   ')
    expect(set).not.toHaveBeenCalled()
    expect(del).toHaveBeenCalledWith(API_KEY_STORAGE_KEY)
  })
})
