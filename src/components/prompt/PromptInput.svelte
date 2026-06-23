<script lang="ts">
  import { onMount } from 'svelte'
  import type { Snippet } from 'svelte'
  import type { AutocompleteItem, Action } from '../../lib/types'
  import AutocompletePopover from './AutocompletePopover.svelte'
  import VoiceInput from '../shared/input/VoiceInput.svelte'
  import ModelDownloadProgress from '../shared/input/ModelDownloadProgress.svelte'
  import { useAutocomplete } from '../../lib/useAutocomplete.svelte'
  import type { CommandTrigger } from '../../lib/useAutocomplete.svelte'
  import { useListNavigation } from '../../lib/useListNavigation.svelte'

  interface Props {
    value?: string
    placeholder?: string
    projectId: string
    onSubmit: (prompt: string) => void
    onStartTask?: (prompt: string) => void
    onRunAction?: (prompt: string, actionPrompt: string) => void
    onTextChange?: (prompt: string) => void
    onPasteImage?: (file: File) => string | null | void | Promise<string | null | void>
    onImageMarkerClick?: (marker: string) => void
    imageMarkerInsertRequest?: { id: number, marker: string } | null
    onCancel: () => void
    autofocus?: boolean
    extras?: Snippet
    actions?: Action[]
    commandTrigger?: CommandTrigger
  }

  let {
    value = '',
    placeholder = 'Describe what you want to implement...',
    projectId,
    onSubmit,
    onStartTask,
    onRunAction,
    onTextChange,
    onPasteImage,
    onImageMarkerClick,
    imageMarkerInsertRequest = null,
    onCancel,
    autofocus = false,
    extras,
    actions = [],
    commandTrigger = 'slash'
  }: Props = $props()

  const getInitialTextValue = () => value
  const getAutocompleteProjectId = () => projectId

  // ── Local state ──────────────────────────────────────────────────────────────
  let textValue = $state(getInitialTextValue())
  let showModelDownload = $state(false)
  let showMoreMenu = $state(false)

  let textareaEl = $state<HTMLTextAreaElement | null>(null)
  let moreActionsEl = $state<HTMLElement | null>(null)
  const promptReady = $derived(textValue.trim().length > 0)
  let lastImageMarkerInsertRequestId = 0

  interface TextSelectionSnapshot {
    text: string
    selectionStart: number
    selectionEnd: number
  }

  function setTextValue(nextValue: string) {
    textValue = nextValue
    onTextChange?.(nextValue)
  }

  // ── Autocomplete composable ───────────────────────────────────────────────────
  const ac = useAutocomplete(getAutocompleteProjectId(), () => commandTrigger)
  const commandTriggerPrefix = $derived(commandTrigger === 'dollar' ? '$' : '/')

  // ── Auto-focus ───────────────────────────────────────────────────────────────
  // Use requestAnimationFrame to ensure focus happens after the component's DOM settles.
  $effect(() => {
    if (textareaEl && autofocus) {
      requestAnimationFrame(() => textareaEl?.focus())
    }
  })

  onMount(() => {
    document.addEventListener('pointerdown', handleDocumentPointerDown)
    return () => document.removeEventListener('pointerdown', handleDocumentPointerDown)
  })

  // ── Transcription ────────────────────────────────────────────────────────────
  function handleTranscription(text: string) {
    if (!textareaEl) return
    const cursorPos = textareaEl.selectionStart ?? textValue.length
    const before = textValue.slice(0, cursorPos)
    const after = textValue.slice(cursorPos)
    const separator = before.length > 0 && !before.endsWith(' ') && !before.endsWith('\n') ? ' ' : ''
    setTextValue(before + separator + text + after)
    const newPos = cursorPos + separator.length + text.length
    setTimeout(() => {
      textareaEl?.setSelectionRange(newPos, newPos)
      autoGrow()
    }, 0)
  }

  function imageMarkerInsertionText(marker: string, before: string, after: string): string {
    const prefix = before.length > 0 && !/\s$/.test(before) ? ' ' : ''
    const suffix = after.length === 0 || !/^\s/.test(after) ? ' ' : ''
    return `${prefix}${marker}${suffix}`
  }

  function insertImageMarkerAtCursor(marker: string, selectionSnapshot: TextSelectionSnapshot | null = null) {
    if (!textareaEl || !marker.trim()) return

    const sourceText = selectionSnapshot?.text ?? textValue
    const selectionStart = selectionSnapshot?.selectionStart ?? textareaEl.selectionStart ?? sourceText.length
    const selectionEnd = selectionSnapshot?.selectionEnd ?? selectionStart
    const before = sourceText.slice(0, selectionStart)
    const after = sourceText.slice(selectionEnd)
    const insertion = imageMarkerInsertionText(marker.trim(), before, after)
    setTextValue(`${before}${insertion}${after}`)
    const nextCursorPos = before.length + insertion.length

    setTimeout(() => {
      textareaEl?.focus()
      textareaEl?.setSelectionRange(nextCursorPos, nextCursorPos)
      autoGrow()
    }, 0)
  }

  function imageMarkerAtPosition(text: string, position: number): string | null {
    const markerPattern = /\[image#\d+\]/g
    let match: RegExpExecArray | null

    while ((match = markerPattern.exec(text)) !== null) {
      const start = match.index
      const end = start + match[0].length
      if (position >= start && position < end) return match[0]
    }

    return null
  }

  $effect(() => {
    const request = imageMarkerInsertRequest
    if (!request || request.id === lastImageMarkerInsertRequestId || !textareaEl) return

    lastImageMarkerInsertRequestId = request.id
    insertImageMarkerAtCursor(request.marker)
  })

  // ── Auto-grow ────────────────────────────────────────────────────────────────
  function autoGrow() {
    if (!textareaEl) return
    textareaEl.style.height = 'auto'
    textareaEl.style.height = textareaEl.scrollHeight + 'px'
  }

  // ── Input handler ────────────────────────────────────────────────────────────
  async function handleInput() {
    autoGrow()
    if (!textareaEl) return
    if (!promptReady) showMoreMenu = false
    const text = textareaEl.value
    setTextValue(text)
    const cursorPos = textareaEl.selectionStart ?? text.length
    await ac.handleTriggerDetection(text, cursorPos)
  }

  async function handlePaste(e: ClipboardEvent) {
    if (!onPasteImage) return

    const imageItem = Array.from(e.clipboardData?.items ?? [])
      .find((item) => item.kind === 'file' && item.type.startsWith('image/'))
    const file = imageItem?.getAsFile()
    if (!file) return

    e.preventDefault()
    const selectionSnapshot = {
      text: textValue,
      selectionStart: textareaEl?.selectionStart ?? textValue.length,
      selectionEnd: textareaEl?.selectionEnd ?? textValue.length,
    }
    const marker = await onPasteImage(file)
    if (typeof marker === 'string') {
      insertImageMarkerAtCursor(marker, selectionSnapshot)
    }
  }

  function handleClick() {
    if (!onImageMarkerClick || !textareaEl) return
    if (textareaEl.selectionStart !== textareaEl.selectionEnd) return

    const marker = imageMarkerAtPosition(textValue, textareaEl.selectionStart ?? 0)
    if (marker) onImageMarkerClick(marker)
  }

  // ── Item selection ────────────────────────────────────────────────────────────
  function handleSelect(item: AutocompleteItem) {
    if (!textareaEl) return

    if (ac.activeTrigger === 'slash' || ac.activeTrigger === 'dollar') {
      // Replace entire input with the provider-specific command trigger + command + trailing space
      setTextValue(`${commandTriggerPrefix}${item.label} `)
    } else if (ac.activeTrigger === 'at') {
      const text = textareaEl.value
      const cursorPos = textareaEl.selectionStart ?? text.length
      const textBeforeCursor = text.slice(0, cursorPos)
      const atMatch = textBeforeCursor.match(/(^|[\s\n])@(\S*)$/)

      if (atMatch) {
        const atIndex = textBeforeCursor.lastIndexOf('@')
        const beforeAt = text.slice(0, atIndex)
        const afterCursor = text.slice(cursorPos)
        setTextValue(`${beforeAt}@${item.label}${afterCursor}`)

        // Move cursor to just after the inserted label
        const newCursorPos = atIndex + 1 + item.label.length
        setTimeout(() => {
          textareaEl?.setSelectionRange(newCursorPos, newCursorPos)
        }, 0)
      }
    }

    ac.closePopover()
    // Let the DOM update, then auto-grow
    setTimeout(() => autoGrow(), 0)
    textareaEl.focus()
  }

  // ── Keyboard handler ──────────────────────────────────────────────────────────
  const listNav = useListNavigation({
    get itemCount() { return ac.autocompleteItems.length },
    get selectedIndex() { return ac.selectedIndex },
    set selectedIndex(index: number) { ac.setSelectedIndex(index) },
    wrap: false,
    onSelect() {
      const item = ac.autocompleteItems[ac.selectedIndex]
      if (item) handleSelect(item)
    },
    onCancel() { ac.closePopover() }
  })

  function handleKeydown(e: KeyboardEvent) {
    if (ac.popoverVisible) {
      const handled = listNav.handleKeydown(e)
      if (handled) return
    }

    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      if (onStartTask && e.shiftKey) {
        handleSubmit()
      } else if (onStartTask) {
        handleStart()
      } else {
        handleSubmit()
      }
      return
    }

    if (e.key === 'Escape') {
      e.preventDefault()
      if (showMoreMenu) {
        showMoreMenu = false
        return
      }
      onCancel()
    }
  }

  // ── Submit ────────────────────────────────────────────────────────────────────
  function handleSubmit() {
    const prompt = textValue.trim()
    if (!prompt) return
    showMoreMenu = false
    onSubmit(prompt)
  }

  function handleStart() {
    const prompt = textValue.trim()
    if (!prompt) return
    showMoreMenu = false
    onStartTask?.(prompt)
  }

  function handleCustomAction(actionPrompt: string) {
    const prompt = textValue.trim()
    if (!prompt) return
    showMoreMenu = false
    onRunAction?.(prompt, actionPrompt)
  }

  function toggleMoreMenu() {
    if (!promptReady) return
    showMoreMenu = !showMoreMenu
  }

  function handleMoreMenuKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape') return
    e.preventDefault()
    e.stopPropagation()
    showMoreMenu = false
    textareaEl?.focus()
  }

  function handleDocumentPointerDown(e: PointerEvent) {
    if (!showMoreMenu) return
    const target = e.target
    if (!(target instanceof Node)) return
    if (moreActionsEl?.contains(target)) return
    showMoreMenu = false
  }
