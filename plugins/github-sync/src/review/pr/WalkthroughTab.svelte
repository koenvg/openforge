<script lang="ts">
  import type { FrontendOpenForgeAPI } from '@openforge/plugin-sdk/frontend'
  import type {
    PrFileDiff,
    PrWalkthrough,
    PrWalkthroughStep,
    ReviewPullRequest,
  } from '@openforge/plugin-sdk/domain'
  import { compileWalkthroughPrompt } from '../../lib/walkthroughPrompt'
  import { parseAndValidateWalkthroughSteps } from '../../lib/walkthroughParse'
  import {
    buildSyntheticStepFiles,
    clampStepIndex,
    isWalkthroughStale,
  } from '../../lib/walkthroughViewState'
  import { isInputFocused } from '../../lib/domUtils'
  import FileTree from '@openforge/pr-review-ui/FileTree.svelte'
  import DiffViewer from '@openforge/pr-review-ui/DiffViewer.svelte'
  import type { GithubSyncPrReviewClient } from './githubSyncClient'
  import type { FileContents } from '@openforge/pr-review-ui/diffAdapter'

  interface Props {
    api: FrontendOpenForgeAPI
    githubSync: GithubSyncPrReviewClient
    pr: ReviewPullRequest
    files: PrFileDiff[]
    fetchFileContents: (file: PrFileDiff) => Promise<FileContents>
  }

  let { api: _api, githubSync, pr, files, fetchFileContents }: Props = $props()

  let walkthrough = $state<PrWalkthrough | null>(null)
  let isLoading = $state(false)
  let isStarting = $state(false)
  let loadError = $state<string | null>(null)
  let activeStepIndex = $state(0)
  let activeStepFilename = $state<string | null>(null)
  let diffViewer = $state<DiffViewer>()

  let parsedSteps = $derived<PrWalkthroughStep[] | null>(
    walkthrough?.status === 'ready'
      ? parseAndValidateWalkthroughSteps(walkthrough.steps_json, files)
      : null,
  )

  let stale = $derived(isWalkthroughStale(walkthrough, pr))

  let isGenerating = $derived(walkthrough?.status === 'generating')

  let activeStep = $derived<PrWalkthroughStep | null>(
    parsedSteps && parsedSteps.length > 0
      ? parsedSteps[clampStepIndex(activeStepIndex, parsedSteps.length)]
      : null,
  )

  let stepFiles = $derived<PrFileDiff[]>(
    activeStep ? buildSyntheticStepFiles(files, activeStep) : [],
  )

  $effect(() => {
    if (!stepFiles.length) {
      activeStepFilename = null
      return
    }
    if (!activeStepFilename || !stepFiles.some(f => f.filename === activeStepFilename)) {
      activeStepFilename = stepFiles[0].filename
    }
  })

  let lastLoadedKey = ''
  $effect(() => {
    const key = `${pr.id}:${pr.head_sha}`
    if (key === lastLoadedKey) return
    lastLoadedKey = key
    activeStepIndex = 0
    activeStepFilename = null
    void initWalkthrough()
  })

  // On first open of a PR's walkthrough tab, load any cached result and — when
  // there is none yet — start generation immediately rather than parking on an
  // intermediate "Generate walkthrough" button. Guarded by the once-per-key
  // effect above, so cancelling or a failure does not instantly re-trigger.
  async function initWalkthrough() {
    const existing = await loadCachedWalkthrough()
    if (!existing && files.length > 0 && !isStarting) {
      await handleGenerate()
    }
  }

  // While generation is in flight, poll the cache until the backend flips the
  // row to ready/error. Keyed on the derived boolean so the interval is created
  // once when generation starts and torn down when it finishes (or the tab is
  // destroyed) — not recreated on every poll.
  $effect(() => {
    if (!isGenerating) return
    const interval = setInterval(() => {
      void loadCachedWalkthrough()
    }, 2500)
    return () => clearInterval(interval)
  })

  async function loadCachedWalkthrough() {
    isLoading = true
    loadError = null
    try {
      walkthrough = await githubSync.getPrWalkthrough({ reviewPrId: pr.id, headSha: pr.head_sha })
    } catch (e) {
      console.error('[WalkthroughTab] Failed to load cached walkthrough:', e)
      loadError = 'Failed to load walkthrough.'
    } finally {
      isLoading = false
    }
    return walkthrough
  }

  async function handleGenerate() {
    if (isStarting) return
    isStarting = true
    loadError = null
    try {
      const prompt = compileWalkthroughPrompt({
        title: pr.title,
        body: pr.body,
        files,
      })
      await githubSync.startAgentWalkthrough({
        repoOwner: pr.repo_owner,
        repoName: pr.repo_name,
        prNumber: pr.number,
        headRef: pr.head_ref,
        baseRef: pr.base_ref,
        prTitle: pr.title,
        prBody: pr.body,
        headSha: pr.head_sha,
        reviewPrId: pr.id,
        prompt,
      })
      walkthrough = {
        pr_id: pr.id,
        head_sha: pr.head_sha,
        walkthrough_session_key: null,
        status: 'generating',
        steps_json: null,
        error_message: null,
        created_at: Math.floor(Date.now() / 1000),
        updated_at: Math.floor(Date.now() / 1000),
      }
    } catch (e) {
      console.error('[WalkthroughTab] Failed to start agent walkthrough:', e)
      loadError = 'Could not start the AI walkthrough. The agent backend may be unavailable.'
    } finally {
      isStarting = false
    }
  }

  async function handleCancel() {
    const sessionKey = walkthrough?.walkthrough_session_key
    if (!sessionKey) return
    try {
      await githubSync.abortAgentWalkthrough({ walkthroughSessionKey: sessionKey })
    } catch (e) {
      console.error('[WalkthroughTab] Failed to abort walkthrough:', e)
    } finally {
      await loadCachedWalkthrough()
    }
  }

  async function handleRegenerate() {
    try {
      await githubSync.deletePrWalkthrough({
        reviewPrId: pr.id,
        headSha: walkthrough?.head_sha ?? pr.head_sha,
      })
    } catch (e) {
      console.error('[WalkthroughTab] Failed to delete previous walkthrough:', e)
    }
    walkthrough = null
    activeStepIndex = 0
    activeStepFilename = null
    await handleGenerate()
  }

  function goPrev() {
    if (!parsedSteps) return
    activeStepIndex = clampStepIndex(activeStepIndex - 1, parsedSteps.length)
  }

  function goNext() {
    if (!parsedSteps) return
    activeStepIndex = clampStepIndex(activeStepIndex + 1, parsedSteps.length)
  }

  function selectStep(index: number) {
    if (!parsedSteps) return
    activeStepIndex = clampStepIndex(index, parsedSteps.length)
  }

  function handleFileSelect(filename: string) {
    activeStepFilename = filename
    diffViewer?.scrollToFile(filename)
  }

  function handleKeydown(e: KeyboardEvent) {
    if (isInputFocused()) return
    if (!parsedSteps || parsedSteps.length === 0) return
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      goPrev()
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      goNext()
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="flex flex-col h-full min-h-0 overflow-hidden">
  {#if (isLoading || isStarting) && !walkthrough}
    <div class="flex flex-col items-center justify-center flex-1 gap-3 text-base-content/50 text-sm">
      <span class="loading loading-spinner loading-md text-primary"></span>
      <span>Loading walkthrough…</span>
    </div>
  {:else if loadError}
    <div class="flex flex-col items-center justify-center flex-1 gap-3 text-error text-sm text-center p-5">
      <span class="text-5xl">⚠</span>
      <span>{loadError}</span>
      <button class="btn btn-sm btn-ghost" onclick={loadCachedWalkthrough}>Retry</button>
    </div>
  {:else if !walkthrough}
    <div class="flex flex-col items-center justify-center flex-1 gap-4 text-center p-8 max-w-xl mx-auto">
      <h3 class="text-lg font-semibold text-base-content m-0">Walk me through this PR</h3>
      <p class="text-sm text-base-content/60 m-0">
        Have an AI scan the {files.length} changed file{files.length === 1 ? '' : 's'} ({pr.additions + pr.deletions} lines) and break the change into ordered, concept-sized steps — as if the author had landed several small commits.
      </p>
      <button class="btn btn-primary btn-sm" onclick={handleGenerate} disabled={isStarting || files.length === 0}>
        {isStarting ? 'Starting…' : 'Generate walkthrough'}
      </button>
    </div>
  {:else if walkthrough.status === 'generating'}
    <div class="flex flex-col items-center justify-center flex-1 gap-3 text-base-content/60 text-sm">
      <span class="loading loading-spinner loading-md text-primary"></span>
      <span>The agent is reading the diff and assembling steps…</span>
      <div class="flex gap-2">
        <button class="btn btn-ghost btn-xs" onclick={loadCachedWalkthrough}>Refresh</button>
        <button class="btn btn-ghost btn-xs text-error" onclick={handleCancel}>Cancel</button>
      </div>
    </div>
  {:else if walkthrough.status === 'error'}
    <div class="flex flex-col items-center justify-center flex-1 gap-3 text-error text-sm text-center p-5">
      <span class="text-5xl">⚠</span>
      <span>{walkthrough.error_message ?? 'The walkthrough failed.'}</span>
      <button class="btn btn-sm btn-ghost" onclick={handleRegenerate}>Try again</button>
    </div>
  {:else if !parsedSteps || parsedSteps.length === 0}
    <div class="flex flex-col items-center justify-center flex-1 gap-3 text-base-content/60 text-sm text-center p-5">
      <p class="m-0">The walkthrough was generated but couldn't be aligned with the current diff.</p>
      <button class="btn btn-sm btn-ghost" onclick={handleRegenerate}>Regenerate</button>
    </div>
  {:else}
    {#if stale}
      <div class="flex items-center justify-between gap-3 px-4 py-2 bg-warning/10 border-b border-warning/30 text-xs">
        <span class="text-warning-content/80">
          A new commit landed since this walkthrough was generated. Showing the cached version.
        </span>
        <button class="btn btn-xs btn-warning" onclick={handleRegenerate}>Regenerate</button>
      </div>
    {/if}

    <div class="flex flex-col gap-5 px-6 py-5 border-b border-base-300 shrink-0">
      <div class="flex items-start gap-5">
        <div class="flex flex-col items-center leading-none shrink-0 pt-0.5">
          <span class="text-4xl font-bold text-base-content tabular-nums">{clampStepIndex(activeStepIndex, parsedSteps.length) + 1}</span>
          <span class="text-[10px] font-medium uppercase tracking-wider text-base-content/40 mt-2 whitespace-nowrap">of {parsedSteps.length}</span>
        </div>

        <div class="flex flex-col gap-1.5 min-w-0 flex-1">
          <h3 class="text-sm font-semibold text-base-content m-0 leading-snug">{activeStep?.title}</h3>
          {#if activeStep}
            <p class="text-lg leading-relaxed text-base-content/90 m-0">{activeStep.summary}</p>
          {/if}
        </div>

        <div class="flex items-center gap-1 shrink-0">
          <button
            class="btn btn-ghost btn-xs"
            onclick={goPrev}
            disabled={activeStepIndex <= 0}
            title="Previous step (←)"
          >◀ Prev</button>
          <button
            class="btn btn-ghost btn-xs"
            onclick={goNext}
            disabled={activeStepIndex >= parsedSteps.length - 1}
            title="Next step (→)"
          >Next ▶</button>
          {#if !stale}
            <button class="btn btn-ghost btn-xs text-base-content/40" onclick={handleRegenerate} title="Regenerate walkthrough">↻</button>
          {/if}
        </div>
      </div>

      <div class="flex flex-wrap justify-center gap-2">
        {#each parsedSteps as step, i}
          <button
            type="button"
            class="btn btn-sm btn-circle {i === clampStepIndex(activeStepIndex, parsedSteps.length) ? 'btn-primary' : 'btn-ghost text-base-content/60'}"
            onclick={() => selectStep(i)}
            title={step.title}
          >{i + 1}</button>
        {/each}
      </div>
    </div>

    <div class="flex flex-1 min-h-0 overflow-hidden">
      <div class="w-[260px] shrink-0 border-r border-base-300 overflow-hidden">
        <FileTree files={stepFiles} onSelectFile={handleFileSelect} />
      </div>
      <div class="flex-1 min-w-0 overflow-hidden">
        <DiffViewer
          bind:this={diffViewer}
          files={stepFiles}
          repoOwner={pr.repo_owner}
          repoName={pr.repo_name}
          fileTreeVisible={false}
          {fetchFileContents}
        />
      </div>
    </div>
  {/if}
</div>
