import type { PrFileDiff } from '@openforge-app/plugin-sdk/domain'
import { tick } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createDiffViewerNavigation,
  type DiffViewerNavigation,
} from './useDiffViewerNavigation.svelte'

function makeFile(filename: string): PrFileDiff {
  return {
    sha: `sha-${filename}`,
    filename,
    status: 'modified',
    additions: 1,
    deletions: 0,
    changes: 1,
    patch: '@@ -1 +1 @@',
    previous_filename: null,
    is_truncated: false,
    patch_line_count: null,
  }
}

function createNavigation(overrides: {
  files?: PrFileDiff[]
  collapsedFiles?: Set<string>
  scrollContainer?: HTMLElement | null
  initialScrollTop?: number
  isFileReviewed?: (file: PrFileDiff) => boolean
  onUncollapseFile?: (filename: string) => void
  scrollToIndex?: (index: number, opts?: { align?: 'start'; behavior?: 'smooth' }) => void
  onRequestFocusFileTree?: () => void
} = {}) {
  let navigation!: DiffViewerNavigation
  const files = overrides.files ?? [makeFile('src/main.ts')]
  const collapsedFiles = overrides.collapsedFiles ?? new Set<string>()
  const cleanup = $effect.root(() => {
    navigation = createDiffViewerNavigation({
      getFiles: () => files,
      getCollapsedFiles: () => collapsedFiles,
      getScrollContainer: () => overrides.scrollContainer ?? null,
      getInitialScrollTop: () => overrides.initialScrollTop ?? 0,
      isFileReviewed: overrides.isFileReviewed ?? (() => false),
      onUncollapseFile: overrides.onUncollapseFile ?? (() => {}),
      scrollToIndex: overrides.scrollToIndex ?? (() => {}),
      getOnRequestFocusFileTree: () => overrides.onRequestFocusFileTree,
    })
  })
  return { navigation, cleanup }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('createDiffViewerNavigation', () => {
  it('retries initial scroll restoration until virtualized content can reach the saved position', async () => {
    vi.useFakeTimers()
    const container = document.createElement('div')
    let scrollHeight = 0
    let scrollTop = 0
    Object.defineProperties(container, {
      clientHeight: { configurable: true, get: () => 500 },
      scrollHeight: { configurable: true, get: () => scrollHeight },
      scrollTop: {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
          scrollTop = Math.min(value, Math.max(0, scrollHeight - 500))
        },
      },
    })

    const { cleanup } = createNavigation({ scrollContainer: container, initialScrollTop: 950 })
    await tick()

    expect(container.scrollTop).toBe(0)
    await vi.advanceTimersByTimeAsync(25)
    expect(container.scrollTop).toBe(0)

    scrollHeight = 3_000
    await vi.advanceTimersByTimeAsync(25)

    expect(container.scrollTop).toBe(950)
    cleanup()
  })

  it('navigates to a virtualized file and expands it unless it is reviewed', () => {
    const files = [makeFile('src/a.ts'), makeFile('src/b.ts')]
    const onUncollapseFile = vi.fn()
    const scrollToIndex = vi.fn()
    const { navigation, cleanup } = createNavigation({
      files,
      collapsedFiles: new Set(['src/b.ts']),
      onUncollapseFile,
      scrollToIndex,
    })

    navigation.scrollToFile('src/b.ts')

    expect(onUncollapseFile).toHaveBeenCalledWith('src/b.ts')
    expect(scrollToIndex).toHaveBeenCalledWith(1, { align: 'start', behavior: 'smooth' })
    cleanup()
  })

  it('applies a resolvable fragment after the target file mounts', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    const container = document.createElement('div')
    const fileElement = document.createElement('div')
    fileElement.dataset.diffFile = 'docs/README.md'
    const heading = document.createElement('h2')
    heading.id = 'installation'
    heading.scrollIntoView = vi.fn()
    container.append(fileElement)
    const scrollToIndex = vi.fn()
    const { navigation, cleanup } = createNavigation({
      files: [makeFile('docs/README.md')],
      scrollContainer: container,
      scrollToIndex,
    })

    const navigationPromise = navigation.scrollToFragment('docs/README.md', 'installation')
    await vi.advanceTimersByTimeAsync(0)
    expect(heading.scrollIntoView).not.toHaveBeenCalled()

    fileElement.append(heading)
    await vi.advanceTimersByTimeAsync(25)
    await navigationPromise

    expect(scrollToIndex).toHaveBeenCalledWith(0, { align: 'start', behavior: 'smooth' })
    expect(heading.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
    cleanup()
  })

  it('maps standard line fragments to rendered diff rows', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    const container = document.createElement('div')
    const fileElement = document.createElement('div')
    fileElement.dataset.diffFile = 'src/main.ts'
    const line = document.createElement('tr')
    line.dataset.line = '10'
    line.scrollIntoView = vi.fn()
    fileElement.append(line)
    container.append(fileElement)
    const { navigation, cleanup } = createNavigation({ scrollContainer: container })

    await navigation.scrollToFragment('src/main.ts', 'L10')

    expect(line.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
    cleanup()
  })

  it('cancels a pending fragment when navigation moves to another file', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    const container = document.createElement('div')
    const targetFile = document.createElement('div')
    targetFile.dataset.diffFile = 'docs/README.md'
    container.append(targetFile)
    const scrollToIndex = vi.fn()
    const { navigation, cleanup } = createNavigation({
      files: [makeFile('docs/README.md'), makeFile('src/other.ts')],
      scrollContainer: container,
      scrollToIndex,
    })

    const fragmentPromise = navigation.scrollToFragment('docs/README.md', 'later-heading')
    await vi.advanceTimersByTimeAsync(0)
    navigation.scrollToFile('src/other.ts')
    await vi.advanceTimersByTimeAsync(25)
    await fragmentPromise

    expect(scrollToIndex).toHaveBeenLastCalledWith(1, { align: 'start', behavior: 'smooth' })
    cleanup()
  })

  it('keeps reviewed files collapsed when navigating from the file tree', () => {
    const file = makeFile('src/reviewed.ts')
    const onUncollapseFile = vi.fn()
    const scrollToIndex = vi.fn()
    const { navigation, cleanup } = createNavigation({
      files: [file],
      collapsedFiles: new Set([file.filename]),
      isFileReviewed: () => true,
      onUncollapseFile,
      scrollToIndex,
    })

    navigation.scrollToFile(file.filename)

    expect(onUncollapseFile).not.toHaveBeenCalled()
    expect(scrollToIndex).toHaveBeenCalledWith(0, { align: 'start', behavior: 'smooth' })
    cleanup()
  })

  it('reveals and highlights a comment after virtualized file rendering', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    const container = document.createElement('div')
    const fileElement = document.createElement('div')
    fileElement.dataset.diffFile = 'src/main.ts'
    const contentLine = document.createElement('tr')
    contentLine.dataset.line = '12'
    const annotationLine = document.createElement('tr')
    annotationLine.dataset.line = '12-extend'
    const scrollIntoView = vi.fn()
    annotationLine.scrollIntoView = scrollIntoView
    fileElement.append(contentLine, annotationLine)
    container.append(fileElement)
    const onUncollapseFile = vi.fn()
    const scrollToIndex = vi.fn()
    const { navigation, cleanup } = createNavigation({
      collapsedFiles: new Set(['src/main.ts']),
      scrollContainer: container,
      onUncollapseFile,
      scrollToIndex,
    })

    const navigationPromise = navigation.scrollToComment('src/main.ts', 12)
    await navigationPromise

    expect(onUncollapseFile).toHaveBeenCalledWith('src/main.ts')
    expect(scrollToIndex).toHaveBeenCalledWith(0, { align: 'start' })
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' })
    expect(annotationLine.classList.contains('diff-comment-highlight')).toBe(true)

    await vi.advanceTimersByTimeAsync(2_000)
    expect(annotationLine.classList.contains('diff-comment-highlight')).toBe(false)
    cleanup()
  })

  it('retries until a late-rendering comment row appears after a tab switch', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    const container = document.createElement('div')
    const fileElement = document.createElement('div')
    fileElement.dataset.diffFile = 'src/main.ts'
    container.append(fileElement)
    const scrollToIndex = vi.fn()
    const { navigation, cleanup } = createNavigation({
      files: [makeFile('src/main.ts')],
      scrollContainer: container,
      scrollToIndex,
    })

    const navigationPromise = navigation.scrollToComment('src/main.ts', 12)
    // Diff just mounted: the row for line 12 has not rendered yet.
    await vi.advanceTimersByTimeAsync(0)

    const annotationLine = document.createElement('tr')
    annotationLine.dataset.line = '12-extend'
    const scrollIntoView = vi.fn()
    annotationLine.scrollIntoView = scrollIntoView
    fileElement.append(annotationLine)

    await vi.advanceTimersByTimeAsync(25)
    await navigationPromise

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' })
    cleanup()
  })

  it('focuses the scroll area and hands Shift+Tab back to the file tree', () => {
    const container = document.createElement('div')
    const focus = vi.spyOn(container, 'focus')
    const onRequestFocusFileTree = vi.fn()
    const { navigation, cleanup } = createNavigation({
      scrollContainer: container,
      onRequestFocusFileTree,
    })
    const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, cancelable: true })

    navigation.focusDiff()
    navigation.handleScrollAreaKeydown(event)

    expect(focus).toHaveBeenCalledOnce()
    expect(event.defaultPrevented).toBe(true)
    expect(onRequestFocusFileTree).toHaveBeenCalledOnce()
    cleanup()
  })
})
