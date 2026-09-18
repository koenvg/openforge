import type { PrWalkthrough } from '@openforge-app/plugin-sdk/domain'

export type WalkthroughButtonState = 'idle' | 'generating' | 'ready' | 'no-submissions' | 'failed' | 'aborted' | 'stale'

export function walkthroughButtonState(
  walkthrough: PrWalkthrough | null | undefined,
  prHeadSha: string,
): WalkthroughButtonState {
  if (!walkthrough) return 'idle'
  if (walkthrough.status === 'generating') return 'generating'
  if (walkthrough.status === 'failed' || walkthrough.status === 'aborted' || walkthrough.status === 'no-submissions') return walkthrough.status
  // status === 'ready'
  return walkthrough.head_sha === prHeadSha ? 'ready' : 'stale'
}
