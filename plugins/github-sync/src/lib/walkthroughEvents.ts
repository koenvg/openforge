import type { SessionScope } from '@openforge-app/plugin-sdk'

export const WALKTHROUGH_INVALIDATED_EVENT = 'com.openforge.github-sync.walkthrough-changed'

export interface WalkthroughInvalidatedEvent {
  prId: number
  scope: SessionScope
}
