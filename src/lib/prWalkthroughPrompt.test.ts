import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PR_WALKTHROUGH_PROMPT } from './prWalkthroughPrompt'

const here = dirname(fileURLToPath(import.meta.url))

// The default prompt shown in Settings (core copy) must stay byte-identical to the
// github-sync plugin's runtime fallback, so what a user sees/edits is exactly what
// generation uses when the setting is left at its default. If you change one .md,
// change the other.
describe('DEFAULT_PR_WALKTHROUGH_PROMPT', () => {
  it('is byte-identical to the github-sync plugin walkthrough prompt', () => {
    const coreMd = readFileSync(join(here, 'prWalkthroughPrompt.md'), 'utf8')
    const pluginMd = readFileSync(
      join(here, '../../plugins/github-sync/src/lib/walkthroughPrompt.md'),
      'utf8',
    )
    expect(coreMd).toBe(pluginMd)
    expect(DEFAULT_PR_WALKTHROUGH_PROMPT).toBe(pluginMd)
  })

  it('keeps the placeholders the compiler substitutes', () => {
    expect(DEFAULT_PR_WALKTHROUGH_PROMPT).toContain('{{PR_TITLE}}')
    expect(DEFAULT_PR_WALKTHROUGH_PROMPT).toContain('{{PR_DESCRIPTION}}')
    expect(DEFAULT_PR_WALKTHROUGH_PROMPT).toContain('{{CHANGED_FILES}}')
    expect(DEFAULT_PR_WALKTHROUGH_PROMPT).toContain('{{EXISTING_COMMENTS}}')
    expect(DEFAULT_PR_WALKTHROUGH_PROMPT).toContain('{{JIRA_TICKET}}')
  })
})
