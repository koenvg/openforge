import { describe, it, expect } from 'vitest'
import { decideBranchStartAction } from './branchStartGate'
import type { ExistingBranchRelation } from './types'

describe('decideBranchStartAction', () => {
  it('auto-starts a local-only branch without a modal', () => {
    expect(decideBranchStartAction('localOnly')).toEqual({ kind: 'autoStart', resolution: 'auto' })
  })

  it('auto-starts a remote-only branch without a modal', () => {
    expect(decideBranchStartAction('remoteOnly')).toEqual({ kind: 'autoStart', resolution: 'auto' })
  })

  it('auto-starts an auto-fast-forward branch without a modal', () => {
    expect(decideBranchStartAction('autoFastForward')).toEqual({ kind: 'autoStart', resolution: 'auto' })
  })

  it('opens the divergence modal for a diverged branch', () => {
    expect(decideBranchStartAction('diverged')).toEqual({ kind: 'openModal' })
  })

  it('never opens the modal for any non-diverged relation', () => {
    const nonDiverged: ExistingBranchRelation[] = ['localOnly', 'remoteOnly', 'autoFastForward']
    for (const relation of nonDiverged) {
      expect(decideBranchStartAction(relation).kind).toBe('autoStart')
    }
  })
})
