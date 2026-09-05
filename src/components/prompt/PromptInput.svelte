<script lang="ts">
  import type { AutocompleteItem } from '../../lib/types'
  import PaletteListbox from '../shared/ui/PaletteListbox.svelte'
  import { useAutocomplete } from '../../lib/useAutocomplete.svelte'
  import type { CommandTrigger } from '../../lib/useAutocomplete.svelte'
  import { findImageMarkerAtPosition, insertImageMarker } from './imageMarkerEditing'
  import type { TextSelectionSnapshot } from './imageMarkerEditing'
  import { InsertRequestCoordinator } from './insertRequestCoordinator'

  interface Props {
    value?: string
    placeholder?: string
    ariaLabel?: string
    textareaId?: string
    rows?: number
    textareaClass?: string
    textareaStyle?: string
    containerClass?: string
    maxLength?: number
    projectId: string
    onSubmit: (prompt: string) => void
    onValueChange?: (value: string) => void
    onTextChange?: (prompt: string) => void
    onPasteImage?: (file: File) => string | null | void | Promise<string | null | void>
    onImageMarkerClick?: (marker: string) => void
    imageMarkerInsertRequest?: { id: number, marker: string } | null
    injectableInsertRequest?: { id: number, text: string } | null
    onCancel: () => void
    autofocus?: boolean
    commandTrigger?: CommandTrigger
  }

  let {
    value = '',
    placeholder = 'Describe what you want to implement...',
    ariaLabel,
    textareaId,
    rows = 2,
    textareaClass = 'p-3 text-sm',
    textareaStyle = 'max-height: 15rem; overflow-y: auto;',
    containerClass = '',
    maxLength,
    projectId,
    onSubmit,
    onValueChange,
    onTextChange,
    onPasteImage,
    onImageMarkerClick,
    imageMarkerInsertRequest = null,
    injectableInsertRequest = null,
    onCancel,
    autofocus = false,
    commandTrigger = 'slash',
  }: Props = $props()

  const getInitialTextValue = () => value
  const getAutocompleteProjectId = () => projectId

  // ── Local state ──────────────────────────────────────────────────────────────
  let textValue = $state(getInitialTextValue())

  let textareaEl = $state<HTMLTextAreaElement | null>(null)
  const imageMarkerInsertRequests = new InsertRequestCoordinator<{ id: number, marker: string }>()
  const injectableInsertRequests = new InsertRequestCoordinator<{ id: number, text: string }>()

  function updateTextValue(nextValue: string) {
    textValue = nextValue
    onValueChange?.(nextValue)
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

  export function insertText(text: string) {
    if (!textareaEl) return
    const cursorPos = textareaEl.selectionStart ?? textValue.length
    const before = textValue.slice(0, cursorPos)
    const after = textValue.slice(cursorPos)
    const separator = before.length > 0 && !before.endsWith(' ') && !before.endsWith('\n') ? ' ' : ''
    updateTextValue(before + separator + text + after)
    const newPos = cursorPos + separator.length + text.length
    setTimeout(() => {
      textareaEl?.focus()
      textareaEl?.setSelectionRange(newPos, newPos)
      autoGrow()
    }, 0)
  }
  function insertImageMarkerAtCursor(marker: string, selectionSnapshot: TextSelectionSnapshot | null = null) {
    if (!textareaEl) return

    const sourceText = selectionSnapshot?.text ?? textValue
    const selectionStart = selectionSnapshot?.selectionStart ?? textareaEl.selectionStart ?? sourceText.length
    const insertion = insertImageMarker(marker, selectionSnapshot ?? {
      text: sourceText,
      selectionStart,
      selectionEnd: selectionStart,
    })
    if (!insertion) return

    updateTextValue(insertion.text)
    setTimeout(() => {
      textareaEl?.focus()
      textareaEl?.setSelectionRange(insertion.cursorPosition, insertion.cursorPosition)
      autoGrow()
    }, 0)
  }

  $effect(() => {
    const request = imageMarkerInsertRequests.takeNewReadyRequest(imageMarkerInsertRequest, textareaEl !== null)
    if (!request) return

    insertImageMarkerAtCursor(request.marker)
  })

  $effect(() => {
    const request = injectableInsertRequests.takeNewReadyRequest(injectableInsertRequest, textareaEl !== null)
    if (!request) return

    insertText(request.text)
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
    const text = textareaEl.value
    updateTextValue(text)
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

    const marker = findImageMarkerAtPosition(textValue, textareaEl.selectionStart ?? 0)
    if (marker) onImageMarkerClick(marker)
  }

  // ── Item selection ────────────────────────────────────────────────────────────
  function handleSelect(item: AutocompleteItem) {
    if (!textareaEl) return

    if (ac.activeTrigger === 'slash' || ac.activeTrigger === 'dollar') {
      // Replace entire input with the provider-specific command trigger + command + trailing space
      updateTextValue(`${commandTriggerPrefix}${item.label} `)
    } else if (ac.activeTrigger === 'at') {
      const text = textareaEl.value
      const cursorPos = textareaEl.selectionStart ?? text.length
      const textBeforeCursor = text.slice(0, cursorPos)
      const atMatch = textBeforeCursor.match(/(^|[\s\n])@(\S*)$/)

      if (atMatch) {
        const atIndex = textBeforeCursor.lastIndexOf('@')
        const beforeAt = text.slice(0, atIndex)
        const afterCursor = text.slice(cursorPos)
        updateTextValue(`${beforeAt}@${item.label}${afterCursor}`)

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
  let paletteListbox: { handleKeydown: (event: KeyboardEvent) => boolean } | null = $state(null)

  function typeIcon(type: AutocompleteItem['type']): string | undefined {
    switch (type) {
      case 'file': return '📄'
      case 'directory': return '📁'
      case 'agent': return '🤖'
      case 'skill': return '⚡'
      case 'command': return '⌘'
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (ac.popoverVisible) {
      const handled = paletteListbox?.handleKeydown(e) ?? false
      if (handled) return
    }

    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSubmit()
      return
    }

    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onCancel()
    }
  }

  // ── Submit ────────────────────────────────────────────────────────────────────
  function handleSubmit() {
    const prompt = textValue.trim()
    if (!prompt) return
    onSubmit(prompt)
  }
</script>

<div class="relative {containerClass}">
  <PaletteListbox
    bind:this={paletteListbox}
    items={ac.autocompleteItems}
    selectedIndex={ac.selectedIndex}
    onSelectedIndexChange={ac.setSelectedIndex}
    onSelect={handleSelect}
    getKey={(item) => `${item.type}-${item.label}`}
    idPrefix="prompt-autocomplete"
    listboxLabel="Autocomplete suggestions"
    visible={ac.popoverVisible && ac.autocompleteItems.length > 0}
    wrap={false}
    onCancel={ac.closePopover}
    listClass="absolute top-full left-0 right-0 z-50 mt-1 bg-base-100 border border-base-300 shadow-lg rounded-[var(--of-radius-container)] overflow-hidden max-h-[320px] overflow-y-auto"
    optionClass={(_item, _index, highlighted) => `px-3 py-2 cursor-pointer flex items-center gap-2 hover:bg-base-200 ${highlighted ? 'bg-primary/10 text-primary' : ''}`}
  >
    {#snippet input(listboxId, activeDescendantId)}
      <textarea
        bind:this={textareaEl}
        bind:value={textValue}
        class="w-full resize-none bg-transparent border-none outline-none focus-visible:outline-none focus-visible:outline-offset-0 {textareaClass}"
        {rows}
        aria-label={ariaLabel}
        id={textareaId}
        {placeholder}
        maxlength={maxLength}
        style={textareaStyle}
        role={ac.popoverVisible ? 'combobox' : undefined}
        aria-autocomplete={ac.popoverVisible ? 'list' : undefined}
        aria-controls={ac.popoverVisible && ac.autocompleteItems.length > 0 ? listboxId : undefined}
        aria-expanded={ac.popoverVisible && ac.autocompleteItems.length > 0 ? true : undefined}
        aria-activedescendant={activeDescendantId}
        oninput={handleInput}
        onkeydown={handleKeydown}
        onpaste={handlePaste}
        onclick={handleClick}
      ></textarea>
    {/snippet}
    {#snippet item(item)}
      <span class="shrink-0 text-base leading-none" aria-hidden="true">{typeIcon(item.type)}</span>
      <span class="flex-1 min-w-0 flex items-baseline gap-2">
        <span class="text-sm font-medium truncate">{item.label}</span>
        {#if item.description}<span class="text-xs text-base-content/50 truncate flex-1">{item.description}</span>{/if}
      </span>
      {#if item.type === 'command' && item.source}
        <span class="shrink-0 text-[0.6rem] bg-base-200 px-1 rounded-[var(--of-radius-container)] text-base-content/50">{item.source}</span>
      {/if}
    {/snippet}
  </PaletteListbox>
</div>
