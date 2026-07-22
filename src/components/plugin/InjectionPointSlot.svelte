<script lang="ts">
  import { onDestroy, type Component } from 'svelte'
  import PluginErrorBoundary from './PluginErrorBoundary.svelte'
  import { enabledPluginIds } from '../../lib/plugin/pluginStore'
  import { getPluginRenderProps, listInjectionPointsAcrossPlugins } from '../../lib/plugin/pluginRegistry'
  import { getRegisteredRenderableComponent, resolvePluginComponent } from '../../lib/plugin/componentRegistry'
  import type { InjectionPointLocation } from '@openforge-app/plugin-sdk'

  interface Props {
    location: InjectionPointLocation
    projectId: string | null
    taskId: string | null
    onInsert: (text: string) => void
  }

  let { location, projectId, taskId, onInsert }: Props = $props()

  let renderedComponents = $state(new Map<string, Component<Record<string, unknown>>>())
  let renderErrors = $state(new Map<string, string>())
  let activationRunId = 0

  let contributions = $derived(
    listInjectionPointsAcrossPlugins(location, $enabledPluginIds)
  )

  function namespacedId(pluginId: string, id: string): string {
    return `${pluginId}:${id}`
  }

  function normalizeErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }

  function setRenderError(key: string, error: unknown): void {
    const next = new Map(renderErrors)
    next.set(key, normalizeErrorMessage(error))
    renderErrors = next
  }

  onDestroy(() => {
    activationRunId += 1
  })

  $effect(() => {
    renderedComponents = new Map()
    renderErrors = new Map()

    if (contributions.length === 0) {
      return
    }

    const runId = ++activationRunId
    const snapshot = [...contributions]

    void (async () => {
      const nextRenderedComponents = new Map<string, Component<Record<string, unknown>>>()
      const nextRenderErrors = new Map<string, string>()

      for (const contrib of snapshot) {
        const key = namespacedId(contrib.pluginId, contrib.id)
        const componentSource = getRegisteredRenderableComponent('injectionPoints', key)

        if (runId !== activationRunId) {
          return
        }

        if (componentSource) {
          try {
            nextRenderedComponents.set(key, await resolvePluginComponent(componentSource))
          } catch (error) {
            nextRenderErrors.set(key, normalizeErrorMessage(error))
          }
          continue
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

{#each contributions as contrib (namespacedId(contrib.pluginId, contrib.id))}
  {@const key = namespacedId(contrib.pluginId, contrib.id)}
  {@const Component = renderedComponents.get(key)}
  {@const errorMessage = renderErrors.get(key) ?? null}

  {#if errorMessage}
    <div data-injection-point={location}>
      <PluginErrorBoundary
        pluginId={contrib.pluginId}
        pluginName={contrib.pluginId}
        errorMessage={errorMessage}
      />
    </div>
  {:else if Component}
    <div data-injection-point={location}>
      <svelte:boundary onerror={(error) => setRenderError(key, error)}>
        {#snippet failed(error, _reset)}
          <PluginErrorBoundary
            pluginId={contrib.pluginId}
            pluginName={contrib.pluginId}
            errorMessage={normalizeErrorMessage(error)}
          />
        {/snippet}
        {@const renderProps = getPluginRenderProps(contrib.pluginId, { projectId, taskId })}
        <Component {...renderProps} {location} {projectId} {taskId} {onInsert} />
      </svelte:boundary>
    </div>
  {/if}
{/each}
