// The Anthropic API key powering Refine, kept in plugin-global storage.
//
// The settings section writes it and the backend reads it, so the storage key and
// the empty/absent rules live here rather than being restated at both ends: the
// dialog gates Refine on "is there a key", and that answer has to match what the
// backend will actually find when it goes to call the API.
//
// NOTE: plugin storage is not encrypted at rest — the key lands in the app's SQLite
// database as plain text. The SDK exposes no keychain or secrets capability, so this
// is the strongest option available to a plugin.

import type { PluginStorage } from '@openforge-app/plugin-sdk'

export const API_KEY_STORAGE_KEY = 'anthropicApiKey'

/**
 * The stored key, or '' when there is none. Whitespace-only is treated as absent so a
 * key the user blanked out can't leave Refine enabled but failing at call time.
 */
export async function readApiKey(storage: PluginStorage): Promise<string> {
  try {
    const value = await storage.global.get<string>(API_KEY_STORAGE_KEY)
    return typeof value === 'string' ? value.trim() : ''
  } catch {
    // A store we can't read is indistinguishable from an unset key from the UI's
    // point of view, and gating Refine beats throwing during a settings render.
    return ''
  }
}

/** Stores a trimmed key, or removes it entirely when the field is cleared. */
export async function writeApiKey(storage: PluginStorage, key: string): Promise<void> {
  const trimmed = key.trim()
  if (trimmed) await storage.global.set(API_KEY_STORAGE_KEY, trimmed)
  else await storage.global.delete(API_KEY_STORAGE_KEY)
}
