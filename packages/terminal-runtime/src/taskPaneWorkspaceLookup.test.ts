import { describe, expect, it } from 'vitest'
import {
  createRejectedTerminalTaskPaneWorkspaceSnapshot,
  createResolvedTerminalTaskPaneWorkspaceSnapshot,
  createTerminalTaskPaneWorkspaceLookupController,
  formatTerminalTaskPaneWorkspaceLookupError,
  getTerminalTaskPaneWorkspaceStatusText,
} from './taskPaneWorkspaceLookup'

describe('terminal task-pane workspace lookup controller', () => {
  it('tracks task changes and previous task ids for pane cleanup', () => {
    const lookup = createTerminalTaskPaneWorkspaceLookupController()

    expect(lookup.switchTask('T-1')).toEqual({ changed: true, previousTaskId: null, taskId: 'T-1' })
    expect(lookup.getActiveTaskId()).toBe('T-1')
    expect(lookup.switchTask('T-1')).toEqual({ changed: false, previousTaskId: 'T-1', taskId: 'T-1' })
    expect(lookup.switchTask('T-2')).toEqual({ changed: true, previousTaskId: 'T-1', taskId: 'T-2' })
    expect(lookup.getActiveTaskId()).toBe('T-2')
  })

  it('ignores stale lookup results after a newer lookup starts', () => {
    const lookup = createTerminalTaskPaneWorkspaceLookupController()
    lookup.switchTask('T-1')

    const firstRequest = lookup.startLookup('T-1')
    const retryRequest = lookup.startLookup('T-1')

    expect(lookup.resolveLookup(firstRequest, { workspace_path: '/old' })).toBeNull()
    expect(lookup.resolveLookup(retryRequest, { workspace_path: '/new' })).toEqual({
      workspacePath: '/new',
      workspaceLookupState: 'ready',
      workspaceLookupError: null,
    })
  })

  it('ignores stale lookup results after the active task changes', () => {
    const lookup = createTerminalTaskPaneWorkspaceLookupController()
    lookup.switchTask('T-1')
    const firstTaskRequest = lookup.startLookup('T-1')

    lookup.switchTask('T-2')
    const secondTaskRequest = lookup.startLookup('T-2')

    expect(lookup.resolveLookup(firstTaskRequest, { workspace_path: '/task-1' })).toBeNull()
    expect(lookup.rejectLookup(firstTaskRequest, new Error('old failure'))).toBeNull()
    expect(lookup.resolveLookup(secondTaskRequest, { workspace_path: null })).toEqual({
      workspacePath: null,
      workspaceLookupState: 'unavailable',
      workspaceLookupError: null,
    })
  })

  it('cancels in-flight lookups on teardown', () => {
    const lookup = createTerminalTaskPaneWorkspaceLookupController()
    lookup.switchTask('T-1')
    const request = lookup.startLookup('T-1')

    lookup.cancelLookups()

    expect(lookup.resolveLookup(request, { workspace_path: '/workspace' })).toBeNull()
  })

  it('creates shared status and error snapshots', () => {
    expect(getTerminalTaskPaneWorkspaceStatusText('loading')).toBe('Loading terminal workspace…')
    expect(getTerminalTaskPaneWorkspaceStatusText('unavailable')).toBe('Terminal workspace unavailable for this task.')
    expect(getTerminalTaskPaneWorkspaceStatusText('error')).toBe('Terminal workspace lookup failed.')
    expect(getTerminalTaskPaneWorkspaceStatusText('ready')).toBe('Terminal workspace ready.')

    expect(createResolvedTerminalTaskPaneWorkspaceSnapshot({ workspace_path: '/workspace' })).toEqual({
      workspacePath: '/workspace',
      workspaceLookupState: 'ready',
      workspaceLookupError: null,
    })
    expect(createResolvedTerminalTaskPaneWorkspaceSnapshot(undefined)).toEqual({
      workspacePath: null,
      workspaceLookupState: 'unavailable',
      workspaceLookupError: null,
    })
    expect(createRejectedTerminalTaskPaneWorkspaceSnapshot(new Error('lookup failed'))).toEqual({
      workspacePath: null,
      workspaceLookupState: 'error',
      workspaceLookupError: 'lookup failed',
    })
    expect(formatTerminalTaskPaneWorkspaceLookupError('bad')).toBe('Unable to resolve the workspace for this task.')
  })
})
