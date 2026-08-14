<script lang="ts">
  import { ArrowLeft, ArrowRight, RefreshCw, X } from '@lucide/svelte'
  import type {
    PluginTaskPaneProps,
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
    error: null,
  }

  let browserRegion = $state<HTMLDivElement | null>(null)
  let session = $state<BrowserTabSession | null>(null)
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
    const previousFeedbackEditor = feedbackEditor
    session = null
    surfaceState = blankState
    address = ''
    opening = true
    actionError = null
    reviewingFeedback = false

    await Promise.allSettled([
      previousFeedbackEditor.setSurface(null),
      previousSession?.dispose(),
    ])
    if (destroyed || generation !== lifecycleGeneration) return

    if (feedbackEditorTaskId !== nextTaskId) {
      feedbackEditorTaskId = nextTaskId
      feedbackEditor = getTaskVisualFeedbackEditor(api, nextTaskId, handleFeedbackError)
    } else {
      feedbackEditor.setErrorHandler(handleFeedbackError)
    }
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
    destroyed = true
    lifecycleGeneration += 1
    actionGeneration += 1
    const currentSession = session
    const currentFeedbackEditor = feedbackEditor
    currentFeedbackEditor.setErrorHandler(() => undefined)
    session = null
    void Promise.allSettled([
      currentFeedbackEditor.setSurface(null),
      currentSession?.dispose(),
    ])
  })
</script>

<div class="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-base-100">
  <form class="flex items-center gap-2 border-b border-base-300 bg-base-200/50 p-2" onsubmit={submitAddress}>
    <div class="join shrink-0">
      <button
        class="btn btn-square btn-sm join-item"
        type="button"
        aria-label="Go back"
        title="Go back"
        disabled={opening || !surfaceState.canGoBack}
        onclick={() => void runSurfaceAction(activeSession => activeSession.goBack())}
      >
        <ArrowLeft size={16} aria-hidden="true" />
      </button>
      <button
        class="btn btn-square btn-sm join-item"
        type="button"
        aria-label="Go forward"
        title="Go forward"
        disabled={opening || !surfaceState.canGoForward}
        onclick={() => void runSurfaceAction(activeSession => activeSession.goForward())}
      >
        <ArrowRight size={16} aria-hidden="true" />
      </button>
      <button
        class="btn btn-square btn-sm join-item"
        type="button"
        aria-label={surfaceState.loading ? 'Stop loading' : 'Reload page'}
        title={surfaceState.loading ? 'Stop loading' : 'Reload page'}
        disabled={opening || session === null}
        onclick={() => void runSurfaceAction(activeSession => surfaceState.loading
          ? activeSession.stop()
          : activeSession.reload())}
      >
        {#if surfaceState.loading}
          <X size={16} aria-hidden="true" />
        {:else}
          <RefreshCw size={16} aria-hidden="true" />
        {/if}
      </button>
    </div>

    <label class="sr-only" for="task-browser-address">Web address</label>
    <input
      id="task-browser-address"
      class="input input-bordered input-sm min-w-0 flex-1 font-mono"
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
    <button class="btn btn-primary btn-sm" type="submit" disabled={opening || address.trim().length === 0}>
      Go
    </button>

    <VisualFeedbackEditor
      available={!opening && session !== null}
      editor={feedbackEditor}
      reviewing={reviewingFeedback}
      onReview={() => { reviewingFeedback = !reviewingFeedback }}
      onSend={sendFeedback}
    />
  </form>

  <div class="flex min-h-6 items-center gap-2 border-b border-base-300 px-3 py-1 text-xs" aria-live="polite">
    {#if actionError !== null}
      <span class="text-error">{actionError}</span>
    {:else if opening}
      <span class="text-base-content/60">Opening browser…</span>
    {:else if surfaceState.loading}
      <span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
      <span class="text-base-content/60">Loading {surfaceState.title || surfaceState.url}</span>
    {:else}
      <span class="truncate text-base-content/60">{surfaceState.title || surfaceState.url || 'Ready'}</span>
    {/if}
  </div>

  {#if reviewingFeedback && feedbackEditor.annotations.length > 0}
    <VisualFeedbackReview
      editor={feedbackEditor}
      onClose={() => { reviewingFeedback = false }}
    />
  {/if}

  <div bind:this={browserRegion} class="relative min-h-0 flex-1 overflow-hidden">
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
