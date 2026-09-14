import { cleanup, fireEvent, screen, waitFor } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { baseTask, renderTaskInfoPanel, resetTaskInfoPanelTestState } from './TaskInfoPanel.testUtils'
import { removeTaskDependency } from '../../lib/ipc'

import { refreshTaskRelationships } from '../../lib/tasksState'

const task = { ...baseTask, dependsOn: ['T-2', 'T-3'] }
async function confirm(id = 'T-2') {
  await fireEvent.click(screen.getByRole('button', { name: `Remove dependency ${id}` }))
  await fireEvent.click(screen.getByRole('button', { name: new RegExp(`^Confirm removing ${id}`) }))
}

beforeEach(() => {
  resetTaskInfoPanelTestState()
  vi.mocked(removeTaskDependency).mockReset().mockResolvedValue(undefined)
  vi.mocked(refreshTaskRelationships).mockReset().mockResolvedValue(undefined)
})
afterEach(cleanup)

describe('TaskInfoPanel dependency removal', () => {
  it('retains the chip after failure and requires fresh confirmation to retry', async () => {
    vi.mocked(removeTaskDependency).mockRejectedValueOnce(new Error('Write failed'))
    renderTaskInfoPanel({ task })
    await fireEvent.click(screen.getByRole('button', { name: 'Manage dependencies' }))
    await confirm()
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Write failed'))
    expect(screen.queryByRole('button', { name: /^Confirm removing/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Remove dependency T-2' })).toBeTruthy()
    await confirm()
    await waitFor(() => expect(refreshTaskRelationships).toHaveBeenCalledOnce())
    expect(removeTaskDependency).toHaveBeenCalledTimes(2)
  })

  it.each(['success', 'failure'])('keeps an old task %s out of the newly viewed task', async outcome => {
    let finish!: () => void
    let fail!: (error: Error) => void
    vi.mocked(removeTaskDependency).mockImplementationOnce(() => new Promise((resolve, reject) => { finish = resolve; fail = reject }))
    const { rerender } = renderTaskInfoPanel({ task })
    await fireEvent.click(screen.getByRole('button', { name: 'Manage dependencies' }))
    await confirm()
    await rerender({ task: { ...task, id: 'T-new' } })
    expect(screen.getByRole('button', { name: 'Manage dependencies' }).hasAttribute('disabled')).toBe(false)
    if (outcome === 'success') finish()
    else fail(new Error('Old task failed'))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(screen.queryByRole('alert')).toBeNull()
    if (outcome === 'success') expect(refreshTaskRelationships).toHaveBeenCalledExactlyOnceWith(task.id, 'T-2')
    else expect(refreshTaskRelationships).not.toHaveBeenCalled()
  })

  it('retries only refresh after a committed removal fails to reconcile', async () => {
    vi.mocked(refreshTaskRelationships).mockRejectedValueOnce(new Error('Offline'))
    renderTaskInfoPanel({ task })
    await fireEvent.click(screen.getByRole('button', { name: 'Manage dependencies' }))
    await confirm()
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Dependency removed, but refresh failed'))
    await fireEvent.click(screen.getByRole('button', { name: 'Retry dependency refresh' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(removeTaskDependency).toHaveBeenCalledTimes(1)
    expect(refreshTaskRelationships).toHaveBeenCalledTimes(2)
  })

  it('submits exactly the current relationship and disables further mutations until reconciliation', async () => {
    let finish!: () => void
    vi.mocked(removeTaskDependency).mockImplementation(() => new Promise(resolve => { finish = resolve }))
    renderTaskInfoPanel({ task })
    await fireEvent.click(screen.getByRole('button', { name: 'Manage dependencies' }))
    await confirm()
    expect(removeTaskDependency).toHaveBeenCalledExactlyOnceWith(task.id, 'T-2')
    expect(screen.getByRole('button', { name: 'Remove dependency T-3' }).hasAttribute('disabled')).toBe(true)
    expect(refreshTaskRelationships).not.toHaveBeenCalled()
    finish()
    await waitFor(() => expect(refreshTaskRelationships).toHaveBeenCalledExactlyOnceWith(task.id, 'T-2'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove dependency T-3' }).hasAttribute('disabled')).toBe(false))
  })
})
