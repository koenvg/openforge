<script lang="ts">
  import type { Component } from 'svelte'
  import { onDestroy } from 'svelte'
  import {
    mountPluginComponent,
    unmountPluginComponent,
    type MountedPluginComponent,
  } from '../../lib/plugin/pluginLoader'

  interface Props {
    pluginId: string
    component: Component<Record<string, unknown>>
    props?: Record<string, unknown>
  }

  let { pluginId, component, props = {} }: Props = $props()

  let hostElement = $state<HTMLElement | null>(null)
  let mountedComponent: MountedPluginComponent | null = null
  let previousPluginId: string | null = null
  let previousComponent: Component<Record<string, unknown>> | null = null
  let previousPropsSignature: string | null = null
  let mountRunId = 0

  function propsSignature(value: Record<string, unknown>): string {
    return JSON.stringify(value)
  }

  $effect(() => {
    const target = hostElement
    const nextPluginId = pluginId
    const nextComponent = component
    const nextProps = props
    const nextPropsSignature = propsSignature(nextProps)

    if (!target) {
      return
    }

    if (
      previousPluginId === nextPluginId
      && previousComponent === nextComponent
      && previousPropsSignature === nextPropsSignature
    ) {
      return
    }

    previousPluginId = nextPluginId
    previousComponent = nextComponent
    previousPropsSignature = nextPropsSignature

    const runId = ++mountRunId
    const previousMounted = mountedComponent
    mountedComponent = null

    void (async () => {
      await unmountPluginComponent(previousMounted)

      if (runId !== mountRunId) {
        return
      }

      const nextMounted = mountPluginComponent(nextPluginId, nextComponent, target, nextProps)
      if (runId !== mountRunId) {
        await unmountPluginComponent(nextMounted)
        return
      }

      mountedComponent = nextMounted
    })()
  })

  onDestroy(() => {
    mountRunId += 1
    const previousMounted = mountedComponent
    mountedComponent = null
    void unmountPluginComponent(previousMounted)
  })
</script>

<div class="contents" bind:this={hostElement}></div>
