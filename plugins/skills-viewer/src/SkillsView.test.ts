import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import SkillsView from './SkillsView.svelte'
import { activeProjectId, selectedSkillIdentity, skills } from './lib/stores'
import type { SkillInfo } from './lib/skillDomain'
import type { FrontendOpenForgeAPI, OpenForgeContextSnapshot } from '@openforge/plugin-sdk/frontend'

vi.mock('@openforge/plugin-sdk/ui/MarkdownContent.svelte', async () => ({
  default: (await import('./test/MarkdownContentTestDouble.svelte')).default,
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function makeSkill(overrides: Partial<SkillInfo> = {}): SkillInfo {
  const name = overrides.name ?? 'review'
  return {
    name,
    description: 'Review code',
    agent: null,
    template: '# Review',
    level: 'project',
    source_dir: '.agents',
    source_path: overrides.name ?? 'review',
    file_name: null,
    relative_path: `${name}/SKILL.md`,
    ...overrides,
  }
}

function makeApi(invoke = vi.fn()): FrontendOpenForgeAPI {
  return {
    backend: {
      whenReady: vi.fn(async () => undefined),
      invoke,
    },
    navigation: { navigate: vi.fn(async () => undefined) },
    system: { openUrl: vi.fn(async () => undefined) },
  } as unknown as FrontendOpenForgeAPI
}

const context = { pluginId: 'com.openforge.skills-viewer', projectId: null } as OpenForgeContextSnapshot

function renderView(options: { api?: FrontendOpenForgeAPI; projectId?: string | null; projectName?: string } = {}) {
  return render(SkillsView, {
    props: {
      api: options.api ?? makeApi(vi.fn(async () => [])),
      context,
      projectName: options.projectName ?? 'Project',
      projectId: options.projectId === undefined ? 'P-1' : options.projectId,
    },
  })
}

describe('SkillsView project and async states', () => {
  beforeEach(() => {
    skills.set([])
    selectedSkillIdentity.set(null)
    activeProjectId.set(null)
    vi.clearAllMocks()
  })

  it('clears stale skills and selection and asks for a project when no project is active', async () => {
    const staleSkill = makeSkill({ name: 'stale' })
    skills.set([staleSkill])
    selectedSkillIdentity.set({ level: staleSkill.level, source_dir: staleSkill.source_dir, source_path: staleSkill.source_path, file_name: staleSkill.file_name, relative_path: staleSkill.relative_path })
    const invoke = vi.fn(async () => [makeSkill()])

    renderView({ api: makeApi(invoke), projectId: null, projectName: '' })

    expect((await screen.findAllByText(/select a project/i)).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/choose a project to view and edit its skills/i).length).toBeGreaterThan(0)
    expect(get(skills)).toEqual([])
    expect(get(selectedSkillIdentity)).toBeNull()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('announces loading with status semantics', async () => {
    const load = deferred<SkillInfo[]>()
    const invoke = vi.fn(() => load.promise)

    renderView({ api: makeApi(invoke), projectId: 'P-1' })

    const status = await screen.findByRole('status')
    expect(status.getAttribute('aria-live')).toBe('polite')
    expect(status.textContent).toMatch(/loading skills/i)

    load.resolve([])
  })

  it('ignores stale skill load results after switching projects', async () => {
    const firstLoad = deferred<SkillInfo[]>()
    const secondLoad = deferred<SkillInfo[]>()
    const invoke = vi.fn((method: string, request: { projectId: string }) => {
      if (method === 'listSkills' && request.projectId === 'P-1') return firstLoad.promise
      if (method === 'listSkills' && request.projectId === 'P-2') return secondLoad.promise
      return Promise.resolve([])
    })
    const view = renderView({ api: makeApi(invoke), projectId: 'P-1' })

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('listSkills', { projectId: 'P-1' }))
    await view.rerender({ api: makeApi(invoke), context, projectName: 'Project Two', projectId: 'P-2' })
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('listSkills', { projectId: 'P-2' }))

    const p2Skill = makeSkill({ name: 'project-two-skill' })
    secondLoad.resolve([p2Skill])
    await waitFor(() => expect(screen.getAllByText('project-two-skill').length).toBeGreaterThan(0))

    firstLoad.resolve([makeSkill({ name: 'stale-project-one-skill' })])

    await waitFor(() => {
      expect(screen.queryByText('stale-project-one-skill')).toBeNull()
      expect(get(skills).map((skill) => skill.name)).toEqual(['project-two-skill'])
      expect(get(activeProjectId)).toBe('P-2')
    })
  })

  it('announces load failures and offers a retry action for the active project', async () => {
    const invoke = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce([makeSkill({ name: 'retry-loaded' })])

    renderView({ api: makeApi(invoke), projectId: 'P-1' })

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/failed to load skills/i)

    await fireEvent.click(screen.getByRole('button', { name: /retry loading skills/i }))

    await waitFor(() => expect(screen.getAllByText('retry-loaded').length).toBeGreaterThan(0))
    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it('renders read-mode metadata and a labelled markdown article through the mounted DOM', async () => {
    const api = makeApi(vi.fn(async () => [makeSkill({
      name: 'guide',
      description: 'Helps reviewers use the project skill.',
      agent: 'worker',
      template: '---\nname: guide\ndescription: Hidden frontmatter\n---\n# Usage\nRead [docs](https://example.com/docs) before starting.',
      source_path: 'guide.md',
      file_name: 'guide.md',
      relative_path: 'guide.md',
    })]))

    renderView({ api, projectId: 'P-1' })

    const metadata = await screen.findByRole('region', { name: /skill metadata/i })
    expect(within(metadata).getByText('Helps reviewers use the project skill.')).toBeTruthy()
    expect(within(metadata).getByText('Repository')).toBeTruthy()
    expect(within(metadata).getByText('.agents/skills')).toBeTruthy()
    expect(within(metadata).getByText('guide.md')).toBeTruthy()
    expect(within(metadata).getByText('worker')).toBeTruthy()

    const article = screen.getByRole('article', { name: /guide skill markdown/i })
    expect(within(article).getByRole('heading', { name: 'Usage' })).toBeTruthy()
    expect(within(article).queryByText(/Hidden frontmatter/i)).toBeNull()

    const docsLink = within(article).getByRole('link', { name: 'docs' }) as HTMLAnchorElement
    docsLink.focus()
    expect(document.activeElement).toBe(docsLink)

    await fireEvent.click(docsLink)
    expect(api.system.openUrl).toHaveBeenCalledWith('https://example.com/docs')
  })

  it('preserves raw skill content when switching from read mode to manual edit mode', async () => {
    const rawSkillContent = '---\nname: raw-guide\ndescription: Raw frontmatter\n---\n# Usage\nKeep **all** original markdown.'
    const invoke = vi.fn(async () => [makeSkill({
      name: 'raw-guide',
      description: 'Rendered description',
      template: rawSkillContent,
    })])

    renderView({ api: makeApi(invoke), projectId: 'P-1' })

    const article = await screen.findByRole('article', { name: /raw-guide skill markdown/i })
    expect(within(article).queryByText(/Raw frontmatter/i)).toBeNull()
    expect(within(article).getByRole('heading', { name: 'Usage' })).toBeTruthy()

    await fireEvent.click(screen.getByRole('button', { name: /manually edit/i }))

    const textboxes = screen.getAllByRole('textbox')
    const editor = textboxes[textboxes.length - 1] as HTMLTextAreaElement
    expect(editor.value).toBe(rawSkillContent)
  })

  it('announces save failures and offers a retry save action', async () => {
    const skill = makeSkill({ name: 'editable', template: 'before' })
    const invoke = vi.fn()
      .mockResolvedValueOnce([skill])
      .mockRejectedValueOnce(new Error('save failed'))
      .mockResolvedValueOnce(undefined)

    renderView({ api: makeApi(invoke), projectId: 'P-1' })

    await waitFor(() => expect(screen.getAllByText('editable').length).toBeGreaterThan(0))
    await fireEvent.click(screen.getByRole('button', { name: /manually edit/i }))
    const textboxes = screen.getAllByRole('textbox')
    await fireEvent.input(textboxes[textboxes.length - 1], { target: { value: 'after' } })
    await fireEvent.click(screen.getByRole('button', { name: /^save$/i }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/save failed/i)

    await fireEvent.click(screen.getByRole('button', { name: /retry saving skill/i }))

    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(invoke).toHaveBeenLastCalledWith('saveSkillContent', expect.objectContaining({ projectId: 'P-1', content: 'after', relativePath: 'editable/SKILL.md' }))
  })

  it('saves the selected duplicate skill using its relative path', async () => {
    const alpha = makeSkill({ name: 'review', description: 'Alpha skill', relative_path: 'alpha/SKILL.md' })
    const beta = makeSkill({ name: 'review', description: 'Beta skill', relative_path: 'beta/SKILL.md' })
    const invoke = vi.fn()
      .mockResolvedValueOnce([alpha, beta])
      .mockResolvedValueOnce(undefined)

    renderView({ api: makeApi(invoke), projectId: 'P-1' })

    await waitFor(() => expect(screen.getByRole('button', { name: /review.*beta\/SKILL\.md/i })).toBeTruthy())
    await fireEvent.click(screen.getByRole('button', { name: /review.*beta\/SKILL\.md/i }))
    await fireEvent.click(screen.getByRole('button', { name: /manually edit/i }))
    const textboxes = screen.getAllByRole('textbox')
    await fireEvent.input(textboxes[textboxes.length - 1], { target: { value: '# Updated beta' } })
    await fireEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('saveSkillContent', expect.objectContaining({ relativePath: 'beta/SKILL.md', content: '# Updated beta' })))
  })

  it('refreshes displayed metadata from saved frontmatter before returning to read mode', async () => {
    const skill = makeSkill({
      name: 'old-review',
      description: 'Old description',
      template: '---\nname: old-review\ndescription: Old description\n---\n# Old body\n',
    })
    const invoke = vi.fn()
      .mockResolvedValueOnce([skill])
      .mockResolvedValueOnce(undefined)
    const updatedContent = '---\nname: updated-review\ndescription: Updated description\n---\n# Updated body\n'

    renderView({ api: makeApi(invoke), projectId: 'P-1' })

    await waitFor(() => expect(screen.getAllByText('old-review').length).toBeGreaterThan(0))
    await fireEvent.click(screen.getByRole('button', { name: /manually edit/i }))
    const textboxes = screen.getAllByRole('textbox')
    await fireEvent.input(textboxes[textboxes.length - 1], { target: { value: updatedContent } })
    await fireEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(screen.getAllByText('updated-review').length).toBeGreaterThan(0))
    expect(screen.getAllByText('Updated description').length).toBeGreaterThan(0)
    expect(get(skills)[0]).toMatchObject({ name: 'updated-review', source_path: 'old-review', description: 'Updated description', template: updatedContent })
    expect(get(selectedSkillIdentity)).toEqual({ level: 'project', source_dir: '.agents', source_path: 'old-review', file_name: null, relative_path: 'old-review/SKILL.md' })
    expect(invoke).toHaveBeenCalledWith('saveSkillContent', expect.objectContaining({ name: 'old-review', sourcePath: 'old-review', relativePath: 'old-review/SKILL.md' }))
  })

  it('keeps a shared personal skill locked while its save is in flight across project switches', async () => {
    const sharedSkill = makeSkill({ name: 'shared-user-skill', level: 'user', template: 'before' })
    const save = deferred<void>()
    const invoke = vi.fn((method: string, request: { projectId: string }) => {
      if (method === 'listSkills' && request.projectId === 'P-1') return Promise.resolve([sharedSkill])
      if (method === 'saveSkillContent') return save.promise
      if (method === 'listSkills' && request.projectId === 'P-2') return Promise.resolve([{ ...sharedSkill, template: 'still-before' }])
      return Promise.resolve([])
    })
    const view = renderView({ api: makeApi(invoke), projectId: 'P-1' })

    await waitFor(() => expect(screen.getAllByText('shared-user-skill').length).toBeGreaterThan(0))
    await fireEvent.click(screen.getByRole('button', { name: /manually edit/i }))
    const textboxes = screen.getAllByRole('textbox')
    await fireEvent.input(textboxes[textboxes.length - 1], { target: { value: 'first save' } })
    await fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('saveSkillContent', expect.objectContaining({ content: 'first save' })))

    await view.rerender({ api: makeApi(invoke), context, projectName: 'Project Two', projectId: 'P-2' })
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('listSkills', { projectId: 'P-2' }))
    await waitFor(() => expect(screen.getAllByText('shared-user-skill').length).toBeGreaterThan(0))

    const editButton = screen.getByRole('button', { name: /saving/i })
    expect(editButton.hasAttribute('disabled')).toBe(true)

    save.resolve()
    await waitFor(() => expect(screen.getByRole('button', { name: /manually edit/i }).hasAttribute('disabled')).toBe(false))
  })
})
