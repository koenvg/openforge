import { describe, it, expect } from 'vitest'
import { computeTargetPathPreview, canSubmitGithub } from './projectSetupDialogLogic'

describe('computeTargetPathPreview', () => {
  it('joins parent and repo name with a slash', () => {
    expect(computeTargetPathPreview('/Users/you/code', 'widgets')).toBe('/Users/you/code/widgets')
  })

  it('normalizes a trailing slash on the parent', () => {
    expect(computeTargetPathPreview('/Users/you/code/', 'widgets')).toBe('/Users/you/code/widgets')
  })

  it('returns an empty string until both parts are present', () => {
    expect(computeTargetPathPreview('', 'widgets')).toBe('')
    expect(computeTargetPathPreview('/Users/you/code', '')).toBe('')
  })
})

describe('canSubmitGithub', () => {
  it('is true when url + parent are set and not submitting', () => {
    expect(canSubmitGithub({ repoUrl: 'acme/widgets', parentDir: '/tmp', projectName: 'W', isSubmitting: false })).toBe(true)
  })

  it('is false while submitting', () => {
    expect(canSubmitGithub({ repoUrl: 'acme/widgets', parentDir: '/tmp', projectName: 'W', isSubmitting: true })).toBe(false)
  })

  it('is false when url or parent is missing', () => {
    expect(canSubmitGithub({ repoUrl: '', parentDir: '/tmp', projectName: 'W', isSubmitting: false })).toBe(false)
    expect(canSubmitGithub({ repoUrl: 'acme/widgets', parentDir: '', projectName: 'W', isSubmitting: false })).toBe(false)
  })

  it('is false when project name is empty', () => {
    expect(canSubmitGithub({ repoUrl: 'acme/widgets', parentDir: '/tmp', projectName: '  ', isSubmitting: false })).toBe(false)
  })
})