</script>

<div class="bg-base-100">
  <div class="relative">
    <textarea
      bind:this={textareaEl}
      bind:value={textValue}
      class="w-full resize-none bg-transparent border-none outline-none p-3 text-sm"
      rows={2}
      {placeholder}
      style="max-height: 15rem; overflow-y: auto;"
      oninput={handleInput}
      onkeydown={handleKeydown}
      onpaste={handlePaste}
      onclick={handleClick}
    ></textarea>

    <AutocompletePopover
      items={ac.autocompleteItems}
      visible={ac.popoverVisible}
      selectedIndex={ac.selectedIndex}
      onSelect={handleSelect}
      onClose={ac.closePopover}
    />
  </div>

  {#if extras}
    <div class="px-3 pb-1">
      {@render extras()}
    </div>
  {/if}

  <div class="flex items-center justify-between gap-3 px-3 pb-2">
    <div class="flex min-w-0 items-center gap-2">
      <VoiceInput onTranscription={handleTranscription} listenToHotkey />
      {#if onStartTask}
        <span class="truncate text-xs text-base-content/60">Press ⌘↵ to start, or use More for backlog/templates.</span>
      {/if}
    </div>
    <div class="flex shrink-0 items-center gap-2">
      {#if onStartTask}
        {#if promptReady}
          <div class="relative" bind:this={moreActionsEl}>
            <button
              class="btn btn-ghost btn-sm"
              type="button"
              onclick={toggleMoreMenu}
              aria-expanded={showMoreMenu}
              aria-haspopup="menu"
              aria-controls="prompt-more-actions"
              onkeydown={handleMoreMenuKeydown}
            >More</button>

            {#if showMoreMenu}
              <div
                id="prompt-more-actions"
                role="menu"
                class="absolute bottom-[calc(100%+0.5rem)] right-0 z-[100] min-w-48 overflow-hidden rounded-lg border border-base-300 bg-base-100 shadow-lg"
              >
                <button
                  class="block w-full px-3 py-2 text-left text-sm text-base-content hover:bg-base-200 focus:bg-base-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  type="button"
                  role="menuitem"
                  onclick={handleSubmit}
                  onkeydown={handleMoreMenuKeydown}
                >Add to Backlog</button>
                {#each actions as action (action.id)}
                  <button
                    class="block w-full px-3 py-2 text-left text-sm text-base-content hover:bg-base-200 focus:bg-base-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    type="button"
                    role="menuitem"
                    title={action.prompt || action.name}
                    onclick={() => handleCustomAction(action.prompt)}
                    onkeydown={handleMoreMenuKeydown}
                  >{action.name}</button>
                {/each}
              </div>
            {/if}
          </div>
        {/if}
        <button
          class="btn btn-primary btn-sm"
          type="button"
          disabled={!promptReady}
          onclick={handleStart}
          title="⌘Enter"
        >Start Task <kbd class="kbd kbd-xs ml-1 bg-primary-content text-primary border-primary-content/30">⌘↵</kbd></button>
      {:else}
        <span class="text-xs text-base-content opacity-70">⌘Enter to submit</span>
        <button
          class="btn btn-primary btn-sm"
          type="button"
          disabled={!promptReady}
          onclick={handleSubmit}
        >Submit</button>
      {/if}
    </div>
  </div>

  {#if showModelDownload}
    <div class="px-3 pb-2">
      <ModelDownloadProgress
        onComplete={() => { showModelDownload = false }}
        onError={() => { showModelDownload = false }}
      />
    </div>
  {/if}
</div>
