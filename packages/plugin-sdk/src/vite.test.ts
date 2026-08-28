import { describe, expect, it } from 'vitest'
import {
  OPENFORGE_HOST_RUNTIME_SVELTE_SPECIFIERS,
  OPENFORGE_HOST_SHARED_SVELTE_IMPORTS,
  OPENFORGE_HOST_SHARED_TERMINAL_RUNTIME_IMPORTS,
  createOpenForgePluginSdkSourceAliases,
  createOpenForgePluginSdkSourceAliasRecord,
  isOpenForgeHostRuntimeExternal,
} from '@openforge-app/plugin-sdk/vite'

describe('OpenForge plugin Vite author tooling', () => {
  it('creates exact source aliases for public plugin SDK entrypoints', () => {
    const aliases = createOpenForgePluginSdkSourceAliases(new URL('file:///repo/'))

    expect(aliases).toEqual([
      { find: '@openforge-app/plugin-sdk/frontend', replacement: '/repo/packages/plugin-sdk/src/frontend.ts' },
      { find: '@openforge-app/plugin-sdk/backend', replacement: '/repo/packages/plugin-sdk/src/backend.ts' },
      { find: '@openforge-app/plugin-sdk/testing', replacement: '/repo/packages/plugin-sdk/src/testing.ts' },
      { find: '@openforge-app/plugin-sdk/vite', replacement: '/repo/packages/plugin-sdk/src/vite.ts' },
      { find: '@openforge-app/plugin-sdk/package-metadata-schema.json', replacement: '/repo/packages/plugin-sdk/src/openforgePackageMetadataSchema.json' },
      { find: '@openforge-app/plugin-sdk/domain', replacement: '/repo/packages/plugin-sdk/src/domain.ts' },
      { find: '@openforge-app/plugin-sdk/prStatusPresentation', replacement: '/repo/packages/plugin-sdk/src/prStatusPresentation.ts' },
      { find: '@openforge-app/plugin-sdk/markdown', replacement: '/repo/packages/plugin-sdk/src/markdown.ts' },
      { find: '@openforge-app/plugin-sdk/numberParsing', replacement: '/repo/packages/plugin-sdk/src/numberParsing.ts' },
      { find: '@openforge-app/plugin-sdk/projectFileTree', replacement: '/repo/packages/plugin-sdk/src/projectFileTree.ts' },
      { find: '@openforge-app/plugin-sdk/sanitize', replacement: '/repo/packages/plugin-sdk/src/sanitize.ts' },
      { find: '@openforge-app/plugin-sdk/pluginIcons', replacement: '/repo/packages/plugin-sdk/src/pluginIcons.ts' },
      { find: '@openforge-app/plugin-sdk/fileIcons', replacement: '/repo/packages/plugin-sdk/src/fileIcons.ts' },
      { find: '@openforge-app/plugin-sdk/collapsibleSectionState', replacement: '/repo/packages/plugin-sdk/src/collapsibleSectionState.ts' },
      { find: '@openforge-app/plugin-sdk/taskBrowserDevToolsShortcuts', replacement: '/repo/packages/plugin-sdk/src/taskBrowserDevToolsShortcuts.ts' },
      { find: '@openforge-app/plugin-sdk/ui/Button.svelte', replacement: '/repo/packages/plugin-sdk/src/ui/Button.svelte' },
      { find: '@openforge-app/plugin-sdk/ui/Checkbox.svelte', replacement: '/repo/packages/plugin-sdk/src/ui/Checkbox.svelte' },
      { find: '@openforge-app/plugin-sdk/ui/MarkdownContent.svelte', replacement: '/repo/packages/plugin-sdk/src/ui/MarkdownContent.svelte' },
      { find: '@openforge-app/plugin-sdk/ui/ResizablePanel.svelte', replacement: '/repo/packages/plugin-sdk/src/ui/ResizablePanel.svelte' },
      { find: '@openforge-app/plugin-sdk/ui/Modal.svelte', replacement: '/repo/packages/plugin-sdk/src/ui/Modal.svelte' },
      { find: '@openforge-app/plugin-sdk/ui/PluginPageHeader.svelte', replacement: '/repo/packages/plugin-sdk/src/ui/PluginPageHeader.svelte' },
      { find: '@openforge-app/plugin-sdk/ui/PluginPageShell.svelte', replacement: '/repo/packages/plugin-sdk/src/ui/PluginPageShell.svelte' },
      { find: '@openforge-app/plugin-sdk/ui/PluginViewState.svelte', replacement: '/repo/packages/plugin-sdk/src/ui/PluginViewState.svelte' },
      { find: '@openforge-app/plugin-sdk/ui/PluginSidebarLink.svelte', replacement: '/repo/packages/plugin-sdk/src/ui/PluginSidebarLink.svelte' },
      { find: '@openforge-app/plugin-sdk/ui/FileTypeIcon.svelte', replacement: '/repo/packages/plugin-sdk/src/ui/FileTypeIcon.svelte' },
      { find: '@openforge-app/plugin-sdk/ui/CollapsibleSection.svelte', replacement: '/repo/packages/plugin-sdk/src/ui/CollapsibleSection.svelte' },
      { find: '@openforge-app/plugin-sdk', replacement: '/repo/packages/plugin-sdk/src/index.ts' },
    ])
    expect(aliases.every((alias) => typeof alias.find === 'string')).toBe(true)
    expect(aliases.some((alias) => alias.find === '@openforge-app/plugin-runtime')).toBe(false)
    expect(aliases.some((alias) => alias.find === '@openforge-app/pr-review-ui')).toBe(false)
    expect(aliases.some((alias) => alias.find === '@openforge-app/terminal-runtime')).toBe(false)
    expect(createOpenForgePluginSdkSourceAliases(new URL('file:///repo'))[0]?.replacement).toBe('/repo/packages/plugin-sdk/src/frontend.ts')
    expect(() => createOpenForgePluginSdkSourceAliases(String.raw`C:\repo`)).not.toThrow()
  })

  it('creates a record-shaped source alias map for Vitest configs', () => {
    expect(createOpenForgePluginSdkSourceAliasRecord(new URL('file:///repo/'))).toEqual({
      '@openforge-app/plugin-sdk/frontend': '/repo/packages/plugin-sdk/src/frontend.ts',
      '@openforge-app/plugin-sdk/backend': '/repo/packages/plugin-sdk/src/backend.ts',
      '@openforge-app/plugin-sdk/testing': '/repo/packages/plugin-sdk/src/testing.ts',
      '@openforge-app/plugin-sdk/vite': '/repo/packages/plugin-sdk/src/vite.ts',
      '@openforge-app/plugin-sdk/package-metadata-schema.json': '/repo/packages/plugin-sdk/src/openforgePackageMetadataSchema.json',
      '@openforge-app/plugin-sdk/domain': '/repo/packages/plugin-sdk/src/domain.ts',
      '@openforge-app/plugin-sdk/prStatusPresentation': '/repo/packages/plugin-sdk/src/prStatusPresentation.ts',
      '@openforge-app/plugin-sdk/markdown': '/repo/packages/plugin-sdk/src/markdown.ts',
      '@openforge-app/plugin-sdk/numberParsing': '/repo/packages/plugin-sdk/src/numberParsing.ts',
      '@openforge-app/plugin-sdk/projectFileTree': '/repo/packages/plugin-sdk/src/projectFileTree.ts',
      '@openforge-app/plugin-sdk/sanitize': '/repo/packages/plugin-sdk/src/sanitize.ts',
      '@openforge-app/plugin-sdk/pluginIcons': '/repo/packages/plugin-sdk/src/pluginIcons.ts',
      '@openforge-app/plugin-sdk/fileIcons': '/repo/packages/plugin-sdk/src/fileIcons.ts',
      '@openforge-app/plugin-sdk/collapsibleSectionState': '/repo/packages/plugin-sdk/src/collapsibleSectionState.ts',
      '@openforge-app/plugin-sdk/taskBrowserDevToolsShortcuts': '/repo/packages/plugin-sdk/src/taskBrowserDevToolsShortcuts.ts',
      '@openforge-app/plugin-sdk/ui/Button.svelte': '/repo/packages/plugin-sdk/src/ui/Button.svelte',
      '@openforge-app/plugin-sdk/ui/Checkbox.svelte': '/repo/packages/plugin-sdk/src/ui/Checkbox.svelte',
      '@openforge-app/plugin-sdk/ui/MarkdownContent.svelte': '/repo/packages/plugin-sdk/src/ui/MarkdownContent.svelte',
      '@openforge-app/plugin-sdk/ui/ResizablePanel.svelte': '/repo/packages/plugin-sdk/src/ui/ResizablePanel.svelte',
      '@openforge-app/plugin-sdk/ui/Modal.svelte': '/repo/packages/plugin-sdk/src/ui/Modal.svelte',
      '@openforge-app/plugin-sdk/ui/PluginPageHeader.svelte': '/repo/packages/plugin-sdk/src/ui/PluginPageHeader.svelte',
      '@openforge-app/plugin-sdk/ui/PluginPageShell.svelte': '/repo/packages/plugin-sdk/src/ui/PluginPageShell.svelte',
      '@openforge-app/plugin-sdk/ui/PluginViewState.svelte': '/repo/packages/plugin-sdk/src/ui/PluginViewState.svelte',
      '@openforge-app/plugin-sdk/ui/PluginSidebarLink.svelte': '/repo/packages/plugin-sdk/src/ui/PluginSidebarLink.svelte',
      '@openforge-app/plugin-sdk/ui/FileTypeIcon.svelte': '/repo/packages/plugin-sdk/src/ui/FileTypeIcon.svelte',
      '@openforge-app/plugin-sdk/ui/CollapsibleSection.svelte': '/repo/packages/plugin-sdk/src/ui/CollapsibleSection.svelte',
      '@openforge-app/plugin-sdk': '/repo/packages/plugin-sdk/src/index.ts',
    })
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
    expect(OPENFORGE_HOST_SHARED_TERMINAL_RUNTIME_IMPORTS).toContain('@openforge-app/terminal-runtime')
    expect(OPENFORGE_HOST_SHARED_TERMINAL_RUNTIME_IMPORTS).toContain('@openforge-app/terminal-runtime/shortcuts')
    expect(OPENFORGE_HOST_SHARED_TERMINAL_RUNTIME_IMPORTS).toContain('@openforge-app/terminal-runtime/TerminalTabsShell')

    for (const specifier of OPENFORGE_HOST_SHARED_TERMINAL_RUNTIME_IMPORTS) {
      expect(isOpenForgeHostRuntimeExternal(specifier), `${specifier} should be host-shared`).toBe(true)
    }

    expect(isOpenForgeHostRuntimeExternal('@openforge-app/terminal-runtime/internal')).toBe(false)
  })

  it('does not externalize non-Svelte dependencies that plugins may bundle normally', () => {
    expect(isOpenForgeHostRuntimeExternal('@openforge-app/plugin-sdk')).toBe(false)
    expect(isOpenForgeHostRuntimeExternal('@openforge-app/plugin-sdk/frontend')).toBe(false)
    expect(isOpenForgeHostRuntimeExternal('not-svelte')).toBe(false)
    expect(isOpenForgeHostRuntimeExternal('svelte/compiler')).toBe(false)
    expect(isOpenForgeHostRuntimeExternal('svelte/server')).toBe(false)
    expect(isOpenForgeHostRuntimeExternal('svelte/internal/flags/unknown')).toBe(false)
    expect(isOpenForgeHostRuntimeExternal('svelte/internal/server')).toBe(false)
    expect(isOpenForgeHostRuntimeExternal('svelteish/internal')).toBe(false)
  })
})
