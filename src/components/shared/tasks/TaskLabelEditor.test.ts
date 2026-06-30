import { render, screen, fireEvent, waitFor } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import TaskLabelEditor from './TaskLabelEditor.svelte'
import type { TaskLabel } from '../../../lib/types'
import { getProjectTaskLabels } from '../../../lib/ipc'

vi.mock('../../../lib/ipc', () => ({
  getProjectTaskLabels: vi.fn().mockResolvedValue([]),
}))

const mockedGetProjectTaskLabels = vi.mocked(getProjectTaskLabels)

function makeLabel(id: number, name: string): TaskLabel {
  return { id, project_id: 'P-1', name, color: 'primary' }
}

const AVAILABLE_LABELS: TaskLabel[] = [
  makeLabel(1, 'cleanup'),
  makeLabel(2, 'bug'),
  makeLabel(3, 'docs'),
]

beforeEach(() => {
  mockedGetProjectTaskLabels.mockReset()
  mockedGetProjectTaskLabels.mockResolvedValue(AVAILABLE_LABELS)
})

async function flushAvailableLabels(): Promise<void> {
  await waitFor(() => {
    expect(mockedGetProjectTaskLabels).toHaveBeenCalled()
  })
}

describe('TaskLabelEditor', () => {
  it('collapses by default: shows only the "+ Add label" affordance, no "No labels" text, no floating suggestion chips', async () => {
    render(TaskLabelEditor, {
      props: {
        projectId: 'P-1',
        selectedLabels: [],
        onAdd: vi.fn(),
        onRemove: vi.fn(),
      },
    })

    await flushAvailableLabels()

    // The single add affordance is present.
    expect(screen.getByRole('button', { name: /add label/i })).toBeTruthy()

    // No empty-state filler text.
    expect(screen.queryByText('No labels')).toBeNull()

    // Suggestions (e.g. "cleanup") must not float in the collapsed state.
    expect(screen.queryByText('cleanup')).toBeNull()
    expect(screen.queryByText('bug')).toBeNull()
    expect(screen.queryByText('docs')).toBeNull()
    expect(screen.queryByText('Suggestions')).toBeNull()
  })

  it('expands on "+ Add label": reveals input + a "Suggestions" group listing unselected available labels', async () => {
    render(TaskLabelEditor, {
      props: {
        projectId: 'P-1',
        selectedLabels: [makeLabel(2, 'bug')],
        onAdd: vi.fn(),
        onRemove: vi.fn(),
      },
    })

    await flushAvailableLabels()

    await fireEvent.click(screen.getByRole('button', { name: /add label/i }))

    // Input becomes available.
    expect(screen.getByLabelText('Add label')).toBeTruthy()

    // Suggestions group heading present.
    expect(screen.getByText('Suggestions')).toBeTruthy()

    // Unselected available labels appear as suggestions...
    expect(screen.getByRole('button', { name: 'Add label cleanup' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add label docs' })).toBeTruthy()

    // ...but already-selected ones are excluded from suggestions.
    expect(screen.queryByRole('button', { name: 'Add label bug' })).toBeNull()
  })

  it('clicking a suggestion chip calls onAdd with that label object', async () => {
    const onAdd = vi.fn()
    render(TaskLabelEditor, {
      props: {
        projectId: 'P-1',
        selectedLabels: [],
        onAdd,
        onRemove: vi.fn(),
      },
    })

    await flushAvailableLabels()

    await fireEvent.click(screen.getByRole('button', { name: /^add label$/i }))
    await fireEvent.click(screen.getByRole('button', { name: 'Add label cleanup' }))

    expect(onAdd).toHaveBeenCalledTimes(1)
    expect(onAdd).toHaveBeenCalledWith(AVAILABLE_LABELS[0])
  })

  it('submitting a typed name calls onAdd', async () => {
    const onAdd = vi.fn()
    render(TaskLabelEditor, {
      props: {
        projectId: 'P-1',
        selectedLabels: [],
        onAdd,
        onRemove: vi.fn(),
      },
    })

    await flushAvailableLabels()

    await fireEvent.click(screen.getByRole('button', { name: /^add label$/i }))

    const input = screen.getByLabelText('Add label')
    await fireEvent.input(input, { target: { value: 'newlabel' } })
    await fireEvent.keyDown(input, { key: 'Enter' })

    expect(onAdd).toHaveBeenCalledTimes(1)
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ name: 'newlabel' }))
  })

  it('renders applied labels and calls onRemove when a remove control is clicked', async () => {
    const onRemove = vi.fn()
    const applied = makeLabel(2, 'bug')
    render(TaskLabelEditor, {
      props: {
        projectId: 'P-1',
        selectedLabels: [applied],
        onAdd: vi.fn(),
        onRemove,
      },
    })

    await flushAvailableLabels()

    const removeButton = screen.getByRole('button', { name: 'Remove label bug' })
    expect(removeButton).toBeTruthy()

    await fireEvent.click(removeButton)

    expect(onRemove).toHaveBeenCalledTimes(1)
    expect(onRemove).toHaveBeenCalledWith(applied)
  })
})
