import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AddTaskDialog from './AddTaskDialog.svelte'
import { createTask, updateTaskInitialPrompt } from '../lib/ipc'
import type { TaskDetail } from '../lib/types'

vi.mock('../lib/ipc', () => ({
  createTask: vi.fn().mockResolvedValue({ id: 'T-new' }),
  updateTaskInitialPrompt: vi.fn().mockResolvedValue(undefined),
  getConfig: vi.fn().mockResolvedValue(null),
  getProjectConfig: vi.fn().mockResolvedValue(null),
  getResolvedAiProvider: vi.fn().mockResolvedValue('claude-code'),
  listGitBranches: vi.fn().mockResolvedValue([]),
  repoHasCommits: vi.fn().mockResolvedValue(true),
  getProjectTaskLabels: vi.fn().mockResolvedValue([]),
  listOpenCodeCommands: vi.fn().mockResolvedValue([]),
  searchOpenCodeFiles: vi.fn().mockResolvedValue([]),
  listOpenCodeAgents: vi.fn().mockResolvedValue([]),
}))

vi.mock('../lib/stores', () => {
  const { writable } = require('svelte/store')
  return { activeProjectId: writable('project-1') }
})

const task: TaskDetail = {
  id: 'T-1', projectId: 'project-1', status: 'backlog',
  prompt: 'Inspect [image#1]', promptPreview: 'Inspect [image#1]',
  title: 'Inspect', titleSource: null, titleGeneratedAt: null,
  agent: null, permissionMode: null, worktreeSource: null, worktreeBranch: null,
  sourceTicketUrl: null, dependsOn: [], labels: [], createdAt: 1, updatedAt: 1,
}
const firstPrompt = 'Inspect [image#1]\n\n[image#1]: data:image/png;base64,YQ=='

const textbox = () => screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'What should the agent do?' })

async function pasteImage() {
  const input = textbox()
  input.setSelectionRange(input.value.length, input.value.length)
  await fireEvent.paste(input, {
    clipboardData: { items: [{
      kind: 'file', type: 'image/png',
      getAsFile: () => new File(['image'], 'screenshot.png', { type: 'image/png' }),
    }] },
  })
  await waitFor(() => expect(screen.getByText('1 image ready')).toBeTruthy())
}

beforeEach(() => {
  vi.clearAllMocks()
  Element.prototype.scrollIntoView = vi.fn()
})

