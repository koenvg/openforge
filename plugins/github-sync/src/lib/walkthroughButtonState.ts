import type { WalkthroughRecordV1 } from './walkthroughRecord'

export type WalkthroughButtonState = 'idle' | 'generating' | 'ready' | 'no-submissions' | 'failed' | 'aborted' | 'stale'

export function walkthroughButtonState(
  walkthrough: WalkthroughRecordV1 | null | undefined,
  prHeadSha: string,
): WalkthroughButtonState {
  if (!walkthrough) return 'idle'
  if (walkthrough.state === 'generating') return 'generating'
  if (walkthrough.state === 'failed' || walkthrough.state === 'aborted' || walkthrough.state === 'no-submissions') return walkthrough.state
  return walkthrough.scope.revision === prHeadSha ? 'ready' : 'stale'
}
