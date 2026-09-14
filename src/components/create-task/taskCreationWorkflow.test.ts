import { beforeEach, describe, expect, it } from 'vitest'
import { clearAllCreateTaskDrafts, readCreateTaskDraft } from '../../lib/createTaskDraftStore'
import { createTaskCreationWorkflow } from './taskCreationWorkflow.svelte'
import { LocalTaskCreationAdapter } from './testing/localTaskCreationAdapter'

describe('task creation workflow', () => {
  it('hands off a saved task and closes without awaiting follow-up work', async () => {
    const adapter = new LocalTaskCreationAdapter()
    const workflow = createTaskCreationWorkflow(adapter)
    const events: string[] = []
    workflow.configure({ projectId: 'project', promptSeed: 'Build',
      onTaskCreated: (task, intent) => { events.push(`${task.id}:${intent}`) },
      onClose: () => { events.push('close') },
    })
    await workflow.initialize()
    await workflow.submit('start')
    await workflow.submit('start')
    expect(events).toEqual(['T-1:start', 'close'])
    expect(adapter.created).toHaveLength(1)
  })

  it('can create with inherited defaults while origin is stalled', async () => {
    const adapter = new LocalTaskCreationAdapter()
    adapter.listGitBranches = () => new Promise(() => {})
    const workflow = createTaskCreationWorkflow(adapter)
    workflow.configure({ projectId: 'project', projectPath: '/repo', promptSeed: '  Build it  ' })
    await workflow.initialize()
    expect(workflow.state.branchList.status).toBe('loading')
    expect(workflow.state.createReady).toBe(true)
    await workflow.submit()
    expect(adapter.created[0]).toMatchObject({ prompt: 'Build it', projectId: 'project', options: { aiProvider: 'claude-code', worktreeSource: 'newBranchFromMain' } })
  })

  it('ignores initialization that completes after the dialog is disposed', async () => {
    const adapter = new LocalTaskCreationAdapter()
    let finish!: (value: typeof adapter.defaults) => void
    adapter.loadTaskLevelDefaults = () => new Promise((resolve) => { finish = resolve })
    const workflow = createTaskCreationWorkflow(adapter)
    workflow.configure({ projectId: 'project', projectPath: '/repo' })
    const initializing = workflow.initialize()
    workflow.dispose()
    finish({ ...adapter.defaults, aiProvider: 'codex' })
    await initializing
    expect(workflow.state.draft.aiProvider).toBeNull()
    expect(workflow.state.branchList.status).toBe('loading')
  })

  it.each(['resolve', 'reject'] as const)('ignores defaults that %s after a superseding retry', async (outcome) => {
    const adapter = new LocalTaskCreationAdapter()
    let finish!: (value: typeof adapter.defaults) => void
    let fail!: (error: Error) => void
    adapter.loadTaskLevelDefaults = () => new Promise((resolve, reject) => { finish = resolve; fail = reject })
    const workflow = createTaskCreationWorkflow(adapter)
    workflow.configure({ projectId: 'project', projectPath: '/repo', promptSeed: 'Build' })
    const superseded = workflow.initialize()
    adapter.loadTaskLevelDefaults = async () => ({ ...adapter.defaults, aiProvider: 'codex' })
    await workflow.initialize()
    if (outcome === 'resolve') finish(adapter.defaults)
    else fail(new Error('stale defaults failure'))
    await superseded
    expect(workflow.state.draft.aiProvider).toBe('codex')
    expect(workflow.state.taskDefaultsError).toBeNull()
    expect(workflow.state.createReady).toBe(true)
    await workflow.submit()
    expect(adapter.created[0].options?.aiProvider).toBe('codex')
  })

  describe.each(['reset', 'dispose'] as const)('attachment invalidation on %s', (invalidation) => {
    it.each(['resolve', 'reject'] as const)('ignores image reads that %s after invalidation', async (outcome) => {
      const adapter = new LocalTaskCreationAdapter()
      const editTask = await adapter.createTask('Edit prompt', 'backlog', 'project', 'default')
      let finish!: (url: string) => void
      let fail!: (error: Error) => void
      adapter.readImage = () => new Promise((resolve, reject) => { finish = resolve; fail = reject })
      const workflow = createTaskCreationWorkflow(adapter)
      workflow.configure({ projectId: 'project' })
      const reading = workflow.attachments.attachImage(new Blob(['image'], { type: 'image/png' }))
      expect(workflow.attachments.state.pending).toBe(1)
      if (invalidation === 'reset') workflow.configure({ projectId: 'project', mode: 'edit', task: editTask })
      else workflow.dispose()
      if (outcome === 'resolve') finish('data:image/png;base64,AA==')
      else fail(new Error('stale image failure'))
      expect(await reading).toBeNull()
      expect(workflow.attachments.state.images).toEqual([])
      expect(workflow.attachments.state.error).toBeNull()
      expect(workflow.attachments.state.pending).toBe(0)
      expect(workflow.attachments.state.insertRequest).toBeNull()
    })

    it.each(['resolve', 'reject'] as const)('ignores clipboard reads that %s after invalidation', async (outcome) => {
      const adapter = new LocalTaskCreationAdapter()
      const editTask = await adapter.createTask('Edit prompt', 'backlog', 'project', 'default')
      let finish!: (blob: Blob) => void
      let fail!: (error: Error) => void
      adapter.readClipboardImage = () => new Promise((resolve, reject) => { finish = resolve; fail = reject })
      const workflow = createTaskCreationWorkflow(adapter)
      workflow.configure({ projectId: 'project' })
      const reading = workflow.attachments.pasteFromClipboard()
      expect(workflow.attachments.state.pending).toBe(1)
      if (invalidation === 'reset') workflow.configure({ projectId: 'project', mode: 'edit', task: editTask })
      else workflow.dispose()
      if (outcome === 'resolve') finish(new Blob(['image'], { type: 'image/png' }))
      else fail(new Error('stale clipboard failure'))
      await reading
      expect(workflow.attachments.state.images).toEqual([])
      expect(workflow.attachments.state.error).toBeNull()
      expect(workflow.attachments.state.pending).toBe(0)
      expect(workflow.attachments.state.insertRequest).toBeNull()
    })
  })

  it('blocks creation after defaults fail and supports retry without losing the prompt', async () => {
    const adapter = new LocalTaskCreationAdapter()
    adapter.loadTaskLevelDefaults = async () => { throw new Error('offline') }
    const workflow = createTaskCreationWorkflow(adapter)
    workflow.configure({ projectId: 'project', promptSeed: 'Keep this' })
    await workflow.initialize()
    await workflow.submit()
    expect(adapter.created).toHaveLength(0)
    expect(workflow.state.error).toBe('Could not load task defaults. Retry before creating this task.')
    adapter.loadTaskLevelDefaults = async () => adapter.defaults
    await workflow.initialize()
    await workflow.submit()
    expect(adapter.created[0].prompt).toBe('Keep this')
    expect(workflow.state.taskDefaultsError).toBeNull()
  })

  it('uses the project directory for a repository with no commits, even with a branch seed', async () => {
    const adapter = new LocalTaskCreationAdapter()
    adapter.hasCommits = false
    const workflow = createTaskCreationWorkflow(adapter)
    workflow.configure({ projectId: 'project', projectPath: '/repo', promptSeed: 'Build', worktreeSourceSeed: 'existingBranch', worktreeBranchSeed: 'feature' })
    await workflow.initialize()
    expect(workflow.state.worktreeAllowed).toBe(false)
    await workflow.submit()
    expect(adapter.created[0].options).toMatchObject({ worktreeSource: 'disabled', worktreeBranch: null })
  })

  it('preserves edited fields for unchanged seeds and applies a new compose request', async () => {
    const workflow = createTaskCreationWorkflow(new LocalTaskCreationAdapter())
    const input = { projectId: 'project', titleSeed: 'Title', promptSeed: 'Seed' }
    workflow.configure(input)
    await workflow.initialize()
    workflow.state.draft.title = 'My title'
    workflow.state.promptDraft = 'My prompt'
    workflow.configure({ ...input })
    expect(workflow.state.draft.title).toBe('My title')
    expect(workflow.state.promptDraft).toBe('My prompt')
    workflow.configure({ ...input, titleSeed: 'Next title', promptSeed: 'Next prompt' })
    expect(workflow.state.draft.title).toBe('Next title')
    expect(workflow.state.promptDraft).toBe('Next prompt')
  })

  it('requires an existing branch while origin is loading but accepts an explicit seed', async () => {
    const adapter = new LocalTaskCreationAdapter()
    adapter.listGitBranches = () => new Promise(() => {})
    const workflow = createTaskCreationWorkflow(adapter)
    workflow.configure({ projectId: 'project', projectPath: '/repo', promptSeed: 'Build' })
    await workflow.initialize()
    workflow.state.draft.worktreeSource = 'existingBranch'
    await workflow.submit()
    expect(workflow.state.error).toBe('Branches are still loading. Wait for the list before starting from an existing branch.')
    expect(adapter.created).toHaveLength(0)
    workflow.configure({ projectId: 'project', projectPath: '/repo', promptSeed: 'Build', worktreeSourceSeed: 'existingBranch', worktreeBranchSeed: ' feature ' })
    await workflow.submit()
    expect(adapter.created[0].options).toMatchObject({ worktreeSource: 'existingBranch', worktreeBranch: 'feature' })
  })

  it('ignores superseded branch replies', async () => {
    const adapter = new LocalTaskCreationAdapter()
    let finish!: (branches: typeof adapter.branches) => void
    adapter.listGitBranches = () => new Promise((resolve) => { finish = resolve })
    const workflow = createTaskCreationWorkflow(adapter)
    workflow.configure({ projectId: 'project', projectPath: '/repo' })
    await workflow.initialize()
    adapter.branches = [{ name: 'new', is_current: false, is_remote: false }]
    adapter.listGitBranches = async () => adapter.branches
    await workflow.initialize()
    finish([{ name: 'old', is_current: false, is_remote: false }])
    await Promise.resolve()
    expect(workflow.state.draft.existingBranch).toBe('new')
  })

  it('blocks concurrent submissions while persistence is pending', async () => {
    const adapter = new LocalTaskCreationAdapter()
    const persist = adapter.createTask.bind(adapter)
    let finish!: () => void
    adapter.createTask = async (...args) => {
      await new Promise<void>(resolve => { finish = resolve })
      return persist(...args)
    }
    const workflow = createTaskCreationWorkflow(adapter)
    workflow.configure({ projectId: 'project', promptSeed: 'Build' })
    await workflow.initialize()
    const submitting = workflow.submit('start')
    await workflow.submit('backlog')
    expect(workflow.state.isSaving).toBe(true)
    finish()
    await submitting
    await workflow.submit()
    expect(adapter.created).toHaveLength(1)
    expect(workflow.state.isSaving).toBe(false)
  })

  it('keeps a persistence failure visible and releases the submission lock', async () => {
    const adapter = new LocalTaskCreationAdapter()
    const persist = adapter.createTask.bind(adapter)
    adapter.createTask = async () => { throw new Error('disk full') }
    let closed = false
    const workflow = createTaskCreationWorkflow(adapter)
    workflow.configure({ projectId: 'project', promptSeed: 'Build', onClose: () => { closed = true } })
    await workflow.initialize()
    await workflow.submit()
    expect(workflow.state.error).toBe('Error: disk full')
    expect(workflow.state.isSaving).toBe(false)
    expect(workflow.state.submissionIntent).toBeNull()
    expect(closed).toBe(false)
    adapter.createTask = persist
    await workflow.submit()
    expect(adapter.created).toHaveLength(1)
    expect(workflow.state.error).toBeNull()
    expect(closed).toBe(true)
  })

  it('includes pasted images when saving and restores them for editing', async () => {
    const adapter = new LocalTaskCreationAdapter()
    const workflow = createTaskCreationWorkflow(adapter)
    workflow.configure({ projectId: 'project' })
    await workflow.initialize()
    const marker = await workflow.attachments.attachImage(new Blob(['image'], { type: 'image/png' }))
    expect(marker).toBe('[image#1]')
    workflow.state.promptDraft = `Inspect ${marker}`
    await workflow.submit()
    expect(adapter.tasks[0].prompt).toContain('data:image/png;base64,dGVzdA==')
    workflow.configure({ projectId: 'project', mode: 'edit', task: adapter.tasks[0] })
    expect(workflow.state.promptDraft).toBe('Inspect [image#1]')
    expect(workflow.attachments.state.images).toHaveLength(1)
    workflow.attachments.openPreview('[image#1]')
    expect(workflow.attachments.state.preview?.marker).toBe('[image#1]')
    workflow.attachments.syncWithPrompt('No image')
    workflow.state.promptDraft = 'No image'
    expect(workflow.attachments.state.preview).toBeNull()
    await workflow.submit()
    expect(adapter.updated).toEqual([{ id: 'T-1', prompt: 'No image' }])
    expect(adapter.created).toHaveLength(1)
  })

  it('blocks saving until all concurrent image reads finish', async () => {
    const adapter = new LocalTaskCreationAdapter()
    const reads: Array<(url: string) => void> = []
    adapter.readImage = () => new Promise((resolve) => { reads.push(resolve) })
    const workflow = createTaskCreationWorkflow(adapter)
    workflow.configure({ projectId: 'project', promptSeed: 'Build' })
    await workflow.initialize()
    const blob = new Blob(['image'], { type: 'image/png' })
    const first = workflow.attachments.attachImage(blob)
    const second = workflow.attachments.attachImage(blob)
    reads[0]('data:image/png;base64,AA==')
    await first
    await workflow.submit()
    expect(adapter.created).toHaveLength(0)
    expect(workflow.state.error).toBe('Wait for the pasted image to finish processing.')
    reads[1]('data:image/png;base64,AQ==')
    await second
    await workflow.submit()
    expect(adapter.created).toHaveLength(1)
  })

  it('owns clipboard insertion and rejects invalid or unreadable images', async () => {
    const adapter = new LocalTaskCreationAdapter()
    const workflow = createTaskCreationWorkflow(adapter)
    workflow.configure({ projectId: 'project' })
    await workflow.attachments.pasteFromClipboard()
    expect(workflow.attachments.state.error).toBe('Clipboard does not contain an image.')
    adapter.clipboardImage = new Blob(['image'], { type: 'image/png' })
    await workflow.attachments.pasteFromClipboard()
    expect(workflow.attachments.state.insertRequest).toEqual({ id: 1, marker: '[image#1]' })
    await workflow.attachments.attachImage(new Blob(['text'], { type: 'text/plain' }))
    expect(workflow.attachments.state.error).toBe('Clipboard item is not an image.')
    adapter.readImage = async () => { throw new Error('read failed') }
    await workflow.attachments.attachImage(adapter.clipboardImage)
    expect(workflow.attachments.state.error).toBe('Could not read the pasted image.')
    expect(workflow.attachments.state.pending).toBe(0)
  })
})

