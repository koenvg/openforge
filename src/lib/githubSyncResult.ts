import type { PollResult } from './types'

export function githubSyncFailureMessage(result: PollResult): string | null {
  if (result.outcome === 'missing_github_token') {
    return 'GitHub token is not configured. Add one in Settings and try again.'
  }
  if (result.outcome === 'github_token_unavailable') {
    return 'OpenForge could not read the GitHub token. Check the developer logs and try again.'
  }
  if (result.outcome === 'rate_limited' || result.rate_limited) {
    return 'GitHub rate limit reached. Try again after it resets.'
  }
  if (result.outcome === 'failed' || result.errors > 0) {
    return pollErrorMessage(result.errors)
  }
  return null
}

function pollErrorMessage(errorCount: number): string {
  const noun = errorCount === 1 ? 'error' : 'errors'
  return `GitHub sync encountered ${errorCount} ${noun}. Check the developer logs and try again.`
}
