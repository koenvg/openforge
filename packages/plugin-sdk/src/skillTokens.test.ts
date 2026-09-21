import { describe, expect, it } from 'vitest'

import { removeNamedSkillTokens, replaceNamedSkillTokens } from './skillTokens'

describe('named skill tokens', () => {
  it('removes a slash token and leaves the rest of the prompt', () => {
    const next = removeNamedSkillTokens('Please /refactor the API and keep this', ['refactor'])

    expect(next).toContain('Please')
    expect(next).toContain('the API and keep this')
    expect(next).not.toMatch(/(^|\s)\/refactor(\s|$)/)
  })

  it('removes a dollar token used by Codex-style prompts', () => {
    const next = removeNamedSkillTokens('Start with $commit then continue', ['commit'])

    expect(next).toContain('Start with')
    expect(next).toContain('then continue')
    expect(next).not.toMatch(/(^|\s)\$commit(\s|$)/)
  })

  it('removes only the named tokens when several are present', () => {
    const next = removeNamedSkillTokens('/refactor the API $commit now /keep-me', ['refactor', 'commit'])

    expect(next).not.toMatch(/(^|\s)\/refactor(\s|$)/)
    expect(next).not.toMatch(/(^|\s)\$commit(\s|$)/)
    expect(next).toMatch(/(^|\s)\/keep-me(\s|$)/)
  })

  it('does not strip free text that looks like a token but is not a whole token', () => {
    const prompt = 'See /refactor-extra and the word refactor in prose'

    expect(removeNamedSkillTokens(prompt, ['refactor'])).toBe(prompt)
  })

  it('replaces a named token without touching the rest of the prompt', () => {
    const next = replaceNamedSkillTokens('Use /refactor then ship', ['refactor'], '/safe')

    expect(next).toContain('/safe')
    expect(next).toContain('then ship')
    expect(next).not.toMatch(/(^|\s)\/refactor(\s|$)/)
  })
})
