import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import { createMemoryPluginStorage } from '@openforge-app/plugin-sdk/testing'
import type { CommandInfo } from '@openforge-app/plugin-sdk'
import InjectablesView from './InjectablesView.svelte'
import { listSnippets, createSnippet } from '@openforge-app/plugin-sdk/injectables'

vi.mock('@openforge-app/plugin-sdk/ui/MarkdownContent.svelte', async () => ({
  default: (await import('./test/MarkdownContentTestDouble.svelte')).default,
}))

const skill = (name: string, over: Partial<CommandInfo> = {}): CommandInfo => ({
  name, description: 'desc', source: 'skill', agent: null, origin: 'personal',
  triggerMode: 'auto+manual', sourceDir: '.claude', sourcePath: name, content: `# ${name}\nBody of ${name}`, ...over,
})

function makeApi(catalog: CommandInfo[]) {
  const storage = createMemoryPluginStorage()
  const invoke = vi.fn(async () => undefined)
  const api = {
    commands: { listCatalog: vi.fn(async () => catalog) },
    storage,
    backend: { whenReady: vi.fn(async () => undefined), invoke },
    navigation: { navigate: vi.fn(async () => undefined) },
    system: { openUrl: vi.fn(async () => undefined) },
  }
  return { api, storage, invoke }
}

function renderView(api: unknown, projectId: string | null = 'P-1') {
  return render(InjectablesView, { props: { api, context: {}, projectName: 'Project', projectId } as never })
}

describe('InjectablesView', () => {
  it('lists catalog skills/commands and stored snippets', async () => {
    const { api, storage } = makeApi([skill('refactor')])
    await createSnippet(storage.global, { name: 'PR boilerplate', body: '## Summary', allProjects: true, projectIds: [] })

    renderView(api)

    // 'refactor' is a skill (list only); the snippet auto-selects, so its name
    // shows in both the list and the detail header — hence getAllByText.
    expect((await screen.findAllByText('refactor')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('PR boilerplate').length).toBeGreaterThan(0)
  })

  it('renders the reading pane for the selected item', async () => {
    const { api } = makeApi([skill('refactor')])
    renderView(api)

    // The single skill auto-selects, so its content renders without a click.
    await waitFor(() => expect(screen.getByTestId('markdown-body')).toBeTruthy())
    expect(screen.getByText('Body of refactor')).toBeTruthy()
  })

  it('creates a snippet and persists it to storage.global', async () => {
    const { api, storage } = makeApi([])
    renderView(api)

    await fireEvent.click(await screen.findByText('+ Snippet'))
    await fireEvent.input(screen.getByPlaceholderText('Name'), { target: { value: 'My snip' } })
    await fireEvent.input(screen.getByPlaceholderText(/Body/), { target: { value: 'hello world' } })
    await fireEvent.click(screen.getByText('Save'))

    await waitFor(async () => expect(await listSnippets(storage.global)).toHaveLength(1))
    expect((await listSnippets(storage.global))[0]).toMatchObject({ name: 'My snip', body: 'hello world', allProjects: true })
  })

  it('deletes a snippet after confirmation', async () => {
    const { api, storage } = makeApi([])
    await createSnippet(storage.global, { name: 'Doomed', body: 'x', allProjects: true, projectIds: [] })

    renderView(api)

    // The lone snippet auto-selects, so Delete is already available.
    await fireEvent.click(await screen.findByText('Delete'))
    await fireEvent.click(screen.getByText('Confirm delete'))

    await waitFor(async () => expect(await listSnippets(storage.global)).toHaveLength(0))
  })
})