describe('AddTaskDialog prompt reseeding', () => {
  it.each(['keyboard', 'Start Task', 'Add to backlog'])('replaces a changed create seed and submits the visible draft via %s', async (submission) => {
    const { rerender } = render(AddTaskDialog, { mode: 'create', promptSeed: 'First seed' })
    await fireEvent.input(textbox(), { target: { value: 'My edits' } })
    await pasteImage()
    const editedPrompt = textbox().value

    await rerender({ mode: 'create', promptSeed: 'First seed', projectName: 'Renamed project' })
    expect(textbox().value).toBe(editedPrompt)
    expect(screen.getByText('1 image ready')).toBeTruthy()

    await rerender({ mode: 'create', promptSeed: 'Replacement seed' })
    expect(textbox().value).toBe('Replacement seed')
    expect(screen.queryByText('1 image ready')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Preview [image#1]' })).toBeNull()

    if (submission === 'keyboard') await fireEvent.keyDown(textbox(), { key: 'Enter', metaKey: true })
    else await fireEvent.click(screen.getByRole('button', { name: new RegExp(submission) }))
    await waitFor(() => expect(createTask).toHaveBeenCalled())
    expect(vi.mocked(createTask).mock.calls[0][0]).toBe('Replacement seed')
  })

  describe.each(['keyboard', 'footer'])('edit submission via %s', (submission) => {
    it.each([
      { change: 'task ID with identical prompt', nextTask: { ...task, id: 'T-2', prompt: firstPrompt }, visible: 'Inspect [image#1]' },
      { change: 'task text', nextTask: { ...task, prompt: 'Changed [image#2]\n\n[image#2]: data:image/png;base64,Yg==' }, visible: 'Changed [image#2]' },
      { change: 'image definition only', nextTask: { ...task, prompt: 'Inspect [image#1]\n\n[image#1]: data:image/png;base64,Yg==' }, visible: 'Inspect [image#1]' },
    ])('reseeds on $change but preserves edits for equivalent inputs', async ({ nextTask, visible }) => {
      const originalTask = { ...task, prompt: firstPrompt }
      const { rerender } = render(AddTaskDialog, { mode: 'edit', task: originalTask })
      await fireEvent.input(textbox(), { target: { value: 'My edits [image#1]' } })
      await rerender({ mode: 'edit', task: { ...originalTask, title: 'Renamed' }, onTaskSaved: vi.fn() })
      expect(textbox().value).toBe('My edits [image#1]')
      expect(screen.getByText('1 image ready')).toBeTruthy()
      if (submission === 'keyboard') await fireEvent.keyDown(textbox(), { key: 'Enter', ctrlKey: true })
      else await fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
      await waitFor(() => expect(updateTaskInitialPrompt).toHaveBeenCalledWith(
        'T-1', 'My edits [image#1]\n\n[image#1]: data:image/png;base64,YQ==',
      ))
      vi.mocked(updateTaskInitialPrompt).mockClear()
      await fireEvent.click(screen.getByRole('button', { name: 'Preview [image#1]' }))
      expect(screen.getByRole('dialog', { name: 'Pasted image [image#1]' })).toBeTruthy()

      await rerender({ mode: 'edit', task: nextTask })
      expect(textbox().value).toBe(visible)
      expect(screen.queryByRole('dialog', { name: 'Pasted image [image#1]' })).toBeNull()
      expect(screen.getByText('1 image ready')).toBeTruthy()
      if (submission === 'keyboard') await fireEvent.keyDown(textbox(), { key: 'Enter', ctrlKey: true })
      else await fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
      await waitFor(() => expect(updateTaskInitialPrompt).toHaveBeenCalledWith(nextTask.id, nextTask.prompt))
    })
  })

  it('reseeds when switching from edit to create even if the source text is identical', async () => {
    const { rerender } = render(AddTaskDialog, { mode: 'edit', task: { ...task, prompt: firstPrompt } })
    await fireEvent.input(textbox(), { target: { value: 'Unsaved edit [image#1]' } })
    await rerender({ mode: 'create', task: null, promptSeed: 'Inspect [image#1]' })
    expect(textbox().value).toBe('Inspect [image#1]')
    expect(screen.queryByText('1 image ready')).toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: 'Add to backlog' }))
    await waitFor(() => expect(createTask).toHaveBeenCalled())
    expect(vi.mocked(createTask).mock.calls[0][0]).toBe('Inspect [image#1]')
    expect(updateTaskInitialPrompt).not.toHaveBeenCalled()
  })

  it('clears the editor and disables footer submission when the seed becomes empty', async () => {
    const { rerender } = render(AddTaskDialog, { mode: 'create', promptSeed: 'First seed' })
    await pasteImage()
    await rerender({ mode: 'create', promptSeed: '' })
    expect(textbox().value).toBe('')
    expect(screen.queryByText('1 image ready')).toBeNull()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Add to backlog' }).disabled).toBe(true)
    await fireEvent.keyDown(textbox(), { key: 'Enter', metaKey: true })
    expect(createTask).not.toHaveBeenCalled()
  })

  it('ignores an image paste that finishes after the create seed changes', async () => {
    const readAsDataURL = FileReader.prototype.readAsDataURL
    let finishRead!: () => Promise<void>
    const readSpy = vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementationOnce(function (this: FileReader, blob) {
      finishRead = () => new Promise((resolve) => {
        this.addEventListener('loadend', () => resolve(), { once: true })
        readAsDataURL.call(this, blob)
      })
    })
    try {
      const { rerender } = render(AddTaskDialog, { mode: 'create', promptSeed: 'Old seed' })
      await fireEvent.paste(textbox(), {
        clipboardData: { items: [{
          kind: 'file', type: 'image/png',
          getAsFile: () => new File(['old image'], 'old.png', { type: 'image/png' }),
        }] },
      })
      await rerender({ mode: 'create', promptSeed: 'New seed' })
      await finishRead()
      expect(textbox().value).toBe('New seed')
      expect(screen.queryByText('1 image ready')).toBeNull()
      await fireEvent.click(screen.getByRole('button', { name: 'Add to backlog' }))
      await waitFor(() => expect(createTask).toHaveBeenCalled())
      expect(vi.mocked(createTask).mock.calls[0][0]).toBe('New seed')
    } finally {
      readSpy.mockRestore()
    }
  })
})
