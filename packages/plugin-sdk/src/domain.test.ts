import { describe, expect, it } from 'vitest'

import { parseCheckRuns, splitCheckRuns } from './domain'

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
