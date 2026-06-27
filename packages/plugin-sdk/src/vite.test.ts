import { describe, expect, it } from 'vitest'
import {
  OPENFORGE_HOST_RUNTIME_SVELTE_SPECIFIERS,
  OPENFORGE_HOST_SHARED_SVELTE_IMPORTS,
  OPENFORGE_HOST_SHARED_TERMINAL_RUNTIME_IMPORTS,
  createOpenForgePluginSdkSourceAliases,
  isOpenForgeHostRuntimeExternal,
} from '@openforge/plugin-sdk/vite'

describe('OpenForge plugin Vite author tooling', () => {
  it('creates exact source aliases for public plugin SDK entrypoints', () => {
    const aliases = createOpenForgePluginSdkSourceAliases(new URL('file:///repo/'))

    expect(aliases).toEqual([
      { find: '@openforge/plugin-sdk/frontend', replacement: '/repo/packages/plugin-sdk/src/frontend.ts' },
      { find: '@openforge/plugin-sdk/backend', replacement: '/repo/packages/plugin-sdk/src/backend.ts' },
      { find: '@openforge/plugin-sdk/testing', replacement: '/repo/packages/plugin-sdk/src/testing.ts' },
      { find: '@openforge/plugin-sdk/vite', replacement: '/repo/packages/plugin-sdk/src/vite.ts' },
      { find: '@openforge/plugin-sdk/domain', replacement: '/repo/packages/plugin-sdk/src/domain.ts' },
      { find: '@openforge/plugin-sdk/prStatusPresentation', replacement: '/repo/packages/plugin-sdk/src/prStatusPresentation.ts' },
      { find: '@openforge/plugin-sdk/markdown', replacement: '/repo/packages/plugin-sdk/src/markdown.ts' },
      { find: '@openforge/plugin-sdk/numberParsing', replacement: '/repo/packages/plugin-sdk/src/numberParsing.ts' },
      { find: '@openforge/plugin-sdk/sanitize', replacement: '/repo/packages/plugin-sdk/src/sanitize.ts' },
      { find: '@openforge/plugin-sdk/ui/MarkdownContent.svelte', replacement: '/repo/packages/plugin-sdk/src/ui/MarkdownContent.svelte' },
      { find: '@openforge/plugin-sdk/ui/ResizablePanel.svelte', replacement: '/repo/packages/plugin-sdk/src/ui/ResizablePanel.svelte' },
      { find: '@openforge/plugin-sdk', replacement: '/repo/packages/plugin-sdk/src/index.ts' },
    ])
    expect(aliases.every((alias) => typeof alias.find === 'string')).toBe(true)
    expect(aliases.some((alias) => alias.find === '@openforge/plugin-runtime')).toBe(false)
    expect(aliases.some((alias) => alias.find === '@openforge/pr-review-ui')).toBe(false)
    expect(aliases.some((alias) => alias.find === '@openforge/terminal-runtime')).toBe(false)
    expect(createOpenForgePluginSdkSourceAliases(new URL('file:///repo'))[0]?.replacement).toBe('/repo/packages/plugin-sdk/src/frontend.ts')
    expect(() => createOpenForgePluginSdkSourceAliases(String.raw`C:\repo`)).not.toThrow()
  })

  it('externalizes only the documented host-shared Svelte runtime imports', () => {
    expect(OPENFORGE_HOST_SHARED_SVELTE_IMPORTS).toContain('svelte/internal/client')
    expect(OPENFORGE_HOST_SHARED_SVELTE_IMPORTS).toContain('svelte/internal/disclose-version')

    for (const specifier of OPENFORGE_HOST_SHARED_SVELTE_IMPORTS) {
      expect(isOpenForgeHostRuntimeExternal(specifier), `${specifier} should be host-shared`).toBe(true)
    }

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

  it('externalizes the host-shared terminal runtime contract', () => {
    expect(OPENFORGE_HOST_SHARED_TERMINAL_RUNTIME_IMPORTS).toContain('@openforge/terminal-runtime')
    expect(OPENFORGE_HOST_SHARED_TERMINAL_RUNTIME_IMPORTS).toContain('@openforge/terminal-runtime/shortcuts')

    for (const specifier of OPENFORGE_HOST_SHARED_TERMINAL_RUNTIME_IMPORTS) {
      expect(isOpenForgeHostRuntimeExternal(specifier), `${specifier} should be host-shared`).toBe(true)
    }

    expect(isOpenForgeHostRuntimeExternal('@openforge/terminal-runtime/internal')).toBe(false)
  })

  it('does not externalize non-Svelte dependencies that plugins may bundle normally', () => {
    expect(isOpenForgeHostRuntimeExternal('@openforge/plugin-sdk')).toBe(false)
    expect(isOpenForgeHostRuntimeExternal('@openforge/plugin-sdk/frontend')).toBe(false)
    expect(isOpenForgeHostRuntimeExternal('not-svelte')).toBe(false)
    expect(isOpenForgeHostRuntimeExternal('svelte/compiler')).toBe(false)
    expect(isOpenForgeHostRuntimeExternal('svelte/server')).toBe(false)
    expect(isOpenForgeHostRuntimeExternal('svelte/internal/flags/unknown')).toBe(false)
    expect(isOpenForgeHostRuntimeExternal('svelte/internal/server')).toBe(false)
    expect(isOpenForgeHostRuntimeExternal('svelteish/internal')).toBe(false)
  })
})
