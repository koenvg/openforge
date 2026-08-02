import { checkGithubIssuesReady } from './ipc'

export interface DestinationChangeResult {
  accepted: boolean
  reason: string | null
}

/** Validate a destination change before it is persisted. `openforge` (and any
 *  non-github value) is always accepted; `github_issues` runs the readiness
 *  check for the scope (projectId null = global). */
export async function validateDestinationChange(
  value: string,
  projectId: string | null,
): Promise<DestinationChangeResult> {
  if (value !== 'github_issues') {
    return { accepted: true, reason: null }
  }
  const { ready, reason } = await checkGithubIssuesReady(projectId)
  return {
    accepted: ready,
    reason: ready ? null : (reason ?? 'GitHub Issues is not available for this project.'),
  }
}
