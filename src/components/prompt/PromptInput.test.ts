import { render, screen, fireEvent, waitFor } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRawSnippet } from 'svelte'
import { requireElement } from '../../test-utils/dom'
import PromptInput from './PromptInput.svelte'

function createSnippet(text: string) {
  return createRawSnippet(() => ({
    render: () => `<span>${text}</span>`,
  }))
}

// Mock IPC functions
vi.mock('../../lib/ipc', () => ({
  listOpenCodeCommands: vi.fn().mockResolvedValue([]),
  searchOpenCodeFiles: vi.fn().mockResolvedValue([]),
  listOpenCodeAgents: vi.fn().mockResolvedValue([]),
  createTask: vi.fn(),
  updateTaskInitialPrompt: vi.fn(),
  getProjectConfig: vi.fn().mockResolvedValue('test-board'),
}))

describe('PromptInput', () => {
  const baseProps = {
    projectId: 'test-project',
    onSubmit: vi.fn(),
    onCancel: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('focuses textarea when autofocus is true', async () => {
    render(PromptInput, {
      props: {
        ...baseProps,
        autofocus: true,
      },
    })

    const textarea = screen.getByPlaceholderText('Describe what you want to implement...')
    // The focus uses requestAnimationFrame, so we need to wait for it
    await new Promise((resolve) => requestAnimationFrame(resolve))
    expect(document.activeElement).toBe(textarea)
  })

  it('does not focus textarea when autofocus is false', () => {
    render(PromptInput, {
      props: {
        ...baseProps,
        autofocus: false,
      },
    })

    const textarea = screen.getByPlaceholderText('Describe what you want to implement...')
    expect(document.activeElement).not.toBe(textarea)
  })

  it('renders textarea with placeholder', () => {
    const placeholder = 'Enter your prompt here'
    render(PromptInput, {
      props: {
        ...baseProps,
        placeholder,
      },
    })

    const textarea = screen.getByPlaceholderText(placeholder)
    expect(textarea).toBeTruthy()
  })

  it('calls onSubmit with text on Cmd+Enter', async () => {
    const onSubmit = vi.fn()
    render(PromptInput, {
      props: {
        ...baseProps,
        onSubmit,
      },
    })

    const textarea = requireElement(
      screen.getByPlaceholderText('Describe what you want to implement...'),
      HTMLTextAreaElement,
    )
    textarea.value = 'Fix the bug'
    await fireEvent.input(textarea)
    await fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true })

    expect(onSubmit).toHaveBeenCalledWith('Fix the bug')
  })

  it('does not submit on plain Enter (allows newline)', async () => {
    const onSubmit = vi.fn()
    render(PromptInput, {
      props: {
        ...baseProps,
        onSubmit,
      },
    })

    const textarea = requireElement(
      screen.getByPlaceholderText('Describe what you want to implement...'),
      HTMLTextAreaElement,
    )
    textarea.value = 'Fix the bug'
    await fireEvent.input(textarea)
    await fireEvent.keyDown(textarea, { key: 'Enter' })

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('calls onCancel on Escape', async () => {
    const onCancel = vi.fn()
    render(PromptInput, {
      props: {
        ...baseProps,
        onCancel,
      },
    })

    const textarea = screen.getByPlaceholderText('Describe what you want to implement...')
    await fireEvent.keyDown(textarea, { key: 'Escape' })

    expect(onCancel).toHaveBeenCalled()
  })

  it('renders a submit button', () => {
    render(PromptInput, { props: { ...baseProps } })
    const button = screen.getByRole('button', { name: 'Submit' })
    expect(button).toBeTruthy()
  })

  it('submit button is disabled when textarea is empty', () => {
    render(PromptInput, { props: { ...baseProps } })
    const button = requireElement(screen.getByRole('button', { name: 'Submit' }), HTMLButtonElement)
    expect(button.disabled).toBe(true)
  })

  it('calls onSubmit when submit button is clicked', async () => {
    const onSubmit = vi.fn()
    render(PromptInput, {
      props: {
        ...baseProps,
        onSubmit,
      },
    })

    const textarea = requireElement(
      screen.getByPlaceholderText('Describe what you want to implement...'),
      HTMLTextAreaElement,
    )
    textarea.value = 'Fix the bug'
    await fireEvent.input(textarea)
    const button = screen.getByRole('button', { name: 'Submit' })
    await fireEvent.click(button)

    expect(onSubmit).toHaveBeenCalledWith('Fix the bug')
  })

  it('does not submit empty text', async () => {
    const onSubmit = vi.fn()
    render(PromptInput, {
      props: {
        ...baseProps,
        onSubmit,
      },
    })

    const textarea = screen.getByPlaceholderText('Describe what you want to implement...')
    await fireEvent.keyDown(textarea, { key: 'Enter' })

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('pre-populates in edit mode', () => {
    render(PromptInput, {
      props: {
        ...baseProps,
        value: 'Fix the bug',
      },
    })

    const textarea = requireElement(
      screen.getByPlaceholderText('Describe what you want to implement...'),
      HTMLTextAreaElement,
    )
    expect(textarea.value).toBe('Fix the bug')
  })

  it('inserts pasted image markers at the original paste position after async processing', async () => {
    let resolveMarker: (marker: string) => void = () => {}
    const onPasteImage = vi.fn(() => new Promise<string>((resolve) => {
      resolveMarker = resolve
    }))

    render(PromptInput, {
      props: {
        ...baseProps,
        onPasteImage,
      },
    })

    const textarea = requireElement(
      screen.getByPlaceholderText('Describe what you want to implement...'),
      HTMLTextAreaElement,
    )
    textarea.value = 'Use this screenshot'
    textarea.setSelectionRange('Use this'.length, 'Use this'.length)
    await fireEvent.input(textarea)

    const paste = fireEvent.paste(textarea, {
      clipboardData: {
        items: [
          {
            kind: 'file',
            type: 'image/png',
            getAsFile: () => new File(['image-bytes'], 'screenshot.png', { type: 'image/png' }),
          },
        ],
      },
    })
    textarea.setSelectionRange(0, 0)
    resolveMarker('[image#1]')
    await paste

    await waitFor(() => {
      expect(textarea.value).toBe('Use this [image#1] screenshot')
    })
  })

  it('only opens an image marker preview when the caret is inside the marker text', async () => {
    const onImageMarkerClick = vi.fn()
    render(PromptInput, {
      props: {
        ...baseProps,
        value: 'Inspect [image#1] now',
        onImageMarkerClick,
      },
    })

    const textarea = requireElement(
      screen.getByPlaceholderText('Describe what you want to implement...'),
      HTMLTextAreaElement,
    )
    const markerStart = textarea.value.indexOf('[image#1]')
    const markerEnd = markerStart + '[image#1]'.length

    textarea.setSelectionRange(markerEnd, markerEnd)
    await fireEvent.click(textarea)
    expect(onImageMarkerClick).not.toHaveBeenCalled()

    textarea.setSelectionRange(markerStart + 2, markerStart + 2)
    await fireEvent.click(textarea)
    expect(onImageMarkerClick).toHaveBeenCalledWith('[image#1]')
  })

  describe('composer extension points', () => {
    it('renders parent-provided footer help and controls without owning create-task outcomes', () => {
      render(PromptInput, {
        props: {
          ...baseProps,
          footerHelp: createSnippet('Parent owns outcome help'),
          controls: createSnippet('Parent Primary Action'),
        },
      })

      expect(screen.getByText('Parent owns outcome help')).toBeTruthy()
      expect(screen.getByText('Parent Primary Action')).toBeTruthy()
      expect(screen.queryByText('Start Task', { exact: false })).toBeNull()
      expect(screen.queryByRole('button', { name: 'More' })).toBeNull()
      expect(screen.queryByRole('menuitem', { name: 'Add to Backlog' })).toBeNull()
    })

    it('reports draft changes to parent-owned controls', async () => {
      const onValueChange = vi.fn()
      render(PromptInput, {
        props: {
          ...baseProps,
          onValueChange,
          controls: createSnippet('Parent Primary Action'),
        },
      })

      const textarea = requireElement(
        screen.getByPlaceholderText('Describe what you want to implement...'),
        HTMLTextAreaElement,
      )
      await fireEvent.input(textarea, { target: { value: 'New feature' } })

      expect(onValueChange).toHaveBeenLastCalledWith('New feature')
    })
  })

  describe('List Navigation', () => {
    beforeEach(() => {
      Element.prototype.scrollIntoView = vi.fn()
    })

    it('navigates @ autocomplete with Ctrl+J and Enter', async () => {
      const { listOpenCodeAgents } = await import('../../lib/ipc')
      vi.mocked(listOpenCodeAgents).mockResolvedValue([
        { name: 'alpha', hidden: false, mode: 'chat' },
        { name: 'beta', hidden: false, mode: 'chat' },
      ])

      render(PromptInput, { props: { ...baseProps } })
      const textarea = requireElement(
        screen.getByPlaceholderText('Describe what you want to implement...'),
        HTMLTextAreaElement,
      )

      textarea.value = '@'
      textarea.selectionStart = 1
      textarea.selectionEnd = 1
      await fireEvent.input(textarea)

      await waitFor(() => {
        expect(screen.queryAllByRole('option').length).toBeGreaterThan(0)
      })

      await fireEvent.keyDown(textarea, { key: 'j', ctrlKey: true })
      await fireEvent.keyDown(textarea, { key: 'Enter' })

      expect(textarea.value).toBe('@beta')
    })

    it('links the composer to active autocomplete option ids and clears the link when suggestions close', async () => {
      const { listOpenCodeCommands } = await import('../../lib/ipc')
      vi.mocked(listOpenCodeCommands).mockResolvedValue([
        { name: 'cmd1', description: '', source: null, agent: null },
        { name: 'cmd2', description: '', source: null, agent: null },
      ])

      render(PromptInput, { props: { ...baseProps } })
      const textarea = requireElement(
        screen.getByPlaceholderText('Describe what you want to implement...'),
        HTMLTextAreaElement,
      )

      textarea.value = '/'
      textarea.selectionStart = 1
      textarea.selectionEnd = 1
      await fireEvent.input(textarea)

      await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2))

      const listbox = screen.getByRole('listbox')
      const options = screen.getAllByRole('option')
      expect(listbox.id).not.toBe('')
      expect(textarea.getAttribute('aria-controls')).toBe(listbox.id)
      expect(options.every(option => option.id !== '')).toBe(true)
      expect(textarea.getAttribute('aria-activedescendant')).toBe(options[0].id)

      await fireEvent.keyDown(textarea, { key: 'ArrowDown' })
      expect(textarea.getAttribute('aria-activedescendant')).toBe(options[1].id)

      await fireEvent.keyDown(textarea, { key: 'Escape' })
      expect(screen.queryByRole('listbox')).toBeNull()
      expect(textarea.getAttribute('aria-activedescendant')).toBeNull()
    })

    it('inserts Codex skill commands with the dollar trigger', async () => {
      const { listOpenCodeCommands } = await import('../../lib/ipc')
      vi.mocked(listOpenCodeCommands).mockResolvedValue([
        { name: 'skill:grill-with-docs', description: 'Grill with docs', source: 'skill', agent: null },
      ])

      render(PromptInput, { props: { ...baseProps, commandTrigger: 'dollar' } })
      const textarea = requireElement(
        screen.getByPlaceholderText('Describe what you want to implement...'),
        HTMLTextAreaElement,
      )

      textarea.value = '$skill'
      textarea.selectionStart = 6
      textarea.selectionEnd = 6
      await fireEvent.input(textarea)

      await waitFor(() => {
        expect(screen.queryAllByRole('option').length).toBeGreaterThan(0)
      })

      await fireEvent.keyDown(textarea, { key: 'Enter' })

      expect(textarea.value).toBe('$skill:grill-with-docs ')
    })

    it('navigates autocomplete popover with ArrowDown/ArrowUp and Ctrl+J/Ctrl+K', async () => {
      const { listOpenCodeCommands } = await import('../../lib/ipc')
      vi.mocked(listOpenCodeCommands).mockResolvedValue([
        { name: 'cmd1', description: '', source: null, agent: null },
        { name: 'cmd2', description: '', source: null, agent: null },
        { name: 'cmd3', description: '', source: null, agent: null },
      ])
      
      render(PromptInput, { props: { ...baseProps } })
      const textarea = requireElement(
        screen.getByPlaceholderText('Describe what you want to implement...'),
        HTMLTextAreaElement,
      )
      
      textarea.value = '/'
      textarea.selectionStart = 1
      textarea.selectionEnd = 1
      await fireEvent.input(textarea)
      
      await waitFor(() => {
        expect(screen.queryAllByRole('option').length).toBeGreaterThan(0)
      })
      
      await fireEvent.keyDown(textarea, { key: 'ArrowDown' })
      await fireEvent.keyDown(textarea, { key: 'j', ctrlKey: true })
      await fireEvent.keyDown(textarea, { key: 'ArrowUp' })
      await fireEvent.keyDown(textarea, { key: 'k', ctrlKey: true })
      
      await fireEvent.keyDown(textarea, { key: 'Enter' })
      
      expect(textarea.value).toBe('/cmd1 ')
    })
  })
})
