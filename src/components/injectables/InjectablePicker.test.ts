import { render, fireEvent, waitFor } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const reload = vi.fn().mockResolvedValue(undefined)

vi.mock('../../lib/injectables/useInjectableCatalog.svelte', () => ({
  useInjectableCatalog: () => ({
    injectables: [
      {
        id: 'project:skill:refactor',
        kind: 'skill',
        name: 'refactor',
        description: 'restructure code',
        origin: 'project',
        triggerMode: 'auto+manual',
        sourceDir: '.claude',
        sourcePath: 'refactor',
        content: '---\nname: refactor\n---\nbody text',
        invocationText: '/refactor ',
      },
      {
        id: 'personal:skill:pr-writer',
        kind: 'skill',
        name: 'pr-writer',
        description: 'writes prs',
        origin: 'personal',
        triggerMode: 'auto+manual',
        sourceDir: '.claude',
        sourcePath: 'pr-writer',
        content: 'pr body',
        invocationText: '/pr-writer ',
      },
      {
        id: 'snippet:s1',
        kind: 'snippet',
        name: 'pr-boilerplate',
        description: null,
        origin: 'personal',
        triggerMode: 'manual-only',
        sourceDir: null,
        sourcePath: null,
        content: 'Summary body',
        invocationText: 'Summary body',
      },
    ],
    // Raw snippets (with scope) for the editor's "Available in" checklist.
    snippets: [{ id: 's1', name: 'pr-boilerplate', body: 'Summary body', allProjects: true, projectIds: [] }],
    loading: false,
    error: null,
    reload,
  }),
}))

vi.mock('../../lib/ipc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/ipc')>()),
  writePersonalSkill: vi.fn().mockResolvedValue(undefined),
  deletePersonalSkill: vi.fn().mockResolvedValue(undefined),
  getProjects: vi.fn().mockResolvedValue([
    { id: 'P-1', name: 'Alpha' },
    { id: 'P-2', name: 'Beta' },
  ]),
}))

// Snippets now flow through the shared plugin-storage-backed adapter, not the Rust IPC.
vi.mock('../../lib/injectables/pluginSnippetStore', () => ({
  createSnippet: vi.fn().mockResolvedValue({ id: 's2', name: 'My Snippet', body: 'the body', allProjects: true, projectIds: [] }),
  updateSnippet: vi.fn().mockResolvedValue({ id: 's1', name: 'Renamed', body: 'new body', allProjects: true, projectIds: [] }),
  deleteSnippet: vi.fn().mockResolvedValue(undefined),
}))

import InjectablePicker from './InjectablePicker.svelte'
import { writePersonalSkill, deletePersonalSkill } from '../../lib/ipc'
import { createSnippet, updateSnippet, deleteSnippet } from '../../lib/injectables/pluginSnippetStore'

const props = (over = {}) => ({ projectId: 'P-1', open: true, onClose: vi.fn(), onSelect: vi.fn(), ...over })

