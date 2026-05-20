import { describe, expect, it } from 'vitest'
import { OPENFORGE_HOST_RUNTIME_SVELTE_SPECIFIERS, isOpenForgeHostRuntimeExternal } from '@openforge/plugin-sdk/vite'

describe('OpenForge plugin Vite author tooling', () => {
  it('externalizes Svelte runtime imports so plugin components share the host singleton', () => {
    expect(isOpenForgeHostRuntimeExternal('svelte')).toBe(true)
    expect(isOpenForgeHostRuntimeExternal('svelte/internal')).toBe(true)
    expect(isOpenForgeHostRuntimeExternal('svelte/internal/client')).toBe(true)
    expect(isOpenForgeHostRuntimeExternal('svelte/internal/flags/async')).toBe(true)
    expect(isOpenForgeHostRuntimeExternal('svelte/internal/flags/legacy')).toBe(true)
    expect(isOpenForgeHostRuntimeExternal('svelte/internal/flags/tracing')).toBe(true)
    expect(isOpenForgeHostRuntimeExternal('svelte/store')).toBe(true)
    expect(isOpenForgeHostRuntimeExternal('svelte/events')).toBe(true)
  })

  it('only externalizes explicitly listed host-runtime Svelte specifiers', () => {
    for (const specifier of OPENFORGE_HOST_RUNTIME_SVELTE_SPECIFIERS) {
      expect(isOpenForgeHostRuntimeExternal(specifier), specifier).toBe(true)
    }

    expect(isOpenForgeHostRuntimeExternal('svelte/internal/flags/experimental')).toBe(false)
    expect(isOpenForgeHostRuntimeExternal('svelte/internal/client/dom')).toBe(false)
  })

  it('does not externalize non-Svelte dependencies that plugins may bundle normally', () => {
    expect(isOpenForgeHostRuntimeExternal('@openforge/plugin-sdk')).toBe(false)
    expect(isOpenForgeHostRuntimeExternal('@openforge/plugin-sdk/frontend')).toBe(false)
    expect(isOpenForgeHostRuntimeExternal('not-svelte')).toBe(false)
    expect(isOpenForgeHostRuntimeExternal('svelte/compiler')).toBe(false)
    expect(isOpenForgeHostRuntimeExternal('svelte/server')).toBe(false)
    expect(isOpenForgeHostRuntimeExternal('svelte/internal/server')).toBe(false)
    expect(isOpenForgeHostRuntimeExternal('svelteish/internal')).toBe(false)
  })
})
