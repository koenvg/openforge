import { describe, expect, it } from 'vitest'
import * as projectTerminal from './projectTerminal'

const { createProjectShellSession, createTaskShellSession } = projectTerminal

describe('projectTerminal', () => {
  it('uses public shell session identity for project terminals without exposing host PTY keys', () => {
    expect(createProjectShellSession('P-123', 2)).toEqual({
      id: 'project-terminal:P-123:2',
      origin: { kind: 'project', projectId: 'P-123' },
      ordinal: 2,
    })
  })

  it('uses task shell session identity for task terminal tabs', () => {
    expect(createTaskShellSession('T-123', 1)).toEqual({
      id: 'task-terminal:T-123:1',
      origin: { kind: 'task', taskId: 'T-123' },
      ordinal: 1,
    })
  })

  it('keeps terminal identity utilities limited to public SDK shell session helpers', () => {
    expect(Object.keys(projectTerminal).sort()).toEqual(['createProjectShellSession', 'createTaskShellSession'])
  })
})
