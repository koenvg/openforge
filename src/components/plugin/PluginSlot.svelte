<script lang="ts">
  import { onDestroy, type Component } from 'svelte'
  import { get } from 'svelte/store'
  import PluginErrorBoundary from './PluginErrorBoundary.svelte'
  import { enabledPluginIds, installedPlugins, runtimeContributionSources } from '../../lib/plugin/pluginStore'
  import { resolveContributions, resolveContributionsForSlot } from '../../lib/plugin/contributionResolver'
  import { makePluginViewKey } from '../../lib/plugin/types'
  import { getRegisteredComponent, getRegisteredRenderableComponent, resolvePluginComponent } from '../../lib/plugin/componentRegistry'
  import type { PluginComponentSource } from '../../lib/plugin/componentRegistry'
  import type { PluginSlotType } from '../../lib/plugin/renderableSlotTypes'
  import { activatePlugin, getPluginRenderProps } from '../../lib/plugin/pluginRegistry'

  interface Props {
    slotType: PluginSlotType
    slotId?: string
    taskId?: string
    projectId?: string | null
    projectName?: string
    projectPath?: string
    taskActionPending?: boolean
    /**
     * Resolve contributions from these plugin ids instead of the project-enabled set.
     * The global settings page uses this to render an installed plugin's global
     * settings section, which is not tied to any project's enabled plugins.
     */
    sourcePluginIds?: string[] | null
    /**
     * Render only the contributions whose declared order falls in `[minOrder, maxOrder)`.
     * A host that interleaves its own sections with plugin ones renders the slot once per
     * gap; see TaskInfoPanel, which puts the local changes between two windows.
     */
    minOrder?: number | null
    maxOrder?: number | null
  }

  let { slotType, slotId = '', taskId = '', projectId = null, projectName = '', projectPath = '', taskActionPending = false, sourcePluginIds = null, minOrder = null, maxOrder = null }: Props = $props()

  let renderedComponents = $state(new Map<string, Component<Record<string, unknown>>>())
  let renderErrors = $state(new Map<string, string>())
  let activationRunId = 0
  let lastContributionSignature: string | null = null

  let slotLayout = $derived(slotType === 'views' || slotType === 'taskPaneTabs' ? 'fill' : null)
  let slotHostClass = $derived(slotLayout === 'fill' ? 'flex flex-col flex-1 min-h-0 overflow-hidden' : '')

  let contributionSourceIds = $derived(sourcePluginIds ?? Array.from($enabledPluginIds))
  let resolvedContributionSources = $derived(
    contributionSourceIds
      .map(id => $runtimeContributionSources.get(id))
      .filter((source) => source !== undefined)
  )

  let allContributions = $derived(resolveContributions(resolvedContributionSources))
  let resolvedSlotContributions = $derived.by(() => slotId
    ? resolveContributionsForSlot(allContributions, slotType, slotId)
    : allContributions[slotType]
  )
  let slotContributions = $derived(
    minOrder === null && maxOrder === null
      ? resolvedSlotContributions
      : resolvedSlotContributions.filter((contrib) => {
        // Views rank by railOrder and have nothing to window on, so they pass through.
        if (!('order' in contrib)) return true
        return (minOrder === null || contrib.order >= minOrder) && (maxOrder === null || contrib.order < maxOrder)
      })
  )

  function getContributionComponent(contrib: (typeof slotContributions)[number]): PluginComponentSource<Record<string, unknown>> | undefined {
    if (slotType === 'views') {
      return getRegisteredComponent(makePluginViewKey(contrib.pluginId, contrib.contributionId))
    }

    if (slotType === 'taskPaneTabs' || slotType === 'taskUISections' || slotType === 'settingsSections') {
      return getRegisteredRenderableComponent(slotType, contrib.namespacedId)
    }

    return undefined
  }

  function normalizeErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }

  function contributionName(contrib: (typeof slotContributions)[number]): string {
    return 'title' in contrib && typeof contrib.title === 'string' ? contrib.title : contrib.pluginId
  }

  function setRenderError(viewKey: string, error: unknown): void {
    const next = new Map(renderErrors)
    next.set(viewKey, normalizeErrorMessage(error))
    renderErrors = next
  }

  onDestroy(() => {
    activationRunId += 1
  })

  function contributionSetSignature(contributions: readonly (typeof slotContributions)[number][]): string {
    // Include whether each contribution currently resolves to a registered component so a
    // recovery (component registered after a failed activation) still rebuilds, while a
    // re-activation that re-registers the same components keeps the same signature.
    return contributions.map((contrib) => `${contrib.namespacedId}:${getContributionComponent(contrib) ? '1' : '0'}`).join('|')
  }

  $effect(() => {
    const contributions = [...slotContributions]
    const signature = contributionSetSignature(contributions)

    // Rebuild only when the contribution set actually changes. A plugin re-activating
    // re-emits an equivalent runtimeContributionSources map (same namespacedIds); wiping
    // renderedComponents on every store tick would unmount + remount the mounted section,
    // which is the visible flash on the Settings page.
    if (signature === lastContributionSignature) {
      return
    }
    lastContributionSignature = signature

    renderedComponents = new Map()
    renderErrors = new Map()

    if (contributions.length === 0) {
      return
    }

    const runId = ++activationRunId

    void (async () => {
      const nextRenderedComponents = new Map<string, Component<Record<string, unknown>>>()
      const nextRenderErrors = new Map<string, string>()

      for (const contrib of contributions) {
        const viewKey = makePluginViewKey(contrib.pluginId, contrib.contributionId)

        let componentSource = getContributionComponent(contrib)
        if (!componentSource) {
          await activatePlugin(contrib.pluginId)
          componentSource = getContributionComponent(contrib)
        }

        if (runId !== activationRunId) {
          return
        }

        if (componentSource) {
          try {
            nextRenderedComponents.set(viewKey, await resolvePluginComponent(componentSource))
          } catch (error) {
            nextRenderErrors.set(viewKey, normalizeErrorMessage(error))
          }
          continue
        }

        const pluginError = get(installedPlugins).get(contrib.pluginId)?.error
        if (pluginError) {
          nextRenderErrors.set(viewKey, pluginError)
        }
      }

      if (runId !== activationRunId) {
        return
      }

      renderedComponents = nextRenderedComponents
      renderErrors = nextRenderErrors
    })()

  })
