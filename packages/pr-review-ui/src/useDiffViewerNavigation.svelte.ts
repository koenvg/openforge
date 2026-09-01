import type { PrFileDiff } from '@openforge-app/plugin-sdk/domain'
import { tick } from 'svelte'

const MAX_SCROLL_RESTORE_ATTEMPTS = 40
const SCROLL_RESTORE_RETRY_MS = 25
const COMMENT_HIGHLIGHT_MS = 2_000

interface DiffViewerNavigationDependencies {
  getFiles: () => PrFileDiff[]
  getCollapsedFiles: () => Set<string>
  getScrollContainer: () => HTMLElement | null
  getInitialScrollTop: () => number
  isFileReviewed: (file: PrFileDiff) => boolean
  onUncollapseFile: (filename: string) => void
  scrollToIndex: (
    index: number,
    opts?: { align?: 'start'; behavior?: 'smooth' },
  ) => void
  getOnRequestFocusFileTree: () => (() => void) | undefined
}

export interface DiffViewerNavigation {
  focusDiff(): void
  handleScrollAreaKeydown(event: KeyboardEvent): void
  scrollToFile(filename: string): void
  scrollToFragment(filename: string, fragment: string): Promise<void>
  getScrollTop(): number
  setScrollTop(scrollTop: number): void
  scrollToComment(filename: string, lineNumber: number): Promise<void>
}

