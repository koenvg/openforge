import { describe, expect, it } from 'vitest'
import { createTaskCreationWorkflow } from './taskCreationWorkflow.svelte'
import { LocalTaskCreationAdapter } from './testing/localTaskCreationAdapter'

describe('task creation workflow', () => {
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

  it('reports a saved task before closing and starting, and blocks concurrent submissions', async () => {
    const adapter = new LocalTaskCreationAdapter()
    const events: string[] = []
    let finish!: () => void
    let reachedStart!: () => void
    const started = new Promise<void>((resolve) => { reachedStart = resolve })
    const workflow = createTaskCreationWorkflow(adapter)
    workflow.configure({ projectId: 'project', promptSeed: 'Build',
      onTaskSaved: async (task, options) => { events.push(`saved:${task?.id}:${options?.started}`) },
      onClose: () => { events.push('close') },
      onRunAction: async (id) => { events.push(`start:${id}`); reachedStart(); await new Promise<void>((resolve) => { finish = resolve }) },
    })
    await workflow.initialize()
    const submitting = workflow.submit('start')
    await started
    expect(events).toEqual(['saved:T-1:true', 'close', 'start:T-1'])
    expect(workflow.state.submissionIntent).toBe('start')
    await workflow.submit()
    expect(adapter.created).toHaveLength(1)
    finish()
    await submitting
    expect(workflow.state.isSaving).toBe(false)
    expect(workflow.state.submissionIntent).toBeNull()
  })

  it('reports not started when no start callback exists', async () => {
    const saved: boolean[] = []
    const workflow = createTaskCreationWorkflow(new LocalTaskCreationAdapter())
    workflow.configure({ projectId: 'project', promptSeed: 'Build', onTaskSaved: (_task, options) => { saved.push(options!.started) } })
    await workflow.initialize()
    await workflow.submit('start')
    expect(saved).toEqual([false])
  })

  it('keeps a persistence failure visible and releases the submission lock', async () => {
    const adapter = new LocalTaskCreationAdapter()
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
