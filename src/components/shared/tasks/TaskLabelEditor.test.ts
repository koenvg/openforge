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
  return { id, projectId: 'P-1', name }
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

    expect(screen.getByRole('button', { name: /add label/i })).toBeTruthy()
    expect(screen.queryByText('No labels')).toBeNull()
    expect(screen.queryByText('cleanup')).toBeNull()
    expect(screen.queryByText('bug')).toBeNull()
    expect(screen.queryByText('docs')).toBeNull()
    expect(screen.queryByText('Suggestions')).toBeNull()
  })

  it('expands on "+ Add label": reveals search input + a "Suggestions" group listing unselected available labels', async () => {
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

    expect(screen.getByLabelText('Search labels')).toBeTruthy()
    expect(screen.getByText('Suggestions')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add label cleanup' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add label docs' })).toBeTruthy()
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

  it('filters existing project labels and adds the first match on Enter without creating labels', async () => {
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

    const input = screen.getByLabelText('Search labels')
    await fireEvent.input(input, { target: { value: 'doc' } })

    expect(screen.getByRole('button', { name: 'Add label docs' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add label cleanup' })).toBeNull()

    await fireEvent.keyDown(input, { key: 'Enter' })

    expect(onAdd).toHaveBeenCalledTimes(1)
    expect(onAdd).toHaveBeenCalledWith(AVAILABLE_LABELS[2])
  })

  it('creates and assigns a new project label from unmatched input on Enter', async () => {
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

    const input = screen.getByLabelText('Search labels')
    await fireEvent.input(input, { target: { value: ' feature ' } })

    expect(screen.getByRole('button', { name: 'Create label feature' })).toBeTruthy()

    await fireEvent.keyDown(input, { key: 'Enter' })

    expect(onAdd).toHaveBeenCalledTimes(1)
    expect(onAdd).toHaveBeenCalledWith('feature')
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

  it('does not render project task label deletion controls in task detail label assignment', async () => {
    render(TaskLabelEditor, {
      props: {
        projectId: 'P-1',
        selectedLabels: [],
        onAdd: vi.fn(),
        onRemove: vi.fn(),
      },
    })

    await flushAvailableLabels()
    await fireEvent.click(screen.getByRole('button', { name: /^add label$/i }))

    expect(screen.queryByRole('button', { name: /delete project label/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /delete task label/i })).toBeNull()
  })
})
