import type { PrWalkthrough } from '@openforge-app/plugin-sdk/domain'

export type WalkthroughButtonState = 'idle' | 'generating' | 'ready' | 'error' | 'stale'

export function walkthroughButtonState(
  walkthrough: PrWalkthrough | null | undefined,
  prHeadSha: string,
): WalkthroughButtonState {
  if (!walkthrough) return 'idle'
  if (walkthrough.status === 'generating') return 'generating'
  if (walkthrough.status === 'error') return 'error'
  // status === 'ready'
  return walkthrough.head_sha === prHeadSha ? 'ready' : 'stale'
}
