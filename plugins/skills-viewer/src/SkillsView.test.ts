import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import SkillsView from './SkillsView.svelte'
import { activeProjectId, selectedSkillIdentity, skills } from './lib/stores'
import type { SkillInfo } from './lib/skillDomain'
import type { FrontendOpenForgeAPI, OpenForgeContextSnapshot } from '@openforge/plugin-sdk/frontend'

vi.mock('@openforge/plugin-sdk/ui/MarkdownContent.svelte', () => ({
  default: vi.fn(() => null),
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
  return {
    name: 'review',
    description: 'Review code',
    agent: null,
    template: '# Review',
    level: 'project',
    source_dir: '.agents',
    source_path: overrides.name ?? 'review',
    file_name: null,
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
    selectedSkillIdentity.set({ level: staleSkill.level, source_dir: staleSkill.source_dir, source_path: staleSkill.source_path, file_name: staleSkill.file_name })
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
    expect(invoke).toHaveBeenLastCalledWith('saveSkillContent', expect.objectContaining({ projectId: 'P-1', content: 'after' }))
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
    expect(get(selectedSkillIdentity)).toEqual({ level: 'project', source_dir: '.agents', source_path: 'old-review', file_name: null })
    expect(invoke).toHaveBeenCalledWith('saveSkillContent', expect.objectContaining({ name: 'old-review', sourcePath: 'old-review' }))
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
