import { get, type Writable } from 'svelte/store'
import type { StoryEnvironmentAdapter } from './storyEnvironment'

export function createStoryStoreAdapter<T>(store: Writable<T>, value: T): StoryEnvironmentAdapter {
  const initial = structuredClone(value)
  let original: T
  let installed = false
  return {
    install() {
      if (installed) return
      original = get(store)
      installed = true
      store.set(structuredClone(initial))
    },
    reset() {
      if (!installed) throw new Error('Story store adapter must be installed before reset')
      store.set(structuredClone(initial))
    },
    dispose() {
      if (!installed) return
      installed = false
      store.set(original)
    },
  }
}
