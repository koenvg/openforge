import { cleanup, fireEvent, render, screen } from '@testing-library/svelte'
import { tick } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listOpenCodeAgents, listOpenCodeCommands, searchOpenCodeFiles } from '../../lib/ipc'
import PromptInput from './PromptInput.svelte'

vi.mock('../../lib/ipc', () => ({
  listOpenCodeAgents: vi.fn(),
  listOpenCodeCommands: vi.fn(),
  searchOpenCodeFiles: vi.fn(),
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function mount() {
  const onSubmit = vi.fn()
  const view = render(PromptInput, { projectId: 'project', onSubmit })
  const input = screen.getByRole('textbox') as HTMLTextAreaElement
  async function type(value: string) {
    input.value = value
    input.setSelectionRange(value.length, value.length)
    await fireEvent.input(input)
  }
  return { ...view, input, type, onSubmit }
}

async function settle() {
  await vi.advanceTimersByTimeAsync(0)
  await tick()
}

const commands = [
  { name: 'alpha', description: '', source: null, agent: null },
  { name: 'beta', description: '', source: null, agent: null },
]

describe('PromptInput autocomplete ownership', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetAllMocks()
    Element.prototype.scrollIntoView = vi.fn()
    vi.mocked(listOpenCodeCommands).mockResolvedValue(commands)
    vi.mocked(listOpenCodeAgents).mockResolvedValue([])
    vi.mocked(searchOpenCodeFiles).mockResolvedValue([])
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('keeps the newer command query when the older lookup finishes last', async () => {
    const old = deferred<Awaited<ReturnType<typeof listOpenCodeCommands>>>()
    vi.mocked(listOpenCodeCommands).mockReturnValueOnce(old.promise)
    const { type } = mount()
    await type('/a')
    await type('/b')
    await settle()
    expect(screen.getByRole('option').textContent).toContain('beta')
    old.resolve(commands)
    await settle()
    expect(screen.getByRole('option').textContent).toContain('beta')
  })

  it('discards a command lookup cancelled with Escape before suggestions appear', async () => {
    const lookup = deferred<typeof commands>()
    vi.mocked(listOpenCodeCommands).mockReturnValueOnce(lookup.promise)
    const { type, input } = mount()
    await type('/')
    await fireEvent.keyDown(input, { key: 'Escape' })
    lookup.resolve(commands)
    await settle()
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('does not start file searches when an agent lookup finishes after unmount', async () => {
    const lookup = deferred<Awaited<ReturnType<typeof listOpenCodeAgents>>>()
    vi.mocked(listOpenCodeAgents).mockReturnValueOnce(lookup.promise)
    const { type, unmount } = mount()
    await type('@old')
    unmount()
    lookup.resolve([{ name: 'old-agent', hidden: false, mode: 'chat' }])
    await vi.advanceTimersByTimeAsync(200)
    expect(searchOpenCodeFiles).not.toHaveBeenCalled()
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it.each(['resolve', 'reject'] as const)('ignores an old file search %s after a newer query', async (outcome) => {
    const old = deferred<string[]>()
    vi.mocked(searchOpenCodeFiles).mockReturnValueOnce(old.promise).mockResolvedValueOnce(['new.ts'])
    const { type } = mount()
    await type('@old')
    await vi.advanceTimersByTimeAsync(150)
    await type('@new')
    await vi.advanceTimersByTimeAsync(150)
    await tick()
    expect(screen.getByRole('option').textContent).toContain('new.ts')
    if (outcome === 'resolve') old.resolve(['old.ts'])
    else old.reject(new Error('old search failed'))
    await settle()
    expect(screen.getByRole('option').textContent).toContain('new.ts')
  })

  it.each(['escape', 'unmount', 'plain text', 'command'] as const)('releases a scheduled file search on %s', async (action) => {
    const { type, input, unmount } = mount()
    await type('@file')
    await settle()
    if (action === 'escape') await fireEvent.keyDown(input, { key: 'Escape' })
    else if (action === 'unmount') unmount()
    else await type(action === 'command' ? '/b' : 'plain text')
    await vi.advanceTimersByTimeAsync(200)
    expect(searchOpenCodeFiles).not.toHaveBeenCalled()
  })

  it.each(['escape', 'unmount'] as const)('discards an in-flight file lookup on %s', async (action) => {
    const lookup = deferred<string[]>()
    vi.mocked(searchOpenCodeFiles).mockReturnValueOnce(lookup.promise)
    const { type, input, unmount } = mount()
    await type('@file')
    await vi.advanceTimersByTimeAsync(150)
    expect(searchOpenCodeFiles).toHaveBeenCalledOnce()
    if (action === 'escape') await fireEvent.keyDown(input, { key: 'Escape' })
    else unmount()
    lookup.resolve(['file.ts'])
    await settle()
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('does not let a stale agent failure hide a newer command or schedule files', async () => {
    const lookup = deferred<Awaited<ReturnType<typeof listOpenCodeAgents>>>()
    vi.mocked(listOpenCodeAgents).mockReturnValueOnce(lookup.promise)
    const { type } = mount()
    await type('@old')
    await type('/b')
    lookup.reject(new Error('old agent lookup failed'))
    await vi.advanceTimersByTimeAsync(200)
    await tick()
    expect(screen.getByRole('option').textContent).toContain('beta')
    expect(searchOpenCodeFiles).not.toHaveBeenCalled()
  })

  it('keeps completion inline, clamps selection, and submits only after accepting a suggestion', async () => {
    const { type, input, onSubmit } = mount()
    input.focus()
    await type('/')
    await settle()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(input.getAttribute('aria-controls')).toBe(screen.getByRole('listbox').id)
    await fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(screen.getByRole('option', { selected: true }).textContent).toContain('alpha')
    await fireEvent.keyDown(input, { key: 'ArrowDown' })
    await fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(screen.getByRole('option', { selected: true }).textContent).toContain('beta')
    await fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })
    await settle()
    expect(input.value).toBe('/beta ')
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(input.getAttribute('aria-activedescendant')).toBeNull()
    expect(document.activeElement).toBe(input)
    await fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith('/beta')
  })

  it('dismisses suggestions before letting Escape bubble and preserves focus on pointer acceptance', async () => {
    const { type, input } = mount()
    input.focus()
    await type('/')
    await settle()
    expect(await fireEvent.keyDown(input, { key: 'Escape' })).toBe(false)
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(await fireEvent.keyDown(input, { key: 'Escape' })).toBe(true)
    await type('/a')
    await settle()
    const option = screen.getByRole('option', { name: 'alpha' })
    expect(await fireEvent.mouseDown(option)).toBe(false)
    await fireEvent.click(option)
    expect(input.value).toBe('/alpha ')
    expect(document.activeElement).toBe(input)
    expect(screen.queryByRole('listbox')).toBeNull()
  })
})
