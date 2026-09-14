import { fireEvent, render, screen, within } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import type { PrFileDiff } from '@openforge-app/plugin-sdk/domain'
import type { ReviewThread } from '@openforge-app/plugin-sdk'
import DiffViewer from './DiffViewer.svelte'

vi.mock('@git-diff-view/svelte', async () => {
  const { default: ExtendLineDiffViewMock } = await import('./ExtendLineDiffViewMock.svelte')
  return {
    DiffView: ExtendLineDiffViewMock,
    DiffModeEnum: { Split: 0, Unified: 1 },
    SplitSide: { old: 1, new: 2 },
  }
})

vi.mock('./useVirtualizer.svelte', () => ({
  createVirtualizer: vi.fn((opts: { getCount: () => number }) => ({
    get virtualItems() {
      return Array.from({ length: opts.getCount() }, (_, index) => ({
        key: index,
        index,
        start: index * 300,
        end: (index + 1) * 300,
        size: 300,
        lane: 0,
      }))
    },
    totalSize: 300,
    scrollToIndex: vi.fn(),
    measureAction: () => ({ destroy() {} }),
  })),
}))

vi.mock('./useDiffWorker.svelte', () => ({
  createDiffWorker: vi.fn(() => ({
    getDiffFile: () => ({ clearId: vi.fn() }),
    processing: false,
  })),
}))

const files: PrFileDiff[] = [
  {
    sha: 'abc123',
    filename: 'src/main.ts',
    status: 'modified',
    additions: 2,
    deletions: 1,
    changes: 3,
    patch: ['@@ -10,3 +10,3 @@', ' const a = 1', '-const b = 2', '+const b = 3', ' const c = 4'].join('\n'),
    previous_filename: null,
    is_truncated: false,
    patch_line_count: null,
  },
]

function makeThread(overrides: Partial<ReviewThread> = {}): ReviewThread {
  return {
    id: 'rt_1',
    namespace: 'github',
    targetKey: 'gh:acme/web#1421',
    revision: 'sha-1',
    anchor: { kind: 'line', filePath: 'src/main.ts', line: 12, side: 'RIGHT' },
    origin: 'plugin',
    status: 'open',
    awaiting: 'none',
    runId: null,
    idempotencyKey: null,
    seenAt: null,
    createdAt: 1,
    updatedAt: 1,
    messages: [{ id: 'rtm_1', role: 'agent', body: 'Needs a null check', createdAt: 1 }],
    ...overrides,
  }
}

describe('DiffViewer Review Threads', () => {
  it('renders a supplied thread inline on its anchored line', async () => {
    render(DiffViewer, { props: { files, threads: [makeThread()] } })

    const message = await screen.findByText('Needs a null check')
    const line = message.closest('[data-testid="extend-line"]')
    expect(line?.getAttribute('data-line')).toBe('12')
    expect(line?.getAttribute('data-side')).toBe('2')
  })

  it('anchors a LEFT-side thread to the old side of the diff', async () => {
    const thread = makeThread({ anchor: { kind: 'line', filePath: 'src/main.ts', line: 11, side: 'LEFT' } })

    render(DiffViewer, { props: { files, threads: [thread] } })

    const message = await screen.findByText('Needs a null check')
    const line = message.closest('[data-testid="extend-line"]')
    expect(line?.getAttribute('data-line')).toBe('11')
    expect(line?.getAttribute('data-side')).toBe('1')
  })

  it('renders no thread when the embedding surface supplies none', async () => {
    render(DiffViewer, { props: { files } })

    await screen.findByTestId('mock-diff-view')
    expect(screen.queryByText('Needs a null check')).toBeNull()
  })

  it('reports a reply with the thread identifier to the embedding surface', async () => {
    const onReplyToThread = vi.fn()

    render(DiffViewer, { props: { files, threads: [makeThread()], onReplyToThread } })

    const editor = await screen.findByRole('textbox', { name: 'Reply to the review thread' })
    await fireEvent.input(editor, { target: { value: 'Fixed in the next commit' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Reply' }))

    expect(onReplyToThread).toHaveBeenCalledWith('rt_1', 'Fixed in the next commit')
  })

  it('reports a thread whose file the diff does not contain rather than hiding it', async () => {
    const thread = makeThread({ anchor: { kind: 'line', filePath: 'src/gone.ts', line: 12, side: 'RIGHT' } })

    render(DiffViewer, { props: { files, threads: [thread] } })

    const orphans = await screen.findByRole('region', { name: 'Threads not in this diff' })
    expect(within(orphans).getByText('Needs a null check')).toBeTruthy()
    expect(within(orphans).getByText('src/gone.ts:12')).toBeTruthy()
    expect(within(orphans).getByText('File is not in this diff')).toBeTruthy()
  })

  it('reports a thread whose line the diff does not show rather than hiding it', async () => {
    const thread = makeThread({ anchor: { kind: 'line', filePath: 'src/main.ts', line: 900, side: 'RIGHT' } })

    render(DiffViewer, { props: { files, threads: [thread] } })

    const orphans = await screen.findByRole('region', { name: 'Threads not in this diff' })
    expect(within(orphans).getByText('Needs a null check')).toBeTruthy()
    expect(within(orphans).getByText('src/main.ts:900')).toBeTruthy()
    expect(within(orphans).getByText('Line is not in this diff')).toBeTruthy()
  })

  it('reports a reply on an orphaned thread with the thread identifier', async () => {
    const onReplyToThread = vi.fn()
    const thread = makeThread({ anchor: { kind: 'line', filePath: 'src/gone.ts', line: 12, side: 'RIGHT' } })

    render(DiffViewer, { props: { files, threads: [thread], onReplyToThread } })

    const orphans = await screen.findByRole('region', { name: 'Threads not in this diff' })
    const editor = within(orphans).getByRole('textbox', { name: 'Reply to the review thread' })
    await fireEvent.input(editor, { target: { value: 'Still relevant' } })
    await fireEvent.click(within(orphans).getByRole('button', { name: 'Reply' }))

    expect(onReplyToThread).toHaveBeenCalledWith('rt_1', 'Still relevant')
  })

  it('reports no orphans when every thread anchors to a shown line', async () => {
    render(DiffViewer, { props: { files, threads: [makeThread()] } })

    await screen.findByText('Needs a null check')
    expect(screen.queryByRole('region', { name: 'Threads not in this diff' })).toBeNull()
  })

  it('leaves a custom-anchored thread to the surface that owns its anchor', async () => {
    const thread = makeThread({ anchor: { kind: 'custom', key: 'step-3' } })

    render(DiffViewer, { props: { files, threads: [thread] } })

    await screen.findByTestId('mock-diff-view')
    expect(screen.queryByRole('region', { name: 'Threads not in this diff' })).toBeNull()
    expect(screen.queryByText('Needs a null check')).toBeNull()
  })
})