describe('InjectablePicker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens with the preview closed and nothing selected', () => {
    const { queryByText } = render(InjectablePicker, { props: props() })
    expect(queryByText('Insert into prompt')).toBeNull()
  })

  it('clicking a row opens the preview; inserting yields that injectable and closes', async () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    const { getByText } = render(InjectablePicker, { props: props({ onSelect, onClose }) })
    await fireEvent.click(getByText('refactor'))
    await fireEvent.click(getByText('Insert into prompt'))
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ invocationText: '/refactor ' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('clicking the already-selected row again closes the preview', async () => {
    const { getByText, queryByText, container } = render(InjectablePicker, { props: props() })
    await fireEvent.click(getByText('refactor'))
    expect(queryByText('Insert into prompt')).not.toBeNull()
    const row = container.querySelector('[data-injectable-id="project:skill:refactor"]')!
    await fireEvent.click(row)
    expect(queryByText('Insert into prompt')).toBeNull()
  })

  it('the ✕ button closes the preview', async () => {
    const { getByText, getByLabelText, queryByText } = render(InjectablePicker, { props: props() })
    await fireEvent.click(getByText('refactor'))
    await fireEvent.click(getByLabelText('Close preview'))
    expect(queryByText('Insert into prompt')).toBeNull()
  })

  it('selecting a different row then inserting yields that injectable', async () => {
    const onSelect = vi.fn()
    const { getByText } = render(InjectablePicker, { props: props({ onSelect }) })
    await fireEvent.click(getByText('pr-writer'))
    await fireEvent.click(getByText('Insert into prompt'))
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ invocationText: '/pr-writer ' }))
  })

  it('arrow keys move through headers + items and Enter inserts an item', async () => {
    const onSelect = vi.fn()
    const { getByPlaceholderText } = render(InjectablePicker, { props: props({ onSelect }) })
    const input = getByPlaceholderText('Search injectables…')
    // Rows in order: group:snippet, snippet:s1, group:personal, personal:skill:pr-writer,
    // group:project, project:skill:refactor. 6 downs land on refactor.
    for (let i = 0; i < 6; i++) await fireEvent.keyDown(input, { key: 'ArrowDown' })
    await fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ invocationText: '/refactor ' }))
  })

  it('filters the list by search query', async () => {
    const { getByPlaceholderText, queryByText } = render(InjectablePicker, { props: props() })
    await fireEvent.input(getByPlaceholderText('Search injectables…'), { target: { value: 'zzz-no-match' } })
    expect(queryByText('pr-writer')).toBeNull()
  })

  it('defaults to rendered view, toggles to raw, and keeps the choice across selections', async () => {
    const { getByText, queryByTestId } = render(InjectablePicker, { props: props() })
    await fireEvent.click(getByText('refactor'))
    expect(queryByTestId('injectable-content-md')).not.toBeNull()
    expect(queryByTestId('injectable-content-raw')).toBeNull()

    await fireEvent.click(getByText('Raw'))
    expect(queryByTestId('injectable-content-raw')).not.toBeNull()
    expect(queryByTestId('injectable-content-md')).toBeNull()

    // Choice persists when switching to another injectable.
    await fireEvent.click(getByText('pr-writer'))
    expect(queryByTestId('injectable-content-raw')).not.toBeNull()
  })

  it('resets the view toggle back to rendered when the dialog is reopened', async () => {
    const { getByText, queryByTestId, rerender } = render(InjectablePicker, { props: props() })
    await fireEvent.click(getByText('refactor'))
    await fireEvent.click(getByText('Raw'))
    expect(queryByTestId('injectable-content-raw')).not.toBeNull()

    await rerender(props({ open: false }))
    await rerender(props({ open: true }))
    await fireEvent.click(getByText('refactor'))
    expect(queryByTestId('injectable-content-md')).not.toBeNull()
    expect(queryByTestId('injectable-content-raw')).toBeNull()
  })

  it('offers Edit/Delete only for personal skills', async () => {
    const { getByText, queryByText } = render(InjectablePicker, { props: props() })
    await fireEvent.click(getByText('refactor')) // project origin -> read-only
    expect(queryByText('Edit')).toBeNull()
    await fireEvent.click(getByText('pr-writer')) // personal origin -> editable
    expect(queryByText('Edit')).not.toBeNull()
  })

  it('editing a personal skill writes via IPC and reloads the catalog', async () => {
    const { getByText, getByTestId } = render(InjectablePicker, { props: props() })
    await fireEvent.click(getByText('pr-writer'))
    await fireEvent.click(getByText('Edit'))
    await fireEvent.input(getByTestId('skill-editor'), { target: { value: 'updated body' } })
    await fireEvent.click(getByText('Save'))
    expect(writePersonalSkill).toHaveBeenCalledWith('.claude', 'pr-writer', 'updated body')
    await waitFor(() => expect(reload).toHaveBeenCalled())
  })

  it('deleting a personal skill confirms first, then calls the delete IPC', async () => {
    const { getByText, getByTestId, queryByTestId } = render(InjectablePicker, { props: props() })
    await fireEvent.click(getByText('pr-writer'))
    expect(deletePersonalSkill).not.toHaveBeenCalled()
    await fireEvent.click(getByText('Delete')) // opens confirmation
    await fireEvent.click(getByTestId('confirm-delete'))
    expect(deletePersonalSkill).toHaveBeenCalledWith('.claude', 'pr-writer')
    await waitFor(() => expect(queryByTestId('confirm-delete')).toBeNull())
  })

  it('while editing, arrows/Enter stay in the textarea and Escape cancels the edit', async () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    const { getByText, getByTestId, queryByTestId } = render(InjectablePicker, {
      props: props({ onSelect, onClose }),
    })
    await fireEvent.click(getByText('pr-writer'))
    await fireEvent.click(getByText('Edit'))
    const editor = getByTestId('skill-editor')

    // Navigation keys must not move the selection or insert while editing.
    await fireEvent.keyDown(editor, { key: 'ArrowDown' })
    await fireEvent.keyDown(editor, { key: 'Enter' })
    expect(onSelect).not.toHaveBeenCalled()
    expect(queryByTestId('skill-editor')).not.toBeNull()

    // Escape cancels the edit without closing the whole picker.
    await fireEvent.keyDown(editor, { key: 'Escape' })
    expect(queryByTestId('skill-editor')).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('lists a snippet and inserts it as its literal body', async () => {
    const onSelect = vi.fn()
    const { getByText } = render(InjectablePicker, { props: props({ onSelect }) })
    expect(getByText('pr-boilerplate')).not.toBeNull()
    await fireEvent.click(getByText('pr-boilerplate'))
    await fireEvent.click(getByText('Insert into prompt'))
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'snippet', invocationText: 'Summary body' }),
    )
  })

  it('offers Edit and Delete for a snippet', async () => {
    const { getByText, queryByText } = render(InjectablePicker, { props: props() })
    await fireEvent.click(getByText('pr-boilerplate'))
    expect(queryByText('Edit')).not.toBeNull()
    expect(queryByText('Delete')).not.toBeNull()
  })

  it('creating a snippet calls createSnippet and reloads the catalog', async () => {
    const { getByText, getByTestId } = render(InjectablePicker, { props: props() })
    await fireEvent.click(getByText('New snippet'))
    await fireEvent.input(getByTestId('snippet-name'), { target: { value: 'My Snippet' } })
    await fireEvent.input(getByTestId('snippet-editor'), { target: { value: 'the body' } })
    await fireEvent.click(getByText('Save'))
    expect(createSnippet).toHaveBeenCalledWith('My Snippet', 'the body', true, [])
    await waitFor(() => expect(reload).toHaveBeenCalled())
  })

  it('auto-saves project scope from the header dropdown (no Save click)', async () => {
    const { getByText, getByTestId } = render(InjectablePicker, { props: props() })
    await fireEvent.click(getByText('pr-boilerplate'))
    await fireEvent.click(getByTestId('scope-menu-trigger'))
    // Raw scope is "All"; unticking Beta (P-2) narrows to just Alpha (P-1) and auto-saves,
    // preserving the snippet's title + body.
    await fireEvent.click(getByTestId('scope-project-P-2'))
    expect(updateSnippet).toHaveBeenCalledWith('s1', 'pr-boilerplate', 'Summary body', false, ['P-1'])
    await waitFor(() => expect(reload).toHaveBeenCalled())
  })

  it('keeps the project checklist out of the edit form (scope lives in the dropdown)', async () => {
    const { getByText, getByTestId, queryByTestId } = render(InjectablePicker, { props: props() })
    await fireEvent.click(getByText('pr-boilerplate'))
    await fireEvent.click(getByText('Edit'))
    expect(getByTestId('snippet-name')).not.toBeNull()
    expect(queryByTestId('scope-all')).toBeNull()
  })

  it('editing a snippet calls updateSnippet with its db id and reloads', async () => {
    const { getByText, getByTestId } = render(InjectablePicker, { props: props() })
    await fireEvent.click(getByText('pr-boilerplate'))
    await fireEvent.click(getByText('Edit'))
    await fireEvent.input(getByTestId('snippet-name'), { target: { value: 'Renamed' } })
    await fireEvent.input(getByTestId('snippet-editor'), { target: { value: 'new body' } })
    await fireEvent.click(getByText('Save'))
    expect(updateSnippet).toHaveBeenCalledWith('s1', 'Renamed', 'new body', true, [])
    await waitFor(() => expect(reload).toHaveBeenCalled())
  })

  it('deleting a snippet confirms first, then calls deleteSnippet with its db id', async () => {
    const { getByText, getByTestId, queryByTestId } = render(InjectablePicker, { props: props() })
    await fireEvent.click(getByText('pr-boilerplate'))
    expect(deleteSnippet).not.toHaveBeenCalled()
    await fireEvent.click(getByText('Delete'))
    await fireEvent.click(getByTestId('confirm-delete'))
    expect(deleteSnippet).toHaveBeenCalledWith('s1')
    await waitFor(() => expect(queryByTestId('confirm-delete')).toBeNull())
  })

  it('⌘2 cycles the filter to snippets-only and ⌘1 returns to All', async () => {
    const { getByPlaceholderText, queryByText } = render(InjectablePicker, { props: props() })
    const input = getByPlaceholderText('Search injectables…')
    // Default "All": every item visible.
    expect(queryByText('refactor')).not.toBeNull()
    expect(queryByText('pr-boilerplate')).not.toBeNull()
    // ⌘2 → cursor moves All → Snippets (single-select).
    await fireEvent.keyDown(input, { key: '2', metaKey: true })
    expect(queryByText('pr-boilerplate')).not.toBeNull()
    expect(queryByText('refactor')).toBeNull()
    expect(queryByText('pr-writer')).toBeNull()
    // ⌘1 → back to All.
    await fireEvent.keyDown(input, { key: '1', metaKey: true })
    expect(queryByText('refactor')).not.toBeNull()
    expect(queryByText('pr-writer')).not.toBeNull()
  })

  it('the All chip clears an active multi-select filter', async () => {
    const { getByTestId, queryByText } = render(InjectablePicker, { props: props() })
    await fireEvent.click(getByTestId('filter-chip-personal'))
    expect(queryByText('pr-writer')).not.toBeNull() // personal skill kept
    expect(queryByText('refactor')).toBeNull() // project skill hidden
    await fireEvent.click(getByTestId('filter-chip-all'))
    expect(queryByText('refactor')).not.toBeNull() // everything back
  })

  it('one Tab from the search input moves focus straight to the first list row', async () => {
    const { getByPlaceholderText, container } = render(InjectablePicker, { props: props() })
    const input = getByPlaceholderText('Search injectables…')
    await fireEvent.keyDown(input, { key: 'Tab' })
    // The first row is the leading group header.
    const firstRow = container.querySelector('[data-injectable-id]')
    expect(document.activeElement).toBe(firstRow)
    expect(firstRow?.getAttribute('data-injectable-id')).toBe('group:snippet')
  })

  it('arrow navigation moves DOM focus onto the active row', async () => {
    const { getByPlaceholderText, container } = render(InjectablePicker, { props: props() })
    const input = getByPlaceholderText('Search injectables…')
    await fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(container.querySelector('[data-injectable-id="group:snippet"]'))
  })

  it('⌘ filter change keeps focus in the list, re-homing when the active row is filtered out', async () => {
    const { container } = render(InjectablePicker, { props: props() })
    const snippetRow = container.querySelector('[data-injectable-id="snippet:s1"]') as HTMLElement
    snippetRow.focus()
    expect(document.activeElement).toBe(snippetRow)
    // ⌘2 → Snippets (row survives), ⌘2 → Personal (snippet row removed → focus re-homes
    // to the first row of the filtered list, the Personal header).
    await fireEvent.keyDown(snippetRow, { key: '2', metaKey: true })
    await fireEvent.keyDown(snippetRow, { key: '2', metaKey: true })
    await waitFor(() =>
      expect(document.activeElement).toBe(
        container.querySelector('[data-injectable-id="group:personal"]'),
      ),
    )
  })

  it('ArrowLeft on an item collapses its group and moves to the header; ArrowRight re-expands', async () => {
    const { getByPlaceholderText, container } = render(InjectablePicker, { props: props() })
    const input = getByPlaceholderText('Search injectables…')
    // Move down to the snippet item (group:snippet → snippet:s1), then Left.
    await fireEvent.keyDown(input, { key: 'ArrowDown' })
    await fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(container.querySelector('[data-injectable-id="snippet:s1"]'))
    await fireEvent.keyDown(input, { key: 'ArrowLeft' })
    // Group collapsed → the item row is gone and focus is on the header.
    await waitFor(() => expect(container.querySelector('[data-injectable-id="snippet:s1"]')).toBeNull())
    expect(document.activeElement).toBe(container.querySelector('[data-injectable-id="group:snippet"]'))
    // ArrowRight re-expands and the item reappears.
    await fireEvent.keyDown(input, { key: 'ArrowRight' })
    await waitFor(() =>
      expect(container.querySelector('[data-injectable-id="snippet:s1"]')).not.toBeNull(),
    )
  })

  it('Tab from a list row moves focus into the detail panel; Shift+Tab returns to the row', async () => {
    const { getByText, container } = render(InjectablePicker, { props: props() })
    await fireEvent.click(getByText('pr-boilerplate'))
    const row = container.querySelector('[data-injectable-id="snippet:s1"]') as HTMLElement
    row.focus()
    await fireEvent.keyDown(row, { key: 'Tab' })
    const detail = container.querySelector('.border-l') as HTMLElement
    expect(detail.contains(document.activeElement)).toBe(true)
    await fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(row)
  })

  it('keyboard nav keeps the list full-width; Space toggles the detail panel', async () => {
    const { getByPlaceholderText, container, queryByText } = render(InjectablePicker, { props: props() })
    const input = getByPlaceholderText('Search injectables…')
    await fireEvent.keyDown(input, { key: 'ArrowDown' }) // group:snippet
    await fireEvent.keyDown(input, { key: 'ArrowDown' }) // snippet:s1 (item)
    // Navigation does NOT auto-open the detail pane.
    expect(queryByText('Insert into prompt')).toBeNull()
    const row = container.querySelector('[data-injectable-id="snippet:s1"]') as HTMLElement
    await fireEvent.keyDown(row, { key: ' ' })
    expect(queryByText('Insert into prompt')).not.toBeNull() // Space opened it
    await fireEvent.keyDown(
      container.querySelector('[data-injectable-id="snippet:s1"]') as HTMLElement,
      { key: ' ' },
    )
    expect(queryByText('Insert into prompt')).toBeNull() // Space closed it
  })
})
