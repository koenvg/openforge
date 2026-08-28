import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PR_REVIEW_GUIDANCE, DEFAULT_PR_WALKTHROUGH_GUIDANCE } from './prGuidanceDefaults'

const here = dirname(fileURLToPath(import.meta.url))
const pluginLib = join(here, '../../plugins/github-sync/src/lib')

// The defaults shown in Settings (core copy) must stay byte-identical to the
// github-sync plugin's runtime fallback, so what a user sees and edits is exactly
// what generation uses when the setting is left alone. If you change one .md,
// change the other.
describe('PR guidance defaults', () => {
  it('mirrors the plugin review guidance byte-for-byte', () => {
    const pluginMd = readFileSync(join(pluginLib, 'reviewGuidance.md'), 'utf8')
    expect(readFileSync(join(here, 'reviewGuidance.md'), 'utf8')).toBe(pluginMd)
    expect(DEFAULT_PR_REVIEW_GUIDANCE).toBe(pluginMd)
  })

  it('mirrors the plugin walkthrough guidance byte-for-byte', () => {
    const pluginMd = readFileSync(join(pluginLib, 'walkthroughGuidance.md'), 'utf8')
    expect(readFileSync(join(here, 'walkthroughGuidance.md'), 'utf8')).toBe(pluginMd)
    expect(DEFAULT_PR_WALKTHROUGH_GUIDANCE).toBe(pluginMd)
  })

  // The whole point of splitting these out: a user editing them cannot reach the
  // placeholders that feed the agent the diff, nor the JSON output contract.
  it('carries no template placeholders or output contract', () => {
    for (const guidance of [DEFAULT_PR_REVIEW_GUIDANCE, DEFAULT_PR_WALKTHROUGH_GUIDANCE]) {
      expect(guidance).not.toMatch(/\{\{[A-Z_]+\}\}/)
      expect(guidance).not.toContain('```json')
    }
  })

  it('states a target step count, which nothing else in the prompt does', () => {
    expect(DEFAULT_PR_WALKTHROUGH_GUIDANCE).toMatch(/step count/i)
  })
})
