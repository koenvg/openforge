import { render, screen, fireEvent, waitFor } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { writable } from 'svelte/store'
import type { WorkQueueTask } from '../lib/types'

vi.mock('../lib/stores', () => ({
  activeProjectId: writable<string | null>(null),
  currentView: writable('workqueue'),
  selectedTaskId: writable<string | null>(null),
}))

vi.mock('../lib/navigation', () => ({
  pushNavState: vi.fn(),
}))

vi.mock('../lib/ipc', () => ({
  getWorkQueueTasks: vi.fn().mockResolvedValue([]),
}))

import WorkQueueView from './WorkQueueView.svelte'
import { activeProjectId, currentView, selectedTaskId } from '../lib/stores'
import { getWorkQueueTasks } from '../lib/ipc'
import { pushNavState } from '../lib/navigation'

const now = Math.floor(Date.now() / 1000)

function makeWorkQueueTask(overrides: Partial<WorkQueueTask> = {}): WorkQueueTask {
  return {
    id: 'T-1',
    title: 'Fix login bug',
    status: 'doing',
    summary: 'Updated auth flow to handle edge case',
    project_id: 'proj-1',
    project_name: 'Frontend App',
    session_completed_at: now - 3600, // 1 hour ago
    session_status: null,
    ...overrides,
  }
}

