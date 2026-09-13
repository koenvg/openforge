<script lang="ts">
  import Modal from '@openforge-app/plugin-sdk/ui/Modal.svelte'
  import { getGlobalShortcutHelpEntries } from '../../lib/appShortcutDefinitions'
  import type { AppShortcutHelpController } from '../../lib/appShortcutHelpController.svelte'

  interface Props {
    controller: AppShortcutHelpController
    taskSelected: boolean
    boardVisible: boolean
  }

  let { controller, taskSelected, boardVisible }: Props = $props()
  const globalShortcutHelpEntries = getGlobalShortcutHelpEntries()
</script>

{#if controller.isOpen}
  <Modal onClose={controller.close} maxWidth="420px" ariaLabel="Keyboard Shortcuts">
    {#snippet header()}
      <h2 class="text-[0.95rem] font-semibold text-of-text m-0">Keyboard Shortcuts</h2>
    {/snippet}
    <div class="p-5 flex flex-col gap-4">
      <div>
        <div class="font-mono text-xs text-of-control mb-3">Global</div>
        <div class="flex flex-col gap-2">
          {#each globalShortcutHelpEntries as shortcut}
            <div class="flex items-center justify-between">
              <span class="text-sm text-of-text">{shortcut.label}</span>
              <div class="flex items-center gap-1.5">
                {#each shortcut.keys as keySequence, sequenceIndex}
                  {#if sequenceIndex > 0}
                    <span class="text-xs text-of-text/50">or</span>
                  {/if}
                  <span class="flex gap-0.5">
                    {#each keySequence as key}
                      <kbd class="of-key-hint of-key-hint-sm">{key}</kbd>
                    {/each}
                  </span>
                {/each}
              </div>
            </div>
          {/each}
        </div>
      </div>

      <div>
        <div class="font-mono text-xs text-of-control mb-3">Vim navigation</div>
        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <span class="text-sm text-of-text">Move down / up</span>
            <div class="flex gap-0.5"><kbd class="of-key-hint of-key-hint-sm">j</kbd><kbd class="of-key-hint of-key-hint-sm">k</kbd><kbd class="of-key-hint of-key-hint-sm">↓</kbd><kbd class="of-key-hint of-key-hint-sm">↑</kbd></div>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-sm text-of-text">Select / open</span>
            <kbd class="of-key-hint of-key-hint-sm">Enter</kbd>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-sm text-of-text">Action on task</span>
            <kbd class="of-key-hint of-key-hint-sm">x</kbd>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-sm text-of-text">First / last item</span>
            <div class="flex gap-0.5"><kbd class="of-key-hint of-key-hint-sm">gg</kbd><kbd class="of-key-hint of-key-hint-sm">G</kbd></div>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-sm text-of-text">Back</span>
            <div class="flex gap-0.5"><kbd class="of-key-hint of-key-hint-sm">Esc</kbd><kbd class="of-key-hint of-key-hint-sm">q</kbd></div>
          </div>
        </div>
      </div>

      {#if taskSelected}
        <div>
          <div class="font-mono text-xs text-of-control mb-3">Task view</div>
          <div class="flex flex-col gap-2">
            <div class="flex items-center justify-between">
              <span class="text-sm text-of-text">Info panel</span>
              <kbd class="of-key-hint of-key-hint-sm">⌘/</kbd>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-sm text-of-text">Agent / Review / Terminal (if available)</span>
              <div class="flex gap-0.5"><kbd class="of-key-hint of-key-hint-sm">⌘1</kbd><kbd class="of-key-hint of-key-hint-sm">⌘2</kbd><kbd class="of-key-hint of-key-hint-sm">⌘3</kbd></div>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-sm text-of-text">Zen mode</span>
              <div class="flex gap-0.5"><kbd class="of-key-hint of-key-hint-sm">⌘.</kbd><kbd class="of-key-hint of-key-hint-sm">⌘Z</kbd></div>
            </div>
          </div>
        </div>
      {/if}

      {#if boardVisible}
        <div>
          <div class="font-mono text-xs text-of-control mb-3">Board</div>
          <div class="flex flex-col gap-2">
            <div class="flex items-center justify-between">
              <span class="text-sm text-of-text">Board filters</span>
              <div class="flex gap-0.5"><kbd class="of-key-hint of-key-hint-sm">⌘1</kbd><kbd class="of-key-hint of-key-hint-sm">⌘2</kbd><kbd class="of-key-hint of-key-hint-sm">⌘3</kbd></div>
            </div>
          </div>
        </div>
      {/if}
    </div>
  </Modal>
{/if}
