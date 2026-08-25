import { getMergeReadiness } from './types'
import type { PullRequestInfo, PullRequestMergeMethod } from './types'

export type PullRequestActionKind = 'merge' | 'enqueue'

export type PullRequestActionSelection =
  | { status: 'eligible'; pullRequest: PullRequestInfo }
  | { status: 'unavailable' }
  | { status: 'ambiguous' }

export interface PullRequestMergeMethodSelection {
  mergeMethod: PullRequestMergeMethod
  isDefault: boolean
}

function parseAllowedMergeMethods(pullRequest: PullRequestInfo): PullRequestMergeMethod[] {
  if (pullRequest.merge_methods_policy_known !== true || pullRequest.allowed_merge_methods === null) return []

  let values: unknown = pullRequest.allowed_merge_methods
  if (typeof values === 'string') {
    try {
      values = JSON.parse(values)
    } catch {
      return []
    }
  }

  if (!Array.isArray(values)) return []
  return [...new Set(values.filter(
    (value): value is PullRequestMergeMethod => value === 'merge' || value === 'squash' || value === 'rebase',
  ))]
}

export function getPullRequestMergeMethodSelections(
  pullRequest: PullRequestInfo,
): PullRequestMergeMethodSelection[] {
  const allowedMethods = parseAllowedMergeMethods(pullRequest)
  const configuredDefault = pullRequest.default_merge_method
  const defaultMethod = configuredDefault !== null && configuredDefault !== undefined
    && allowedMethods.includes(configuredDefault)
    ? configuredDefault
    : null
  const orderedMethods = defaultMethod === null
    ? allowedMethods
    : [defaultMethod, ...allowedMethods.filter(method => method !== defaultMethod)]

  return orderedMethods.map(mergeMethod => ({
    mergeMethod,
    isDefault: mergeMethod === defaultMethod,
  }))
}

export function selectPullRequestForAction(
  pullRequests: PullRequestInfo[],
  action: PullRequestActionKind,
): PullRequestActionSelection {
  const eligiblePullRequests = pullRequests.filter((pullRequest) => {
    const readiness = getMergeReadiness(pullRequest)
    return readiness.action === action
      && readiness.status === (action === 'merge' ? 'ready_to_merge' : 'ready_to_enqueue')
  })

  if (eligiblePullRequests.length === 1) {
    return { status: 'eligible', pullRequest: eligiblePullRequests[0] }
  }

  return { status: eligiblePullRequests.length > 1 ? 'ambiguous' : 'unavailable' }
}