describe('WorkQueueView', () => {
  beforeEach(() => {
    activeProjectId.set(null)
    currentView.set('workqueue')
    selectedTaskId.set(null)
    vi.clearAllMocks()
    vi.mocked(getWorkQueueTasks).mockResolvedValue([])
  })

  it('renders grouped tasks by project', async () => {
    vi.mocked(getWorkQueueTasks).mockResolvedValue([
      makeWorkQueueTask({ id: 'T-1', project_name: 'Frontend App', project_id: 'proj-1' }),
      makeWorkQueueTask({ id: 'T-2', project_name: 'Frontend App', project_id: 'proj-1', title: 'Fix button' }),
      makeWorkQueueTask({ id: 'T-3', project_name: 'Backend API', project_id: 'proj-2', title: 'Add endpoint' }),
    ])

    render(WorkQueueView)

    await waitFor(() => {
      expect(screen.getByText('Frontend App')).toBeTruthy()
      expect(screen.getByText('Backend API')).toBeTruthy()
    })

    // Verify task IDs appear
    expect(screen.getByText('T-1')).toBeTruthy()
    expect(screen.getByText('T-2')).toBeTruthy()
    expect(screen.getByText('T-3')).toBeTruthy()
  })

  it('shows empty state when no tasks', async () => {
    vi.mocked(getWorkQueueTasks).mockResolvedValue([])

    render(WorkQueueView)

    await waitFor(() => {
      expect(screen.getByText('No tasks waiting for review')).toBeTruthy()
    })
  })

  it('shows relative time from session completion', async () => {
    vi.mocked(getWorkQueueTasks).mockResolvedValue([
      makeWorkQueueTask({ session_completed_at: now - 7200 }), // 2 hours ago
    ])

    render(WorkQueueView)

    await waitFor(() => {
      expect(screen.getByText('2h ago')).toBeTruthy()
    })
  })

  it('shows task summary when available', async () => {
    vi.mocked(getWorkQueueTasks).mockResolvedValue([
      makeWorkQueueTask({ summary: 'Refactored the auth module' }),
    ])

    render(WorkQueueView)

    await waitFor(() => {
      expect(screen.getByText('Refactored the auth module')).toBeTruthy()
    })
    expect(screen.getByTitle('Refactored the auth module')).toBeTruthy()
  })

  it('keeps full summary accessible via title when display text is truncated', async () => {
    const longSummary = 'This is a very long summary that should be visually truncated in the card but remain fully accessible via hover title tooltip text for easy reading'
    vi.mocked(getWorkQueueTasks).mockResolvedValue([
      makeWorkQueueTask({ summary: longSummary }),
    ])

    render(WorkQueueView)

    await waitFor(() => {
      expect(screen.getByTitle(longSummary)).toBeTruthy()
    })
  })

  it('handles null summary gracefully', async () => {
    vi.mocked(getWorkQueueTasks).mockResolvedValue([
      makeWorkQueueTask({ summary: null }),
    ])

    render(WorkQueueView)

    await waitFor(() => {
      expect(screen.getByText('T-1')).toBeTruthy()
    })
    // Should not crash, and no summary text should appear
    expect(screen.queryByText('null')).toBeNull()
  })

  it('shows no session label when session_completed_at is null', async () => {
    vi.mocked(getWorkQueueTasks).mockResolvedValue([
      makeWorkQueueTask({ session_completed_at: null }),
    ])

    render(WorkQueueView)

    await waitFor(() => {
      expect(screen.getByText('no session')).toBeTruthy()
    })
  })

  it('shows session status badge when session_status is present', async () => {
    vi.mocked(getWorkQueueTasks).mockResolvedValue([
      makeWorkQueueTask({ session_status: 'completed' }),
    ])

    render(WorkQueueView)

    await waitFor(() => {
      expect(screen.getByText('Done')).toBeTruthy()
    })
  })

  it('shows running status badge with correct label', async () => {
    vi.mocked(getWorkQueueTasks).mockResolvedValue([
      makeWorkQueueTask({ session_status: 'running' }),
    ])

    render(WorkQueueView)

    await waitFor(() => {
      expect(screen.getByText('Running')).toBeTruthy()
    })
  })

  it('does not show status badge when session_status is null', async () => {
    vi.mocked(getWorkQueueTasks).mockResolvedValue([
      makeWorkQueueTask({ session_status: null }),
    ])

    render(WorkQueueView)

    await waitFor(() => {
      expect(screen.getByText('T-1')).toBeTruthy()
    })
    expect(screen.queryByText('Done')).toBeNull()
    expect(screen.queryByText('Running')).toBeNull()
    expect(screen.queryByText('Paused')).toBeNull()
    expect(screen.queryByText('Error')).toBeNull()
    expect(screen.queryByText('Stopped')).toBeNull()
  })

  it('navigates to project board on task click', async () => {
    vi.mocked(getWorkQueueTasks).mockResolvedValue([
      makeWorkQueueTask({ id: 'T-5', project_id: 'proj-42', project_name: 'My Project' }),
    ])

    render(WorkQueueView)

    await waitFor(() => {
      expect(screen.getByText('T-5')).toBeTruthy()
    })

    const taskCard = screen.getByText('T-5').closest('button')
    expect(taskCard).toBeTruthy()
    await fireEvent.click(taskCard!)

    expect(pushNavState).toHaveBeenCalled()
    expect(vi.mocked(activeProjectId)).toBeDefined()
    // Verify stores were updated — read current values
    const { get } = await import('svelte/store')
    expect(get(activeProjectId)).toBe('proj-42')
    expect(get(currentView)).toBe('board')
    expect(get(selectedTaskId)).toBe('T-5')
  })

  it('shows loading state initially', () => {
    // Make IPC never resolve to keep loading state
    vi.mocked(getWorkQueueTasks).mockReturnValue(new Promise(() => {}))

    render(WorkQueueView)

    expect(screen.getByText('Loading...')).toBeTruthy()
  })

  it('calls getWorkQueueTasks on mount', async () => {
    render(WorkQueueView)

    await waitFor(() => {
      expect(getWorkQueueTasks).toHaveBeenCalledTimes(1)
    })
  })

  it('re-fetches when refreshTrigger changes', async () => {
    vi.mocked(getWorkQueueTasks).mockResolvedValue([
      makeWorkQueueTask({ id: 'T-1' }),
    ])

    const { rerender } = render(WorkQueueView, { props: { refreshTrigger: 0 } })

    await waitFor(() => {
      expect(getWorkQueueTasks).toHaveBeenCalledTimes(1)
    })

    vi.mocked(getWorkQueueTasks).mockResolvedValue([
      makeWorkQueueTask({ id: 'T-1' }),
      makeWorkQueueTask({ id: 'T-2', title: 'New task' }),
    ])

    await rerender({ refreshTrigger: 1 })

    await waitFor(() => {
      expect(getWorkQueueTasks).toHaveBeenCalledTimes(2)
    })
  })
})