export function createDiffViewerNavigation(
  deps: DiffViewerNavigationDependencies,
): DiffViewerNavigation {
  let pendingScrollTop: number | null = null
  let scrollRestoreTimer: ReturnType<typeof setTimeout> | null = null
  let scrollRestoreAttempts = 0
  let hasRestoredInitialScroll = false
  const commentHighlightTimers = new Set<ReturnType<typeof setTimeout>>()
  let fragmentNavigationId = 0

  function clearScrollRestoreTimer() {
    if (scrollRestoreTimer === null) return
    clearTimeout(scrollRestoreTimer)
    scrollRestoreTimer = null
  }

  function canReachScrollTop(scrollTop: number) {
    const scrollContainer = deps.getScrollContainer()
    if (!scrollContainer) return false
    return scrollTop <= Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight)
  }

  function applyPendingScrollTop() {
    clearScrollRestoreTimer()
    const scrollContainer = deps.getScrollContainer()
    if (!scrollContainer || pendingScrollTop === null) return

    const targetScrollTop = pendingScrollTop
    scrollContainer.scrollTop = targetScrollTop

    if (
      targetScrollTop <= 0 ||
      scrollContainer.scrollTop === targetScrollTop ||
      canReachScrollTop(targetScrollTop) ||
      scrollRestoreAttempts >= MAX_SCROLL_RESTORE_ATTEMPTS
    ) {
      pendingScrollTop = null
      scrollRestoreAttempts = 0
      return
    }

    scrollRestoreAttempts += 1
    scrollRestoreTimer = setTimeout(applyPendingScrollTop, SCROLL_RESTORE_RETRY_MS)
  }

  function setScrollTop(scrollTop: number) {
    pendingScrollTop = scrollTop
    fragmentNavigationId++
    scrollRestoreAttempts = 0
    applyPendingScrollTop()
  }

  $effect(() => {
    const scrollContainer = deps.getScrollContainer()
    if (!scrollContainer) return

    if (!hasRestoredInitialScroll) {
      hasRestoredInitialScroll = true
      const initialScrollTop = deps.getInitialScrollTop()
      if (initialScrollTop > 0) {
        setScrollTop(initialScrollTop)
      }
    }

    applyPendingScrollTop()
  })

  $effect(() => {
    return () => {
      fragmentNavigationId++
      clearScrollRestoreTimer()
      for (const timer of commentHighlightTimers) {
        clearTimeout(timer)
      }
      commentHighlightTimers.clear()
    }
  })

  function findFile(filename: string) {
    const files = deps.getFiles()
    const index = files.findIndex(file => file.filename === filename)
    return index < 0 ? null : { file: files[index], index }
  }

  function focusDiff() {
    deps.getScrollContainer()?.focus()
  }

  function handleScrollAreaKeydown(event: KeyboardEvent) {
    const onRequestFocusFileTree = deps.getOnRequestFocusFileTree()
    if (event.key !== 'Tab' || !event.shiftKey || !onRequestFocusFileTree) return

    event.preventDefault()
    onRequestFocusFileTree()
  }

  function scrollToFile(filename: string) {
    fragmentNavigationId++
    const target = findFile(filename)
    if (!target) return

    if (!deps.isFileReviewed(target.file) && deps.getCollapsedFiles().has(filename)) {
      deps.onUncollapseFile(filename)
    }
    deps.scrollToIndex(target.index, { align: 'start', behavior: 'smooth' })
  }

  function findFragmentDestination(fileElement: Element, fragment: string): HTMLElement | null {
    const lineMatch = /^L(\d+)(?:-L?\d+)?$/i.exec(fragment)
    if (lineMatch) {
      const lineNumber = lineMatch[1]
      const lineElement =
        fileElement.querySelector(`tr[data-line="${lineNumber}-extend"]`) ??
        fileElement.querySelector(`tr[data-line="${lineNumber}"]`)
      return lineElement instanceof HTMLElement ? lineElement : null
    }

    const destination = fileElement.querySelector(`#${CSS.escape(fragment)}`)
    return destination instanceof HTMLElement ? destination : null
  }

  async function scrollToFragment(filename: string, fragment: string): Promise<void> {
    scrollToFile(filename)
    const navigationId = fragmentNavigationId

    for (let attempt = 0; attempt <= MAX_SCROLL_RESTORE_ATTEMPTS; attempt++) {
      await tick()
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      if (navigationId !== fragmentNavigationId) return

      const scrollContainer = deps.getScrollContainer()
      const fileElement = scrollContainer?.querySelector(
        `[data-diff-file="${CSS.escape(filename)}"]`,
      )
      const destination = fileElement ? findFragmentDestination(fileElement, fragment) : null
      if (destination && typeof destination.scrollIntoView === 'function') {
        destination.scrollIntoView({ behavior: 'smooth', block: 'start' })
        return
      }
      if (attempt === MAX_SCROLL_RESTORE_ATTEMPTS) return

      await new Promise<void>(resolve => setTimeout(resolve, SCROLL_RESTORE_RETRY_MS))
    }
  }

  function getScrollTop() {
    return deps.getScrollContainer()?.scrollTop ?? 0
  }

  async function scrollToComment(filename: string, lineNumber: number) {
    fragmentNavigationId++
    const target = findFile(filename)
    if (!target) return

    if (deps.getCollapsedFiles().has(filename)) {
      deps.onUncollapseFile(filename)
    }
    deps.scrollToIndex(target.index, { align: 'start' })

    await tick()
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    await tick()

    const scrollContainer = deps.getScrollContainer()
    if (!scrollContainer) return

    const fileElement = scrollContainer.querySelector(
      `[data-diff-file="${CSS.escape(filename)}"]`,
    )
    if (!fileElement) return

    const targetElement =
      fileElement.querySelector(`tr[data-line="${lineNumber}-extend"]`) ??
      fileElement.querySelector(`tr[data-line="${lineNumber}"]`)
    if (!(targetElement instanceof HTMLElement)) return

    targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
    targetElement.classList.add('diff-comment-highlight')
    const timer = setTimeout(() => {
      targetElement.classList.remove('diff-comment-highlight')
      commentHighlightTimers.delete(timer)
    }, COMMENT_HIGHLIGHT_MS)
    commentHighlightTimers.add(timer)
  }

  return {
    focusDiff,
    handleScrollAreaKeydown,
    scrollToFile,
    scrollToFragment,
    getScrollTop,
    setScrollTop,
    scrollToComment,
  }
}
