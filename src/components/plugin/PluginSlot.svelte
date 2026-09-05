<script lang="ts">
  import { onDestroy, untrack, type Component } from 'svelte'
  import { get } from 'svelte/store'
  import PluginErrorBoundary from './PluginErrorBoundary.svelte'
  import { enabledPluginIds, installedPlugins, runtimeContributionSources } from '../../lib/plugin/pluginStore'
  import { resolveContributions, resolveContributionsForSlot } from '../../lib/plugin/contributionResolver'
  import { makePluginViewKey } from '../../lib/plugin/types'
  import { getRegisteredComponent, getRegisteredRenderableComponent, resolvePluginComponent } from '../../lib/plugin/componentRegistry'
  import type { PluginComponentSource } from '../../lib/plugin/componentRegistry'
  import type { PluginSlotType } from '../../lib/plugin/renderableSlotTypes'
  import type { TaskDetail } from '../../lib/types'
  import { activatePlugin, getPluginRenderProps } from '../../lib/plugin/pluginRegistry'

  interface Props {
    slotType: PluginSlotType
    slotId?: string
    taskId?: string
    task?: TaskDetail | null
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
    /**
     * Extra props handed to every contribution in this slot, for slots whose subject is not
     * a task or a project. The review-row slot passes the pull request its row is showing.
     * Host-owned props (taskId, projectId, ...) always win, so a plugin cannot shadow them.
     */
    extraProps?: Record<string, unknown>
  }

  let { slotType, slotId = '', taskId = '', task = null, projectId = null, projectName = '', projectPath = '', taskActionPending = false, sourcePluginIds = null, minOrder = null, maxOrder = null, extraProps = undefined }: Props = $props()

  const UNWRAPPED_SLOT_TYPES = new Set<PluginSlotType>(['taskUISections', 'reviewRowActions'])

  let renderedComponents = $state(new Map<string, Component<Record<string, unknown>>>())
  let renderErrors = $state(new Map<string, string>())
  type ComponentLoad = { source: PluginComponentSource<Record<string, unknown>> | undefined }
  const componentLoads = new Map<string, ComponentLoad>()

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

    if (slotType === 'taskPaneTabs' || slotType === 'taskUISections' || slotType === 'reviewRowActions' || slotType === 'settingsSections') {
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

  onDestroy(() => componentLoads.clear())

  async function loadContribution(contrib: (typeof slotContributions)[number], viewKey: string, load: ComponentLoad): Promise<void> {
    try {
      if (!load.source) {
        await activatePlugin(contrib.pluginId)
        if (componentLoads.get(viewKey) !== load) return
        load.source = getContributionComponent(contrib)
      }
      if (load.source) {
        const component = await resolvePluginComponent(load.source)
        if (componentLoads.get(viewKey) !== load) return
        renderedComponents = new Map(renderedComponents).set(viewKey, component)
      } else {
        const error = get(installedPlugins).get(contrib.pluginId)?.error
        if (error) setRenderError(viewKey, error)
      }
    } catch (error) {
      if (componentLoads.get(viewKey) === load) setRenderError(viewKey, error)
    }
  }

  $effect(() => {
    const contributions = slotContributions.map(contrib => ({
      contrib,
      viewKey: makePluginViewKey(contrib.pluginId, contrib.contributionId),
      source: getContributionComponent(contrib),
    }))
    untrack(() => {
      const keys = new Set(contributions.map(({ viewKey }) => viewKey))
      const nextComponents = new Map(renderedComponents)
      const nextErrors = new Map(renderErrors)
      for (const key of componentLoads.keys()) {
        if (!keys.has(key)) {
          componentLoads.delete(key)
          nextComponents.delete(key)
          nextErrors.delete(key)
        }
      }
      const pending: Array<() => void> = []
      for (const { contrib, viewKey, source } of contributions) {
        const previous = componentLoads.get(viewKey)
        if (previous && previous.source === source) continue
        const load = { source }
        componentLoads.set(viewKey, load)
        nextComponents.delete(viewKey)
        nextErrors.delete(viewKey)
        pending.push(() => { void loadContribution(contrib, viewKey, load) })
      }
      renderedComponents = nextComponents
      renderErrors = nextErrors
      for (const start of pending) start()
    })
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
      <Component {...renderProps} {...extraProps ?? {}} {taskId} {task} {projectId} {projectName} {projectPath} {taskActionPending} />
    </svelte:boundary>
  {:else if !UNWRAPPED_SLOT_TYPES.has(slotType)}
    <div data-contribution-id={contrib.contributionId}></div>
  {/if}
{/snippet}

<!-- These slots render bare, with no wrapper element and no placeholder: their hosts are a
     section stack and a table-tight row, where an empty div of our own would show up as a
     stray gap whenever no plugin contributes. -->
{#if UNWRAPPED_SLOT_TYPES.has(slotType)}
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
