import { get } from 'svelte/store'
import { describe, expect, it, vi } from 'vitest'
import type { AttentionOverview, AttentionFocusTask } from './attentionOverview'
import type { ReviewPullRequest } from './types'
import { createAttentionOverviewInteraction, type AttentionOverviewSource } from './attentionOverviewInteraction'

function task(id: string, projectId = 'p1'): AttentionFocusTask {
  return { task: { id, projectId }, title: id, state: 'idle', reason: 'Ready', activityAt: 0, hasUnreadAgentOutput: false }
}

function overview(ids = ['t1', 't2']): AttentionOverview {
  return {
    groups: ['p1', 'p2'].map((id) => ({
      project: { id, name: id, path: `/${id}`, created_at: 0, updated_at: 0 },
      tasksByLane: { focus: id === 'p1' ? ids.map((id) => task(id)) : [task('t3', id)], 'in-flight': [], 'out-of-focus': [], backlog: [] },
      reviewPrs: [],
    })),
    otherReviewPrs: [], totalTasksByLane: { focus: ids.length + 1, 'in-flight': 0, 'out-of-focus': 0, backlog: 0 },
    totalReviewPrs: 0, totalRunningAgents: 0,
  }
}

function setup() {
  const source: AttentionOverviewSource = {
    load: vi.fn().mockResolvedValue({ overview: overview(), activeId: 'p2' }),
    readConfig: vi.fn().mockResolvedValue(null),
    writeConfig: vi.fn().mockResolvedValue(undefined),
    subscribeChanges: vi.fn().mockReturnValue(vi.fn()),
  }
  const onIntent = vi.fn()
  return { source, onIntent, interaction: createAttentionOverviewInteraction(source, onIntent) }
}

