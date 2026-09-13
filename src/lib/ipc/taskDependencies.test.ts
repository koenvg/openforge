import { beforeEach, describe, expect, it, vi } from 'vitest'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('../desktopIpc', () => ({ invokeDesktopCommand: invoke }))
import { removeTaskDependency } from '../ipc'

describe('removeTaskDependency', () => {
  beforeEach(() => { invoke.mockReset() })

  it('removes one relationship through the camelCase desktop contract', async () => {
    invoke.mockResolvedValue(null)
    await removeTaskDependency('T-1', 'T-2')
    expect(invoke).toHaveBeenCalledExactlyOnceWith('remove_task_dependency', {
      taskId: 'T-1', dependencyTaskId: 'T-2',
    })
  })

  it('preserves command failure for the caller', async () => {
    invoke.mockRejectedValue(new Error('task T-1 does not exist'))
    await expect(removeTaskDependency('T-1', 'T-2')).rejects.toThrow('task T-1 does not exist')
  })
})
