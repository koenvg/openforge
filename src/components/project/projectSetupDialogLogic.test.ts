import { describe, it, expect } from 'vitest'
import { computeTargetPathPreview, canSubmitGithub, canSubmitNewRepo } from './projectSetupDialogLogic'

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

describe('canSubmitNewRepo', () => {
  it('is true when name + parent are set and not submitting', () => {
    expect(canSubmitNewRepo({ name: 'my-idea', parentDir: '/repos', isSubmitting: false })).toBe(true)
  })
  it('is false while submitting', () => {
    expect(canSubmitNewRepo({ name: 'my-idea', parentDir: '/repos', isSubmitting: true })).toBe(false)
  })
  it('is false when name or parent is missing', () => {
    expect(canSubmitNewRepo({ name: '', parentDir: '/repos', isSubmitting: false })).toBe(false)
    expect(canSubmitNewRepo({ name: 'my-idea', parentDir: '', isSubmitting: false })).toBe(false)
  })
})
