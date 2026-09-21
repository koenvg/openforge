import { describe, expect, it } from 'vitest'

import { DO_NOT_REVIEW_LABEL, hasDoNotReviewLabel, parseCheckRuns, pluginCatalogGroupKey, splitCheckRuns, type CommandInfo } from './domain'

describe('shared domain helpers', () => {
  it('parses and splits check runs for plugin PR views', () => {
    const checks = parseCheckRuns(JSON.stringify([
      { id: 1, name: 'unit', status: 'completed', conclusion: 'success', html_url: 'https://example.com/1' },
      { id: 2, name: 'lint', status: 'completed', conclusion: 'failure', html_url: 'https://example.com/2' },
    ]))

    expect(splitCheckRuns(checks)).toEqual({
      visible: [{ id: 2, name: 'lint', status: 'completed', conclusion: 'failure', html_url: 'https://example.com/2' }],
      passingCount: 1,
    })
  })
})

describe('hasDoNotReviewLabel', () => {
  const withLabels = (...names: string[]) => ({
    labels: names.map((name) => ({ name, color: 'b60205' })),
  })

  it('is true when the DO NOT REVIEW label is present', () => {
    expect(hasDoNotReviewLabel(withLabels('DO NOT REVIEW'))).toBe(true)
    expect(hasDoNotReviewLabel(withLabels('bug', 'DO NOT REVIEW'))).toBe(true)
  })

  it('matches the label case-insensitively and trimmed', () => {
    expect(hasDoNotReviewLabel(withLabels('do not review'))).toBe(true)
    expect(hasDoNotReviewLabel(withLabels('  Do Not Review  '))).toBe(true)
  })

  it('is false when no DO NOT REVIEW label is present', () => {
    expect(hasDoNotReviewLabel(withLabels('bug', 'enhancement'))).toBe(false)
    expect(hasDoNotReviewLabel(withLabels())).toBe(false)
  })

  it('tolerates a missing or null labels field', () => {
    expect(hasDoNotReviewLabel({})).toBe(false)
    expect(hasDoNotReviewLabel({ labels: null })).toBe(false)
    expect(hasDoNotReviewLabel({ labels: undefined })).toBe(false)
  })

  it('exposes the hard-coded label constant', () => {
    expect(DO_NOT_REVIEW_LABEL).toBe('DO NOT REVIEW')
  })
})

describe('pluginCatalogGroupKey', () => {
  const row = (overrides: Partial<CommandInfo>): CommandInfo => ({
    name: 'skill',
    description: null,
    source: 'skill',
    agent: null,
    origin: 'plugin',
    ...overrides,
  })

  it('keeps skills from different plugins as distinct plugin groups', () => {
    const rows = [
      row({ name: 'review-ui', pluginName: 'frontend-design' }),
      row({ name: 'tdd', pluginName: 'mattpocock-skills' }),
      row({ name: 'project-skill', origin: 'project', pluginName: null }),
    ]

    const pluginGroups = [...new Set(rows.map(pluginCatalogGroupKey).filter((key): key is string => key !== null))]

    expect(pluginGroups).toEqual(['frontend-design', 'mattpocock-skills'])
    expect(pluginGroups).not.toEqual(['plugin'])
  })

  it('does not parse plugin:command names as a substitute for pluginName', () => {
    const command = row({ name: 'impeccable:polish', pluginName: null })

    expect(pluginCatalogGroupKey(command)).toBeNull()
  })
})
