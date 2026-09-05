import type { StoryEnvironmentAdapter } from './storyEnvironment'

export function createStoryStorageAdapter(
  storage: Storage,
  fixture: Readonly<Record<string, string>> = {},
): StoryEnvironmentAdapter {
  const initial = { ...fixture }
  let previous: Map<string, string> | null = null

  function restore(entries: Record<string, string>): void {
    storage.clear()
    for (const [key, value] of Object.entries(entries)) storage.setItem(key, value)
  }

  return {
    install() {
      if (previous !== null) return
      previous = new Map()
      for (let index = 0; index < storage.length; index++) {
        const key = storage.key(index)!
        previous.set(key, storage.getItem(key)!)
      }
      restore(initial)
    },
    reset() {
      if (previous === null) throw new Error('Story storage adapter must be installed before reset')
      restore(initial)
    },
    dispose() {
      if (previous === null) return
      restore(Object.fromEntries(previous))
      previous = null
    },
  }
}
