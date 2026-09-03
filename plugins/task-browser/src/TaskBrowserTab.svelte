<script lang="ts">
  import { ArrowLeft, ArrowRight, PanelRightOpen, RefreshCw, X } from '@lucide/svelte'
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
    class="flex h-10 shrink-0 items-center gap-1.5 border-b border-base-300 bg-base-100 px-2"
    onsubmit={submitAddress}
  >
    <div class="flex shrink-0 items-center gap-0.5">
      <button
        class="btn btn-ghost btn-square btn-xs h-8 min-h-8 w-8"
        type="button"
        aria-label="Go back"
        title="Go back"
        disabled={opening || !surfaceState.canGoBack}
        onclick={() => void runSurfaceAction(activeSession => activeSession.goBack())}
      >
        <ArrowLeft size={15} aria-hidden="true" />
      </button>
      <button
        class="btn btn-ghost btn-square btn-xs h-8 min-h-8 w-8"
        type="button"
        aria-label="Go forward"
        title="Go forward"
        disabled={opening || !surfaceState.canGoForward}
        onclick={() => void runSurfaceAction(activeSession => activeSession.goForward())}
      >
        <ArrowRight size={15} aria-hidden="true" />
      </button>
      <button
        class="btn btn-ghost btn-square btn-xs h-8 min-h-8 w-8"
        type="button"
        aria-label={surfaceState.loading ? 'Stop loading' : 'Reload page'}
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
      </button>
    </div>

    <label class="sr-only" for="task-browser-address">Web address</label>
    <input
      id="task-browser-address"
      class="input input-bordered h-8 min-h-8 min-w-0 flex-1 rounded-md px-3 font-mono text-xs"
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
    <button class="btn btn-ghost btn-sm h-8 min-h-8 px-3" type="submit" disabled={opening || address.trim().length === 0}>
      Go
    </button>

    <button
      class="btn btn-ghost btn-square btn-xs h-8 min-h-8 w-8"
      class:btn-active={surfaceState.devToolsOpen}
      type="button"
      aria-label={surfaceState.devToolsOpen ? 'Close Developer Tools' : 'Open Developer Tools'}
      aria-pressed={surfaceState.devToolsOpen}
      title={surfaceState.devToolsOpen ? 'Close Developer Tools' : 'Open Developer Tools'}
      disabled={opening || session === null}
      onclick={() => void runSurfaceAction(setDevToolsOpen)}
    >
      <PanelRightOpen size={15} aria-hidden="true" /></button>

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
      <div class="alert alert-error absolute right-3 top-3 z-20 w-auto max-w-lg py-2 text-sm shadow-sm" aria-live="polite">
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
          <button class="btn btn-primary btn-sm" type="button" onclick={retrySurface}>Retry</button>
        </div>
      </div>
    {/if}
  </div>
</div>
