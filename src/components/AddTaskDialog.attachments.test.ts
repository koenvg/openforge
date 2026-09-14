import { DEFAULT_WORKTREE_OPTIONS, findPromptTextbox, clickAddToBacklogFromMore, resetDialogMocks } from './AddTaskDialog.testFixtures'
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import AddTaskDialog from './AddTaskDialog.svelte'
import { createTask } from '../lib/ipc'

function setClipboardRead(read: () => Promise<Array<{ types: string[], getType: (type: string) => Promise<Blob> }>>) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { read },
  })
}

describe('AddTaskDialog attachments', () => {
  beforeEach(resetDialogMocks)

  it('restores a dismissed prompt with its pasted image and submits both', async () => {
    const first = render(AddTaskDialog, { props: { mode: 'create', onClose: vi.fn() } })
    const textbox = await findPromptTextbox()
    await fireEvent.input(textbox, { target: { value: 'Inspect screenshot' } })
    await fireEvent.paste(textbox, { clipboardData: { items: [{
      kind: 'file', type: 'image/png',
      getAsFile: () => new File(['image'], 'shot.png', { type: 'image/png' }),
    }] } })
    await waitFor(() => expect(textbox.value).toContain('[image#1]'))
    const dismissedPrompt = textbox.value
    first.unmount()

    render(AddTaskDialog, { props: { mode: 'create', onClose: vi.fn(), onTaskCreated: vi.fn() } })

    const restored = await findPromptTextbox()
    await waitFor(() => expect(restored.value).toBe(dismissedPrompt))
    expect(screen.getByRole('button', { name: 'Preview [image#1]' })).toBeTruthy()

    await clickAddToBacklogFromMore()

    await waitFor(() => expect(createTask).toHaveBeenCalled())
    expect(vi.mocked(createTask).mock.calls[0][0]).toContain('[image#1]: data:image/png;base64,')
  })

  it('preserves the draft and pasted image after persistence fails', async () => {
    vi.mocked(createTask).mockRejectedValueOnce(new Error('disk full'))
    const onClose = vi.fn()
    render(AddTaskDialog, { props: { mode: 'create', onClose } })
    const textbox = await findPromptTextbox()
    await fireEvent.input(textbox, { target: { value: 'Inspect screenshot' } })
    textbox.setSelectionRange(7, 7)
    await fireEvent.paste(textbox, { clipboardData: { items: [{
      kind: 'file', type: 'image/png',
      getAsFile: () => new File(['image'], 'shot.png', { type: 'image/png' }),
    }] } })
    await waitFor(() => expect(textbox.value).toContain('[image#1]'))
    const draft = textbox.value
    await clickAddToBacklogFromMore()
    await screen.findByText('Error: disk full')
    expect(onClose).not.toHaveBeenCalled()
    expect(textbox.value).toBe(draft)
    expect(screen.getByRole('button', { name: 'Preview [image#1]' })).toBeTruthy()
    await clickAddToBacklogFromMore()
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(vi.mocked(createTask).mock.calls[1][0]).toContain('[image#1]: data:image/png;base64,')
  })

  it('inserts a clipboard image marker into the prompt and persists the image reference', async () => {
    setClipboardRead(() => Promise.resolve([
      {
        types: ['image/png'],
        getType: async () => new Blob(['image-bytes'], { type: 'image/png' }),
      },
    ]))

    render(AddTaskDialog, { props: { mode: 'create' } })

    const textbox = await findPromptTextbox()
    await fireEvent.input(textbox, { target: { value: 'Build the screenshot state' } })
    textbox.setSelectionRange('Build'.length, 'Build'.length)
    await fireEvent.click(await screen.findByRole('button', { name: 'Attach image' }))

    await waitFor(() => {
      expect(textbox.value).toBe('Build [image#1] the screenshot state')
      expect(screen.getByText('1 image ready')).toBeTruthy()
    })

    await clickAddToBacklogFromMore()

    await waitFor(() => {
      const prompt = vi.mocked(createTask).mock.calls[0][0]
      expect(prompt).toContain('Build [image#1] the screenshot state')
      expect(prompt).toContain('[image#1]: data:image/png;base64,')
      expect(createTask).toHaveBeenCalledWith(prompt, 'backlog', 'test-project-id', 'default', DEFAULT_WORKTREE_OPTIONS)
    })
  })

  it('inserts an image marker at the textarea paste position', async () => {
    render(AddTaskDialog, { props: { mode: 'create' } })

    const textbox = await findPromptTextbox()
    await fireEvent.input(textbox, { target: { value: 'Use this screenshot' } })
    textbox.setSelectionRange('Use this'.length, 'Use this'.length)
    await fireEvent.paste(textbox, {
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

    await waitFor(() => {
      expect(textbox.value).toBe('Use this [image#1] screenshot')
      expect(screen.getByText('1 image ready')).toBeTruthy()
    })

    await clickAddToBacklogFromMore()

    await waitFor(() => {
      const prompt = vi.mocked(createTask).mock.calls[0][0]
      expect(prompt).toContain('Use this [image#1] screenshot')
      expect(prompt).toContain('[image#1]: data:image/png;base64,')
    })
  })

  it('opens a preview dialog when an inline image marker is clicked', async () => {
    render(AddTaskDialog, { props: { mode: 'create' } })

    const textbox = await findPromptTextbox()
    await fireEvent.input(textbox, { target: { value: 'Inspect screenshot' } })
    textbox.setSelectionRange('Inspect'.length, 'Inspect'.length)
    await fireEvent.paste(textbox, {
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

    await waitFor(() => {
      expect(textbox.value).toBe('Inspect [image#1] screenshot')
    })

    const markerStart = textbox.value.indexOf('[image#1]')
    textbox.setSelectionRange(markerStart + 2, markerStart + 2)
    await fireEvent.click(textbox)

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'Pasted image [image#1]' })).toBeTruthy()
      expect(screen.getByRole('img', { name: 'Pasted image [image#1]' })).toBeTruthy()
    })
  })

  it('removes a pasted image when its inline marker is deleted from the prompt', async () => {
    render(AddTaskDialog, { props: { mode: 'create' } })

    const textbox = await findPromptTextbox()
    await fireEvent.input(textbox, { target: { value: 'Use this screenshot' } })
    textbox.setSelectionRange('Use this'.length, 'Use this'.length)
    await fireEvent.paste(textbox, {
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

    await waitFor(() => {
      expect(textbox.value).toBe('Use this [image#1] screenshot')
      expect(screen.getByRole('button', { name: 'Preview [image#1]' })).toBeTruthy()
    })

    await fireEvent.input(textbox, { target: { value: 'Use this screenshot' } })

    await waitFor(() => {
      expect(screen.queryByText('1 image ready')).toBeNull()
      expect(screen.queryByRole('button', { name: 'Preview [image#1]' })).toBeNull()
    })

    await clickAddToBacklogFromMore()

    await waitFor(() => {
      const prompt = vi.mocked(createTask).mock.calls[0][0]
      expect(prompt).toBe('Use this screenshot')
      expect(prompt).not.toContain('[image#1]: data:image/png;base64,')
    })
  })
})
