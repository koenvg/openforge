import { render } from '@testing-library/svelte'
import { describe, it, expect, vi } from 'vitest'
import PromptInput from './PromptInput.svelte'

vi.mock('../../lib/ipc', () => ({
  listOpenCodeCommands: vi.fn().mockResolvedValue([]),
  searchOpenCodeFiles: vi.fn().mockResolvedValue([]),
  listOpenCodeAgents: vi.fn().mockResolvedValue([]),
  getProjectConfig: vi.fn().mockResolvedValue('test-board'),
}))

describe('PromptInput injectable button', () => {
  it('inserts injectable text into the textarea when injectableInsertRequest changes', async () => {
    const base = { projectId: 'P-1', onSubmit: vi.fn(), value: '' }
    const { container, rerender } = render(PromptInput, {
      props: { ...base, injectableInsertRequest: null },
    })
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    expect(textarea).not.toBeNull()
    expect(textarea.value).toBe('')

    await rerender({ ...base, injectableInsertRequest: { id: 1, text: '/refactor ' } })
    expect(textarea.value).toContain('/refactor ')
  })

  it('removes named skill tokens without touching the rest of the prompt', async () => {
    const base = { projectId: 'P-1', onSubmit: vi.fn(), value: 'Please /refactor the API and $commit later' }
    const { container, rerender } = render(PromptInput, {
      props: { ...base, injectableRemoveNamedTokensRequest: null },
    })
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    expect(textarea.value).toContain('/refactor')

    await rerender({ ...base, injectableRemoveNamedTokensRequest: { id: 1, names: ['refactor'] } })
    expect(textarea.value).not.toMatch(/(^|\s)\/refactor(\s|$)/)
    expect(textarea.value).toContain('the API')
    expect(textarea.value).toContain('$commit')
  })
})
