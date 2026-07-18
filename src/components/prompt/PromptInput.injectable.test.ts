import { render, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi } from 'vitest'
import PromptInput from './PromptInput.svelte'

vi.mock('../../lib/ipc', () => ({
  listOpenCodeCommands: vi.fn().mockResolvedValue([]),
  searchOpenCodeFiles: vi.fn().mockResolvedValue([]),
  listOpenCodeAgents: vi.fn().mockResolvedValue([]),
  getProjectConfig: vi.fn().mockResolvedValue('test-board'),
}))

describe('PromptInput injectable button', () => {
  it('renders the injectables button and calls onOpenPicker when clicked', async () => {
    const onOpenPicker = vi.fn()
    const { getByLabelText } = render(PromptInput, {
      props: { projectId: 'P-1', onSubmit: vi.fn(), onCancel: vi.fn(), onOpenPicker },
    })
    await fireEvent.click(getByLabelText('Open injectables'))
    expect(onOpenPicker).toHaveBeenCalled()
  })

  it('does not render the button when onOpenPicker is not provided', () => {
    const { queryByLabelText } = render(PromptInput, {
      props: { projectId: 'P-1', onSubmit: vi.fn(), onCancel: vi.fn() },
    })
    expect(queryByLabelText('Open injectables')).toBeNull()
  })

  it('inserts injectable text into the textarea when injectableInsertRequest changes', async () => {
    const base = { projectId: 'P-1', onSubmit: vi.fn(), onCancel: vi.fn(), value: '' }
    const { container, rerender } = render(PromptInput, {
      props: { ...base, injectableInsertRequest: null },
    })
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    expect(textarea).not.toBeNull()
    expect(textarea.value).toBe('')

    await rerender({ ...base, injectableInsertRequest: { id: 1, text: '/refactor ' } })
    expect(textarea.value).toContain('/refactor ')
  })
})