describe('attention overview interaction', () => {
  it('loads the overview and starts on the active project’s first item', async () => {
    const { interaction } = setup()
    expect(get(interaction).loading).toBe(true)
    await interaction.start()
    const view = get(interaction)
    expect(view.loading).toBe(false)
    expect(view.error).toBeNull()
    expect(view.taskCount).toBe(3)
    expect(view.rows[view.focusedIndex]).toMatchObject({ kind: 'task', item: { task: { id: 't3' } } })
    interaction.dispose()
  })

  it('keeps the focused task when a refresh inserts earlier rows', async () => {
    const { interaction, source } = setup()
    await interaction.start()
    interaction.dispatch({ kind: 'focus', index: 2 })
    vi.mocked(source.load).mockResolvedValueOnce({ overview: overview(['new', 't1', 't2']), activeId: 'p2' })
    await interaction.refresh()
    const view = get(interaction)
    expect(view.rows[view.focusedIndex]).toMatchObject({ kind: 'task', item: { task: { id: 't2' } } })
    interaction.dispose()
  })

  it('cycles exclusive lanes, skips expanded headers, and round-trips collapsed groups', async () => {
    const { interaction } = setup()
    await interaction.start()
    const key = (key: string) => interaction.handleKey({ key, metaKey: false, ctrlKey: false, altKey: false })
    key('k')
    expect(get(interaction).focusedIndex).toBe(2)
    key('h')
    expect(get(interaction).rows[0].kind).toBe('header')
    expect(get(interaction).collapsedIds.has('p1')).toBe(true)
    expect(get(interaction).focusedIndex).toBe(0)
    key('j')
    expect(get(interaction).rows[get(interaction).focusedIndex]).toMatchObject({ kind: 'task', item: { task: { id: 't3' } } })
    key('k')
    key('l')
    expect(get(interaction).focusedIndex).toBe(1)
    expect(get(interaction).collapsedIds.has('p1')).toBe(false)
    for (const lane of ['in-flight', 'out-of-focus', 'backlog', 'focus']) {
      expect(key('T')).toBe(true)
      expect(get(interaction).taskLane).toBe(lane)
    }
    expect(get(interaction).focusedIndex).toBe(1)
    expect(interaction.handleKey({ key: 'r', metaKey: true, ctrlKey: false, altKey: false })).toBe(false)
    expect(key('Escape')).toBe(false)
    expect(key('Enter')).toBe(false)
    interaction.dispose()
  })

  it('restores saved preferences but always reopens on Focus', async () => {
    const { source, interaction, onIntent } = setup()
    const config = new Map<string, string>()
    vi.mocked(source.readConfig).mockImplementation(async (key) => config.get(key) ?? null)
    vi.mocked(source.writeConfig).mockImplementation(async (key, value) => { config.set(key, value) })
    await interaction.start()
    interaction.dispatch({ kind: 'toggle-group', id: 'p2' })
    interaction.dispatch({ kind: 'toggle-reviews' })
    interaction.dispatch({ kind: 'cycle-lane' })
    await vi.waitFor(() => expect(config.size).toBe(2))
    interaction.dispose()
    const reopened = createAttentionOverviewInteraction(source, onIntent)
    await reopened.start()
    expect(get(reopened)).toMatchObject({ taskLane: 'focus', showReviews: false, focusedIndex: 3 })
    expect(get(reopened).collapsedIds.has('p2')).toBe(true)
    reopened.dispose()
  })

  it.each(['not json', 'null', '42', '{"showReviews":"false"}', '[1,"p2"]'])(
    'ignores malformed preferences: %s', async (raw) => {
      const { source, interaction } = setup()
      vi.mocked(source.readConfig).mockResolvedValue(raw)
      await interaction.start()
      expect(get(interaction).showReviews).toBe(true)
      expect(get(interaction).collapsedIds.size).toBe(0)
      interaction.dispose()
    },
  )

  it('reports read failures without throwing and recovers on a later refresh', async () => {
    const { source, interaction } = setup()
    vi.mocked(source.load).mockRejectedValueOnce(new Error('offline'))
    await interaction.start()
    expect(get(interaction)).toMatchObject({ loading: false, error: 'Error: offline', rows: [] })
    await interaction.refresh()
    expect(get(interaction)).toMatchObject({ error: null, taskCount: 3 })
    vi.mocked(source.load).mockRejectedValueOnce(new Error('refresh failed'))
    await interaction.refresh()
    expect(get(interaction)).toMatchObject({ loading: false, error: 'Error: refresh failed', taskCount: 3 })
    interaction.dispose()
  })

  it('settles config failures and keeps preference write failures local', async () => {
    const { source, interaction } = setup()
    vi.mocked(source.readConfig).mockRejectedValueOnce(new Error('config unavailable'))
    await interaction.start()
    expect(get(interaction)).toMatchObject({ loading: false, error: 'Error: config unavailable' })
    await interaction.refresh()
    vi.mocked(source.writeConfig).mockRejectedValueOnce(new Error('disk full'))
    interaction.dispatch({ kind: 'toggle-reviews' })
    await vi.waitFor(() => expect(get(interaction).preferenceError).toBe('Error: disk full'))
    expect(get(interaction).showReviews).toBe(false)
    interaction.dispatch({ kind: 'toggle-reviews' })
    await vi.waitFor(() => expect(get(interaction).preferenceError).toBeNull())
    expect(get(interaction).showReviews).toBe(true)
    interaction.dispose()
  })

  it('ignores stale refresh completions and clamps a removed selection to a navigable row', async () => {
    const { source, interaction } = setup()
    await interaction.start()
    interaction.dispatch({ kind: 'focus', index: 2 })
    let resolve!: (value: Awaited<ReturnType<AttentionOverviewSource['load']>>) => void
    vi.mocked(source.load).mockReturnValueOnce(new Promise((done) => { resolve = done }))
    const stale = interaction.refresh()
    vi.mocked(source.load).mockResolvedValueOnce({ overview: overview([]), activeId: 'p1' })
    await interaction.refresh()
    expect(get(interaction).rows[get(interaction).focusedIndex]).toMatchObject({ kind: 'task', item: { task: { id: 't3' } } })
    resolve({ overview: overview(['old']), activeId: 'p1' })
    await stale
    expect(get(interaction).taskCount).toBe(1)
    interaction.dispose()
  })

  it('subscribes once, catches changes during opening, and invalidates reads on disposal', async () => {
    const { source, interaction } = setup()
    let notify!: () => void
    const unsubscribe = vi.fn()
    vi.mocked(source.subscribeChanges).mockImplementation((callback) => { notify = callback; return unsubscribe })
    let resolve!: (value: Awaited<ReturnType<AttentionOverviewSource['load']>>) => void
    vi.mocked(source.load).mockReturnValueOnce(new Promise((done) => { resolve = done }))
    const opening = interaction.start()
    expect(interaction.start()).toBe(opening)
    notify()
    resolve({ overview: overview(), activeId: 'p1' })
    await opening
    expect(source.load).toHaveBeenCalledTimes(2)
    expect(source.subscribeChanges).toHaveBeenCalledTimes(1)
    vi.mocked(source.load).mockReturnValueOnce(new Promise((done) => { resolve = done }))
    const pending = interaction.refresh()
    const lastView = get(interaction)
    interaction.dispose()
    interaction.dispose()
    resolve({ overview: overview([]), activeId: null })
    await pending
    notify()
    interaction.dispatch({ kind: 'cycle-lane' })
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(get(interaction)).toBe(lastView)
    expect(source.load).toHaveBeenCalledTimes(3)
  })

  it('does not publish or activate after disposal during opening', async () => {
    const { source, interaction, onIntent } = setup()
    let resolve!: (value: Awaited<ReturnType<AttentionOverviewSource['load']>>) => void
    vi.mocked(source.load).mockReturnValueOnce(new Promise((done) => { resolve = done }))
    const opening = interaction.start()
    const initialView = get(interaction)
    interaction.dispose()
    resolve({ overview: overview(), activeId: null })
    await opening
    interaction.dispatch({ kind: 'activate', index: 1 })
    expect(get(interaction)).toBe(initialView)
    expect(onIntent).not.toHaveBeenCalled()
  })

  it('emits task intent through the same activation used by pointer and keyboard', async () => {
    const { interaction, onIntent } = setup()
    await interaction.start()
    interaction.dispatch({ kind: 'activate', index: 1 })
    expect(onIntent).toHaveBeenCalledExactlyOnceWith({ kind: 'task', task: { id: 't1', projectId: 'p1' } })
    interaction.dispatch({ kind: 'activate', index: 0 })
    expect(onIntent).toHaveBeenCalledTimes(1)
    expect(get(interaction).collapsedIds.has('p1')).toBe(true)
    interaction.dispose()
  })

  it('keeps review counts independent of filters and emits local or unowned review intent', async () => {
    const { source, interaction, onIntent } = setup()
    const pr: ReviewPullRequest = {
      id: 1, number: 1, title: 'Review', body: null, state: 'open', draft: false,
      html_url: 'https://github.com/owner/repo/pull/1', user_login: 'author', user_avatar_url: null,
      repo_owner: 'owner', repo_name: 'repo', head_ref: 'feature', base_ref: 'main', head_sha: 'abc',
      additions: 1, deletions: 0, changed_files: 1, mergeable: null, mergeable_state: null,
      created_at: 0, updated_at: 0, viewed_at: null, viewed_head_sha: null, labels: [],
    }
    const otherPr = { ...pr, id: 2, number: 2, repo_name: 'other' }
    const data = overview([])
    data.groups[0].reviewPrs = [pr]
    data.groups[1].tasksByLane.focus = []
    data.totalTasksByLane.focus = 0
    data.otherReviewPrs = [otherPr]
    data.totalReviewPrs = 2
    data.totalRunningAgents = 5
    vi.mocked(source.load).mockResolvedValue({ overview: data, activeId: null })
    await interaction.start()
    expect(get(interaction)).toMatchObject({ focusedIndex: 1, reviewCount: 2, runningAgents: 5 })
    interaction.dispatch({ kind: 'activate', index: 1 })
    expect(onIntent).toHaveBeenLastCalledWith({ kind: 'review', pr, projectId: 'p1' })
    interaction.handleKey({ key: 'j', metaKey: false, ctrlKey: false, altKey: false })
    expect(get(interaction).focusedIndex).toBe(3)
    interaction.dispatch({ kind: 'activate', index: 3 })
    expect(onIntent).toHaveBeenLastCalledWith({ kind: 'review', pr: otherPr, projectId: null })
    interaction.dispatch({ kind: 'cycle-lane' })
    expect(get(interaction)).toMatchObject({ reviewCount: 2, runningAgents: 5, taskLane: 'in-flight' })
    interaction.dispatch({ kind: 'toggle-reviews' })
    expect(get(interaction)).toMatchObject({ reviewsHidden: true, reviewCount: 2, navGroups: [], rows: [], focusedIndex: 0 })
    interaction.dispatch({ kind: 'toggle-reviews' })
    expect(get(interaction)).toMatchObject({ reviewsHidden: false, focusedIndex: 1 })
    interaction.dispose()
  })

  it('clamps keyboard and focus requests at list ends and falls back when the active project is absent', async () => {
    const { source, interaction } = setup()
    vi.mocked(source.load).mockResolvedValue({ overview: overview(), activeId: 'missing' })
    await interaction.start()
    expect(get(interaction).focusedIndex).toBe(1)
    interaction.handleKey({ key: 'ArrowUp', metaKey: false, ctrlKey: false, altKey: false })
    expect(get(interaction).focusedIndex).toBe(1)
    interaction.dispatch({ kind: 'focus', index: 999 })
    expect(get(interaction).focusedIndex).toBe(4)
    interaction.handleKey({ key: 'ArrowDown', metaKey: false, ctrlKey: false, altKey: false })
    expect(get(interaction).focusedIndex).toBe(4)
    interaction.dispatch({ kind: 'focus', index: 3 })
    expect(get(interaction).focusedIndex).toBe(2)
    interaction.dispatch({ kind: 'focus', index: -1 })
    expect(get(interaction).focusedIndex).toBe(1)
    const before = get(interaction)
    interaction.dispatch({ kind: 'toggle-group', id: 'missing' })
    expect(get(interaction)).toBe(before)
    interaction.dispatch({ kind: 'cycle-lane' })
    expect(get(interaction)).toMatchObject({ rows: [], focusedIndex: 0 })
    interaction.handleKey({ key: 'ArrowDown', metaKey: false, ctrlKey: false, altKey: false })
    expect(get(interaction).focusedIndex).toBe(0)
    await interaction.refresh()
    expect(get(interaction).focusedIndex).toBe(0)
    interaction.dispose()
  })
})