describe('retained prompt drafts', () => {
  beforeEach(() => {
    clearAllCreateTaskDrafts()
  })

  async function openCreateSession(adapter: LocalTaskCreationAdapter, projectId = 'project') {
    const workflow = createTaskCreationWorkflow(adapter)
    workflow.configure({ projectId })
    await workflow.initialize()
    return workflow
  }

  it('retains the prompt of an unseeded create session', async () => {
    const workflow = await openCreateSession(new LocalTaskCreationAdapter())

    workflow.setPrompt('Fix the flaky test')

    expect(readCreateTaskDraft('project')?.prompt).toBe('Fix the flaky test')
  })

  it('restores a retained prompt into a later session', async () => {
    const adapter = new LocalTaskCreationAdapter()
    const first = await openCreateSession(adapter)
    first.setPrompt('Fix the flaky test')
    first.dispose()

    const second = await openCreateSession(adapter)

    expect(second.state.promptDraft).toBe('Fix the flaky test')
    expect(second.state.initialPrompt).toBe('Fix the flaky test')
  })

  it('restores pasted images so a restored prompt submits complete', async () => {
    const adapter = new LocalTaskCreationAdapter()
    const first = await openCreateSession(adapter)
    const marker = await first.attachments.attachImage(new Blob(['image'], { type: 'image/png' }))
    first.setPrompt(`Look at ${marker}`)
    first.dispose()

    const second = await openCreateSession(adapter)
    expect(second.attachments.state.images.map((image) => image.marker)).toEqual(['[image#1]'])

    await second.submit('backlog')

    expect(adapter.created[0].prompt).toBe('Look at [image#1]\n\n[image#1]: data:image/png;base64,dGVzdA==')
  })

  it('keeps a newly pasted image from colliding with a restored marker', async () => {
    const adapter = new LocalTaskCreationAdapter()
    const first = await openCreateSession(adapter)
    first.setPrompt(`Look at ${await first.attachments.attachImage(new Blob(['image'], { type: 'image/png' }))}`)
    first.dispose()

    const second = await openCreateSession(adapter)
    const added = await second.attachments.attachImage(new Blob(['image'], { type: 'image/png' }))

    expect(added).toBe('[image#2]')
    expect(second.attachments.state.images.map((image) => image.marker)).toEqual(['[image#1]', '[image#2]'])
  })

  it('leaves properties on project defaults when a draft is restored', async () => {
    const adapter = new LocalTaskCreationAdapter()
    const first = await openCreateSession(adapter)
    first.setPrompt('Fix the flaky test')
    first.state.draft.title = 'Typed title'
    first.state.draft.permissionMode = 'plan'
    first.dispose()

    adapter.defaults = { ...adapter.defaults, aiProvider: 'codex' }
    const second = await openCreateSession(adapter)

    expect(second.state.draft.title).toBe('')
    expect(second.state.draft.permissionMode).toBe('default')
    expect(second.state.draft.aiProvider).toBe('codex')
  })

  it('does not retain the prompt of a seeded create session', async () => {
    const workflow = createTaskCreationWorkflow(new LocalTaskCreationAdapter())
    workflow.configure({ projectId: 'project', promptSeed: 'Seeded work' })
    await workflow.initialize()

    workflow.setPrompt('Seeded work plus my own context')

    expect(readCreateTaskDraft('project')).toBeNull()
  })

  it('presents a supplied seed instead of a retained draft', async () => {
    const adapter = new LocalTaskCreationAdapter()
    const first = await openCreateSession(adapter)
    first.setPrompt('My own draft')
    first.dispose()

    const seeded = createTaskCreationWorkflow(adapter)
    seeded.configure({ projectId: 'project', promptSeed: 'Seeded work' })
    await seeded.initialize()

    expect(seeded.state.promptDraft).toBe('Seeded work')
    expect(readCreateTaskDraft('project')?.prompt).toBe('My own draft')
  })

  it('does not retain the prompt of an edit session', async () => {
    const adapter = new LocalTaskCreationAdapter()
    const task = await adapter.createTask('Existing prompt', 'backlog', 'project', 'default')
    const workflow = createTaskCreationWorkflow(adapter)
    workflow.configure({ projectId: 'project', mode: 'edit', task })
    await workflow.initialize()

    workflow.setPrompt('Edited prompt')

    expect(readCreateTaskDraft('project')).toBeNull()
  })

  it('keeps retained drafts independent per project', async () => {
    const adapter = new LocalTaskCreationAdapter()
    const first = await openCreateSession(adapter, 'project')
    first.setPrompt('First project work')
    first.dispose()

    const other = await openCreateSession(adapter, 'other-project')
    expect(other.state.promptDraft).toBe('')
    other.setPrompt('Other project work')
    other.dispose()

    const back = await openCreateSession(adapter, 'project')
    expect(back.state.promptDraft).toBe('First project work')
  })

  it('clears the retained draft after a successful create', async () => {
    const adapter = new LocalTaskCreationAdapter()
    const workflow = await openCreateSession(adapter)
    workflow.setPrompt('Fix the flaky test')

    await workflow.submit('backlog')

    expect(readCreateTaskDraft('project')).toBeNull()
  })

  it('retains the draft when creation fails', async () => {
    const adapter = new LocalTaskCreationAdapter()
    adapter.createTask = async () => { throw new Error('backend down') }
    const workflow = await openCreateSession(adapter)
    workflow.setPrompt('Fix the flaky test')

    await workflow.submit('backlog')

    expect(workflow.state.error).toContain('backend down')
    expect(readCreateTaskDraft('project')?.prompt).toBe('Fix the flaky test')
  })

  it('discards the prompt, its images, and the retained draft without closing', async () => {
    const adapter = new LocalTaskCreationAdapter()
    const workflow = await openCreateSession(adapter)
    workflow.setPrompt(`Look at ${await workflow.attachments.attachImage(new Blob(['image'], { type: 'image/png' }))}`)
    const revisionBeforeDiscard = workflow.state.promptRevision

    workflow.discardDraft()

    expect(workflow.state.promptDraft).toBe('')
    expect(workflow.state.initialPrompt).toBe('')
    expect(workflow.attachments.state.images).toEqual([])
    expect(workflow.state.promptRevision).toBeGreaterThan(revisionBeforeDiscard)
    expect(readCreateTaskDraft('project')).toBeNull()
  })

  it('clears the retained draft when the prompt is emptied by hand', async () => {
    const adapter = new LocalTaskCreationAdapter()
    const workflow = await openCreateSession(adapter)
    workflow.setPrompt('Fix the flaky test')

    workflow.setPrompt('   ')

    expect(readCreateTaskDraft('project')).toBeNull()
  })

  it('retargets retention when the project changes mid-session', async () => {
    const adapter = new LocalTaskCreationAdapter()
    const workflow = createTaskCreationWorkflow(adapter)
    workflow.configure({ projectId: 'project' })
    await workflow.initialize()

    workflow.configure({ projectId: 'other-project' })
    workflow.setPrompt('Work for the other project')

    expect(readCreateTaskDraft('other-project')?.prompt).toBe('Work for the other project')
    expect(readCreateTaskDraft('project')).toBeNull()
  })

  it('does not carry a typed prompt into another project', async () => {
    const adapter = new LocalTaskCreationAdapter()
    const workflow = createTaskCreationWorkflow(adapter)
    workflow.configure({ projectId: 'project' })
    await workflow.initialize()
    workflow.setPrompt('Work for the first project')

    workflow.configure({ projectId: 'other-project' })

    expect(workflow.state.promptDraft).toBe('')
    expect(readCreateTaskDraft('project')?.prompt).toBe('Work for the first project')
  })

  it('stops retaining when the session turns into an edit', async () => {
    const adapter = new LocalTaskCreationAdapter()
    const task = await adapter.createTask('Existing prompt', 'backlog', 'project', 'default')
    const workflow = createTaskCreationWorkflow(adapter)
    workflow.configure({ projectId: 'project' })
    await workflow.initialize()

    workflow.configure({ projectId: 'project', mode: 'edit', task })
    expect(workflow.state.promptDraft).toBe('Existing prompt')
    workflow.setPrompt('Edited prompt')

    expect(readCreateTaskDraft('project')).toBeNull()
  })

  it('stops retaining when a seed arrives after the session started', async () => {
    const adapter = new LocalTaskCreationAdapter()
    const workflow = createTaskCreationWorkflow(adapter)
    workflow.configure({ projectId: 'project' })
    await workflow.initialize()
    workflow.setPrompt('My own precious draft')

    workflow.configure({ projectId: 'project', promptSeed: 'Seeded work' })
    expect(workflow.state.promptDraft).toBe('Seeded work')
    workflow.setPrompt('Seeded work and more')

    expect(readCreateTaskDraft('project')?.prompt).toBe('My own precious draft')
  })

  it('drops an image from the retained draft when its marker is deleted', async () => {
    const adapter = new LocalTaskCreationAdapter()
    const first = await openCreateSession(adapter)
    const marker = await first.attachments.attachImage(new Blob(['image'], { type: 'image/png' }))
    first.setPrompt(`Look at ${marker}`)

    first.setPrompt('Look at ')

    expect(readCreateTaskDraft('project')?.images).toEqual([])
    expect(first.attachments.state.images).toEqual([])

    first.dispose()
    const second = await openCreateSession(adapter)
    expect(second.attachments.state.images).toEqual([])
    await second.submit('backlog')
    expect(adapter.created[0].prompt).toBe('Look at')
  })
})