</script>

{#snippet renderContribution(contrib: (typeof slotContributions)[number])}
  {@const viewKey = makePluginViewKey(contrib.pluginId, contrib.contributionId)}
  {@const Component = renderedComponents.get(viewKey)}
  {@const errorMessage = renderErrors.get(viewKey) ?? $installedPlugins.get(contrib.pluginId)?.error ?? null}

  {#if errorMessage}
    <PluginErrorBoundary
      pluginId={contrib.pluginId}
      pluginName={contributionName(contrib)}
      errorMessage={errorMessage}
    />
  {:else if Component}
    <svelte:boundary onerror={(error) => setRenderError(viewKey, error)}>
      {#snippet failed(error, _reset)}
        <PluginErrorBoundary
          pluginId={contrib.pluginId}
          pluginName={contributionName(contrib)}
          errorMessage={normalizeErrorMessage(error)}
        />
      {/snippet}
      {@const renderProps = getPluginRenderProps(contrib.pluginId, { projectId, taskId })}
      <Component {...renderProps} {taskId} {projectId} {projectName} {projectPath} {taskActionPending} />
    </svelte:boundary>
  {:else if slotType !== 'taskUISections'}
    <div data-contribution-id={contrib.contributionId}></div>
  {/if}
{/snippet}

{#if slotType === 'taskUISections'}
  {#each slotContributions as contrib (contrib.namespacedId)}
    {@render renderContribution(contrib)}
  {/each}
{:else}
  <div data-slot-type={slotType} data-slot-id={slotId} data-slot-layout={slotLayout} class={slotHostClass}>
    {#each slotContributions as contrib (contrib.namespacedId)}
      {@render renderContribution(contrib)}
    {/each}
  </div>
{/if}
