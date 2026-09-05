import { describe, expect, it } from 'vitest'
import { get, writable } from 'svelte/store'
import { createStoryStoreAdapter } from './storyStoreAdapter'

describe('story store adapter', () => {
  it('isolates mutable Map fixtures, resets edits, and restores the original store', () => {
    const original = new Map([['host', ['existing']]])
    const store = writable(original)
    const fixture = new Map([['project', ['original']]])
    const adapter = createStoryStoreAdapter(store, fixture)
    adapter.install()
    get(store).get('project')!.push('edited')
    expect(fixture.get('project')).toEqual(['original'])
    adapter.reset()
    expect(get(store).get('project')).toEqual(['original'])
    adapter.dispose()
    expect(get(store)).toBe(original)
  })
})
