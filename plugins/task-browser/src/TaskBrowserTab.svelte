<script lang="ts">
  import { ArrowLeft, ArrowRight, PanelRightOpen, RefreshCw, X } from '@lucide/svelte'
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import IconButton from '@openforge-app/plugin-sdk/ui/IconButton.svelte'
  import { classifyTaskBrowserDevToolsShortcut } from '@openforge-app/plugin-sdk/taskBrowserDevToolsShortcuts'
  import type {
    Disposable,
    PluginTaskPaneProps,
    BrowserSurfaceVisualFeedbackAppearance,
    BrowserDevToolsPanel,
    TaskBrowserSurfaceState,
  } from '@openforge-app/plugin-sdk/frontend'
  import { onDestroy } from 'svelte'
  import {
    createBrowserTabSession,
    type BrowserTabSession,
  } from './browserTabSession'
  import VisualFeedbackEditor from './VisualFeedbackEditor.svelte'
  import VisualFeedbackReview from './VisualFeedbackReview.svelte'
  import { getTaskVisualFeedbackEditor } from './visualFeedbackEditorRegistry'
  import { formatVisualFeedbackReport } from './visualFeedbackReport'

  interface Props extends PluginTaskPaneProps {}


  let { api, taskId }: Props = $props()

  const blankState: TaskBrowserSurfaceState = {
    url: '',
    title: '',
    loading: false,
    canGoBack: false,
    canGoForward: false,
    devToolsOpen: false,
    error: null,
  }

  let browserRegion = $state<HTMLDivElement | null>(null)
  let session = $state<BrowserTabSession | null>(null)
  let visualFeedbackActionSubscription: Disposable | null = null
  let surfaceState = $state<TaskBrowserSurfaceState>(blankState)
  let address = $state('')
  let editingAddress = $state(false)
  let opening = $state(true)
  let actionError = $state<string | null>(null)
  let reviewingFeedback = $state(false)
  function handleFeedbackError(error: string | null) {
    actionError = error
  }
  function initialFeedbackEditor() {
    return {
      taskId,
      editor: getTaskVisualFeedbackEditor(api, taskId, handleFeedbackError),
    }
  }
  const initialFeedback = initialFeedbackEditor()
  let feedbackEditorTaskId = initialFeedback.taskId
  let feedbackEditor = $state.raw(initialFeedback.editor)
  function configuredVisualFeedbackAppearance(): BrowserSurfaceVisualFeedbackAppearance {
    return document.documentElement.getAttribute('data-theme') === 'openforge-dark' ? 'dark' : 'light'
  }
  let visualFeedbackAppearance = configuredVisualFeedbackAppearance()
  const themeObserver = new MutationObserver(() => {
    const nextAppearance = configuredVisualFeedbackAppearance()
    if (nextAppearance === visualFeedbackAppearance) return
    visualFeedbackAppearance = nextAppearance
    void feedbackEditor.setAppearance(nextAppearance)
  })
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  })
  let activeTaskId: string | null = null
  let lifecycleGeneration = 0
  let actionGeneration = 0
  let destroyed = false

  function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }

  function applyState(state: TaskBrowserSurfaceState) {
    surfaceState = state
    if (!editingAddress && (state.url.startsWith('https://') || state.url.startsWith('http://'))) {
      address = state.url
    }
    actionError = state.error?.message ?? null
  }

  async function switchTask(nextTaskId: string, element: HTMLElement) {
    const generation = ++lifecycleGeneration
    actionGeneration += 1
    activeTaskId = nextTaskId
    const previousSession = session
    const previousActionSubscription = visualFeedbackActionSubscription
    const previousFeedbackEditor = feedbackEditor
    session = null
    visualFeedbackActionSubscription = null
    surfaceState = blankState
    address = ''
    opening = true
    actionError = null
    reviewingFeedback = false

    await Promise.allSettled([
      previousFeedbackEditor.setSurface(null),
      previousActionSubscription?.dispose(),
      previousSession?.dispose(),
    ])
    if (destroyed || generation !== lifecycleGeneration) return

    if (feedbackEditorTaskId !== nextTaskId) {
      feedbackEditorTaskId = nextTaskId
      feedbackEditor = getTaskVisualFeedbackEditor(api, nextTaskId, handleFeedbackError)
    } else {
      feedbackEditor.setErrorHandler(handleFeedbackError)
    }
    await feedbackEditor.setAppearance(visualFeedbackAppearance)
    try {
      const nextSession = await createBrowserTabSession({
        api,
        taskId: nextTaskId,
        element,
        onStateChanged: (state) => {
          if (!destroyed && generation === lifecycleGeneration) applyState(state)
        },
      })
      if (destroyed || generation !== lifecycleGeneration) {
        await nextSession.dispose().catch(() => undefined)
        return
      }
      session = nextSession
      const actionEditor = feedbackEditor
      visualFeedbackActionSubscription = nextSession.surface.onVisualFeedbackAction(action => {
        if (destroyed || generation !== lifecycleGeneration) return
        void actionEditor.removeAnnotation(action.annotationNumber)
      })
      void feedbackEditor.setSurface(nextSession.surface)
    } catch (error) {
      if (generation === lifecycleGeneration) {
        activeTaskId = null
        actionError = errorMessage(error)
      }
    } finally {
      if (generation === lifecycleGeneration) opening = false
    }
  }

  async function runSurfaceAction(execute: (activeSession: BrowserTabSession) => Promise<TaskBrowserSurfaceState>) {
    const targetSession = session
    if (targetSession === null) return
    const taskGeneration = lifecycleGeneration
    const operationGeneration = ++actionGeneration
    actionError = null
    try {
      const state = await execute(targetSession)
      if (
        !destroyed
        && session === targetSession
        && lifecycleGeneration === taskGeneration
        && actionGeneration === operationGeneration
      ) {
        applyState(state)
      }
    } catch (error) {
      if (
        !destroyed
        && session === targetSession
        && lifecycleGeneration === taskGeneration
        && actionGeneration === operationGeneration
      ) {
        actionError = errorMessage(error)
      }
    }
  }

  function sendFeedback() {
    const sendingTaskId = taskId
    void feedbackEditor.send(async (captures, annotations) => {
      const message = formatVisualFeedbackReport(captures, annotations)
      await api.tasks.sendFollowUp({ taskId: sendingTaskId, message })
      reviewingFeedback = false
    })
  }

  async function setDevToolsOpen(
    activeSession: BrowserTabSession,
    panel?: BrowserDevToolsPanel,
  ): Promise<TaskBrowserSurfaceState> {
    if (!surfaceState.devToolsOpen && feedbackEditor.active) await feedbackEditor.toggle()
    if (panel) return activeSession.openDevTools(panel)
    return surfaceState.devToolsOpen
      ? activeSession.closeDevTools()
      : activeSession.openDevTools()
  }

  function devToolsKeyboardShortcut(event: KeyboardEvent) {
    return classifyTaskBrowserDevToolsShortcut(
      navigator.platform.toLowerCase().includes('mac') ? 'macos' : 'other',
      {
        key: event.key.toLowerCase(),
        keyDown: event.type === 'keydown',
        repeat: event.repeat,
        control: event.ctrlKey,
        shift: event.shiftKey,
        alt: event.altKey,
        meta: event.metaKey,
      },
    )
  }

  function handleDevToolsShortcut(event: KeyboardEvent) {
    const shortcut = devToolsKeyboardShortcut(event)
    if (shortcut === null) return
    event.preventDefault()
    void runSurfaceAction(activeSession => shortcut === 'toggle'
      ? setDevToolsOpen(activeSession)
      : setDevToolsOpen(activeSession, shortcut))
  }

  function submitAddress(event: SubmitEvent) {
    event.preventDefault()
    editingAddress = false
    void runSurfaceAction(activeSession => activeSession.navigate(address))
  }

  function retrySurface() {
    const element = browserRegion
    if (element !== null) void switchTask(taskId, element)
  }

  $effect(() => {
    const element = browserRegion
    const nextTaskId = taskId
    if (element === null || activeTaskId === nextTaskId) return
    void switchTask(nextTaskId, element)
  })

  onDestroy(() => {
    themeObserver.disconnect()
    destroyed = true
    lifecycleGeneration += 1
    actionGeneration += 1
    const currentSession = session
    const currentActionSubscription = visualFeedbackActionSubscription
    const currentFeedbackEditor = feedbackEditor
    currentFeedbackEditor.setErrorHandler(() => undefined)
    session = null
    visualFeedbackActionSubscription = null
    void Promise.allSettled([
      currentFeedbackEditor.setSurface(null),
      currentActionSubscription?.dispose(),
      currentSession?.dispose(),
    ])
  })
