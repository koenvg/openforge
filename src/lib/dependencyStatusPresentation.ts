import type { BoardStatus } from './types'
import type { DomainStatusBadgeVariant } from './taskStatePresentation'

export type DependencyStatusTone = 'neutral' | 'warning' | 'success'

export interface DependencyStatusPresentation {
  label: string
  tone: DependencyStatusTone
  badgeVariant: DomainStatusBadgeVariant
}

export function getDependencyStatusPresentation(status: BoardStatus | null): DependencyStatusPresentation {
  if (status === 'done') return { label: status, tone: 'success', badgeVariant: 'status-success' }
  if (status === 'doing') return { label: status, tone: 'warning', badgeVariant: 'status-warning' }
  if (status === 'backlog') return { label: status, tone: 'neutral', badgeVariant: 'status-neutral' }
  return { label: status ?? 'unknown', tone: 'neutral', badgeVariant: 'status-neutral' }
}
