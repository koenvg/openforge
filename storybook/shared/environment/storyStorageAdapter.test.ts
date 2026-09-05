import { expect, it } from 'vitest'
import { createStoryStorageAdapter } from './storyStorageAdapter'

it('isolates persisted layout preferences and restores the host storage', () => {
  const storage = window.localStorage
  storage.clear()
  storage.setItem('host', 'preserve me')
  const adapter = createStoryStorageAdapter(storage, { 'panel-width': '360' })
  try {
    adapter.install()
    expect(storage.getItem('host')).toBeNull()
    storage.setItem('panel-width', '500')
    storage.setItem('task-info-panel-hidden:T-42', '1')
    adapter.reset()
    expect(storage.getItem('panel-width')).toBe('360')
    expect(storage.getItem('task-info-panel-hidden:T-42')).toBeNull()
    adapter.dispose()
    expect(storage.getItem('host')).toBe('preserve me')
    expect(storage.getItem('panel-width')).toBeNull()
  } finally {
    storage.clear()
  }
})
