<script lang="ts">
  import { Plus } from '@lucide/svelte'
  import type { Action } from '@openforge/plugin-sdk'
  import type { BoardCard, BoardColumn } from '../lib/board'
  import Card from './Card.svelte'
  import ColorPicker from './ColorPicker.svelte'
  import IssueContextMenu from './IssueContextMenu.svelte'

  interface Props {
    columns: BoardColumn[]
    repo: string
    onCardClick: (card: BoardCard) => void
    onOpenUrl: (url: string) => void
    onCopyLink: (issueNumber: number) => void
    onRecolor: (label: string, color: string) => void
    actions?: Action[]
    busy?: boolean
    onRunAction: (card: BoardCard, actionPrompt: string) => void
    onAddCard: (label: string) => void
  }

  let {
    columns,
    repo,
    onCardClick,
    onOpenUrl,
    onCopyLink,
    onRecolor,
    actions = [],
    busy = false,
    onRunAction,
    onAddCard,
  }: Props = $props()

  let openColorLabel = $state<string | null>(null)
  let contextMenu = $state<{ visible: boolean; x: number; y: number; card: BoardCard | null }>({
    visible: false,
    x: 0,
    y: 0,
    card: null,
  })

  const HEX6 = /^[0-9a-fA-F]{6}$/

  // GitHub label colors are data; apply a soft theme-aware tint from the API value
  // only. color-mix blends the hex into a daisyUI semantic base color.
  function columnTint(color: string | null): string {
    if (!color || !HEX6.test(color)) return ''
    return `background-color: color-mix(in srgb, #${color} 12%, var(--color-base-200)); border-color: color-mix(in srgb, #${color} 30%, var(--color-base-300));`
  }

  function swatchStyle(color: string | null): string {
    if (!color || !HEX6.test(color)) return ''
    return `background-color: #${color};`
  }

  function pickColor(label: string, color: string) {
    openColorLabel = null
    onRecolor(label, color)
  }

  function openContextMenu(event: MouseEvent, card: BoardCard) {
    event.preventDefault()
    event.stopPropagation()
    contextMenu = { visible: true, x: event.clientX, y: event.clientY, card }
  }

  function closeContextMenu() {
    contextMenu = { ...contextMenu, visible: false }
  }

  function runContextAction(actionPrompt: string) {
    const card = contextMenu.card
    closeContextMenu()
    if (card) onRunAction(card, actionPrompt)
  }

  function addCard(event: MouseEvent, label: string) {
    event.stopPropagation()
    onAddCard(label)
  }
</script>

<div class="roadmap-board p-4 overflow-y-auto h-full">
  {#each columns as column (column.label || 'other')}
    <div
      class="roadmap-column flex-col rounded-box border border-base-300 bg-base-200"
      style={columnTint(column.color)}
    >
      <div class="flex items-center gap-2 px-3 py-2 border-b border-base-300/60">
        {#if !column.isOther}
          <span class="relative inline-flex shrink-0">
            <button
              type="button"
              class="h-3.5 w-3.5 rounded-md border border-base-content/20 transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-primary"
              style={swatchStyle(column.color)}
              aria-label={`Change color of ${column.title}`}
              title={`Change "${column.title}" color`}
              onclick={(e) => {
                e.stopPropagation()
                openColorLabel = openColorLabel === column.label ? null : column.label
              }}
            ></button>
            {#if openColorLabel === column.label}
              <ColorPicker
                current={column.color}
                onPick={(color) => pickColor(column.label, color)}
                onClose={() => (openColorLabel = null)}
              />
            {/if}
          </span>
        {/if}
        <span class="text-sm font-semibold text-base-content truncate">{column.title}</span>
        <span class="badge badge-ghost badge-sm ml-auto shrink-0">{column.cards.length}</span>
        <button
          type="button"
          class="btn btn-ghost btn-xs btn-square shrink-0"
          aria-label={column.isOther ? 'Create issue with no label' : `Create issue in ${column.title}`}
          title={column.isOther ? 'Create issue with no label' : `Create issue in ${column.title}`}
          disabled={busy}
          onclick={(e) => addCard(e, column.label)}
        >
          <Plus size={14} />
        </button>
      </div>
      <div class="flex flex-col gap-2 p-2 overflow-y-auto">
        {#each column.cards as card (card.issueNumber)}
          <Card
            {card}
            {repo}
            onOpen={() => {
              closeContextMenu()
              onCardClick(card)
            }}
            {onOpenUrl}
            {onCopyLink}
            onContextMenu={(event) => openContextMenu(event, card)}
          />
        {/each}
        {#if column.cards.length === 0}
          <p class="text-xs text-base-content/40 text-center py-4 m-0">No issues</p>
        {/if}
      </div>
    </div>
  {/each}

  <IssueContextMenu
    visible={contextMenu.visible}
    x={contextMenu.x}
    y={contextMenu.y}
    {actions}
    disabled={busy}
    onClose={closeContextMenu}
    onStart={() => runContextAction('')}
    onRunAction={(action) => runContextAction(action.prompt)}
  />
</div>

<style>
  .roadmap-board {
    columns: 300px;
    column-gap: 0.75rem;
  }

  .roadmap-column {
    break-inside: avoid;
    display: inline-flex;
    margin-bottom: 0.75rem;
    vertical-align: top;
    width: 100%;
  }
</style>