</script>

<svelte:window onkeydown={handleDevToolsShortcut} />

<div class="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-base-100">
  <form
    data-testid="browser-navigation-toolbar"
    class="flex min-h-[var(--of-control-height-touch)] shrink-0 items-center gap-1.5 border-b border-base-300 bg-base-100 px-2"
    onsubmit={submitAddress}
  >
    <div class="flex shrink-0 items-center gap-0.5">
      <IconButton
        label="Go back"
        size="xs"
        type="button"
        title="Go back"
        disabled={opening || !surfaceState.canGoBack}
        onclick={() => void runSurfaceAction(activeSession => activeSession.goBack())}
      >
        <ArrowLeft size={15} aria-hidden="true" />
      </IconButton>
      <IconButton
        label="Go forward"
        size="xs"
        type="button"
        title="Go forward"
        disabled={opening || !surfaceState.canGoForward}
        onclick={() => void runSurfaceAction(activeSession => activeSession.goForward())}
      >
        <ArrowRight size={15} aria-hidden="true" />
      </IconButton>
      <IconButton
        label={surfaceState.loading ? 'Stop loading' : 'Reload page'}
        size="xs"
        type="button"
        title={surfaceState.loading ? 'Stop loading' : 'Reload page'}
        disabled={opening || session === null}
        onclick={() => void runSurfaceAction(activeSession => surfaceState.loading
          ? activeSession.stop()
          : activeSession.reload())}
      >
        {#if surfaceState.loading}
          <X size={15} aria-hidden="true" />
        {:else}
          <RefreshCw size={15} aria-hidden="true" />
        {/if}
      </IconButton>
    </div>

    <label class="sr-only" for="task-browser-address">Web address</label>
    <input
      id="task-browser-address"
      class="browser-address-input min-w-0 flex-1"
      type="text"
      inputmode="url"
      autocomplete="off"
      spellcheck="false"
      placeholder="https://example.com"
      bind:value={address}
      disabled={opening}
      onfocus={() => { editingAddress = true }}
      onblur={() => { editingAddress = false }}
    />
    <Button variant="ghost" size="sm" type="submit" disabled={opening || address.trim().length === 0}>
      Go
    </Button>

    <IconButton
      label={surfaceState.devToolsOpen ? 'Close Developer Tools' : 'Open Developer Tools'}
      variant={surfaceState.devToolsOpen ? 'primary' : 'ghost'}
      size="xs"
      type="button"
      aria-pressed={surfaceState.devToolsOpen}
      title={surfaceState.devToolsOpen ? 'Close Developer Tools' : 'Open Developer Tools'}
      disabled={opening || session === null}
      onclick={() => void runSurfaceAction(setDevToolsOpen)}
    >
      <PanelRightOpen size={15} aria-hidden="true" />
    </IconButton>
    <VisualFeedbackEditor
      available={!opening && session !== null}
      editor={feedbackEditor}
      reviewing={reviewingFeedback}
      onReview={() => { reviewingFeedback = !reviewingFeedback }}
      onSend={sendFeedback}
    />
  </form>


  {#if reviewingFeedback && feedbackEditor.annotations.length > 0}
    <VisualFeedbackReview
      editor={feedbackEditor}
      onClose={() => { reviewingFeedback = false }}
    />
  {/if}

  <div bind:this={browserRegion} class="relative min-h-0 flex-1 overflow-hidden">
    {#if actionError !== null && session !== null}
      <div class="absolute right-3 top-3 z-20 w-auto max-w-lg border border-error/30 bg-error/10 px-4 py-2 text-sm text-error shadow-sm" aria-live="polite">
        <span>{actionError}</span>
      </div>
    {/if}
    {#if opening}
      <div class="flex h-full items-center justify-center p-6 text-sm text-base-content/60" role="status">
        <span class="loading loading-spinner loading-md" aria-hidden="true"></span>
        <span class="ml-3">Starting secure browser surface…</span>
      </div>
    {:else if session === null}
      <div class="flex h-full items-center justify-center p-6 text-center" role="alert">
        <div class="max-w-md space-y-2">
          <p class="font-medium">Browser unavailable</p>
          <p class="text-sm text-base-content/70">{actionError ?? 'OpenForge could not create the browser surface.'}</p>
          <Button size="sm" type="button" onclick={retrySurface}>Retry</Button>
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .browser-address-input {
    box-sizing: border-box;
    min-height: var(--of-control-height);
    padding: 0 var(--of-space3);
    border: var(--of-border-width) solid var(--of-border-interactive);
    border-radius: var(--of-radius-control);
    background: var(--of-field);
    color: var(--of-text);
    font-family: var(--of-font-mono);
    font-size: var(--of-text-xs);
    line-height: var(--of-line-height-xs);
    transition:
      background-color var(--of-duration-fast) var(--of-ease-standard),
      border-color var(--of-duration-fast) var(--of-ease-standard);
  }

  .browser-address-input:hover:not(:disabled) {
    background: var(--of-field-hover);
  }

  .browser-address-input:focus-visible {
    outline: var(--of-focus-width) solid var(--of-focus-ring);
    outline-offset: var(--of-space1);
  }

  .browser-address-input:disabled {
    background: var(--of-control-disabled);
    color: var(--of-control-text-disabled);
    cursor: not-allowed;
  }

  .browser-address-input::placeholder {
    color: var(--of-text-muted);
  }

  @media (prefers-reduced-motion: reduce) {
    .browser-address-input {
      transition: none;
    }
  }
</style>
