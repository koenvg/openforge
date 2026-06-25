import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { OPENFORGE_FRONTEND_PLUGIN_MARKER } from '@openforge/plugin-sdk/frontend'
import { isOpenForgePackageMetadata } from '@openforge/plugin-sdk'
import type { FrontendOpenForgeAPI, FrontendPluginContext } from '@openforge/plugin-sdk/frontend'

const { mockSkillsView } = vi.hoisted(() => ({
  mockSkillsView: { name: 'SkillsViewComponent' },
}))

vi.mock('./SkillsView.svelte', () => ({
  default: mockSkillsView,
}))

import packageJson from '../package.json'

const pluginSrcDir = dirname(fileURLToPath(import.meta.url))

function makeRuntimeHarness() {
  const subscriptions = { add: vi.fn() }
  const invokeGlobal = vi.fn()
  const api = {
    views: { register: vi.fn(() => ({ dispose: vi.fn() })) },
    commands: { invokeGlobal },
    events: { emitGlobal: vi.fn() },
    system: { openUrl: vi.fn() },
    context: { getSnapshot: vi.fn(() => ({ pluginId: packageJson.openforge.id, projectId: null })) },
  } as unknown as FrontendOpenForgeAPI
  const context = { pluginId: packageJson.openforge.id, apiVersion: 1, packageMetadata: packageJson.openforge, subscriptions } as FrontendPluginContext
  return { api, context, subscriptions, invokeGlobal }
}

describe('skills-viewer plugin', () => {
  it('does not retain stale host PluginContext state in the skills viewer plugin entry', () => {
    const indexSource = readFileSync(join(pluginSrcDir, 'index.ts'), 'utf8')

    expect(indexSource).not.toContain('./pluginContext')
    expect(indexSource).not.toContain('setPluginContext')
    expect(existsSync(join(pluginSrcDir, 'pluginContext.ts'))).toBe(false)
  })

  it('has valid package.json#openforge metadata without manifest contributions', () => {
    expect(isOpenForgePackageMetadata(packageJson.openforge)).toBe(true)
    expect(packageJson.openforge).not.toHaveProperty('contributes')
    expect(packageJson.openforge.frontend).toBe('./dist/frontend.js')
    expect(packageJson.openforge.backend).toBe('./dist/backend.js')
    expect(packageJson.openforge.requires).toEqual(expect.arrayContaining(['views', 'backend', 'projects', 'navigation', 'system.openUrl', 'context']))
    expect(packageJson.openforge.requires).not.toContain('fs')
  })

  it('registers the Skills view at runtime through defineFrontendPlugin', async () => {
    const { default: plugin, SkillsViewComponent } = await import('./index')
    const { api, context, subscriptions } = makeRuntimeHarness()

    await plugin.activate(api, context)

    expect(plugin[OPENFORGE_FRONTEND_PLUGIN_MARKER]).toBe(true)
    expect(api.views.register).toHaveBeenCalledWith(expect.objectContaining({
      id: 'skills',
      title: 'Skills',
      icon: 'sparkles',
      placement: 'rail',
      order: 30,
      component: SkillsViewComponent,
    }))
    expect(SkillsViewComponent).toBe(mockSkillsView)
    expect(subscriptions.add).toHaveBeenCalledWith(expect.objectContaining({ dispose: expect.any(Function) }))
  })

  it('does not keep plugin-local runtime adapter modules or host command calls in the view', () => {
    const skillsViewSource = readFileSync(join(pluginSrcDir, 'SkillsView.svelte'), 'utf8')

    expect(existsSync(join(pluginSrcDir, 'lib/ipc.ts'))).toBe(false)
    expect(skillsViewSource).not.toContain('./lib/ipc')
    expect(skillsViewSource).not.toContain('openforge.listOpenCodeSkills')
    expect(skillsViewSource).not.toContain('openforge.saveSkillContent')
    expect(skillsViewSource).not.toContain('openforge.navigate')
    expect(skillsViewSource).toContain("api.backend.invoke<SkillInfo[]>('listSkills'")
    expect(skillsViewSource).toContain('api.navigation.navigate')
  })

  it('keeps skill edit content raw while rendering a labelled markdown article from frontmatter-stripped content', () => {
    const skillsViewSource = readFileSync(join(pluginSrcDir, 'SkillsView.svelte'), 'utf8')

    expect(skillsViewSource).toContain('editContent = selectedSkill.template')
    expect(skillsViewSource).toContain('stripSkillFrontmatter')
    expect(skillsViewSource).toContain('<article')
    expect(skillsViewSource).toContain('aria-labelledby={skillMarkdownHeadingId}')
    expect(skillsViewSource).toContain('aria-label="Skill metadata"')
  })

  it('keeps native list button semantics until full ARIA tree keyboarding exists', () => {
    const skillsViewSource = readFileSync(join(pluginSrcDir, 'SkillsView.svelte'), 'utf8')

    expect(skillsViewSource).not.toContain('role="tree"')
    expect(skillsViewSource).not.toContain('role="treeitem"')
    expect(skillsViewSource).not.toContain('aria-selected')
    expect(skillsViewSource).toContain('aria-expanded')
    expect(skillsViewSource).toContain('aria-current')
  })

  it('registers plugin-owned backend methods for skill list and save contracts', async () => {
    const { default: backend } = await import('./backend')
    const subscriptions = { add: vi.fn() }
    const api = { backend: { registerMethod: vi.fn(() => ({ dispose: vi.fn() })) } }

    await backend.activate(api as never, { pluginId: packageJson.openforge.id, apiVersion: 1, packageMetadata: packageJson.openforge, subscriptions })

    expect(api.backend.registerMethod).toHaveBeenCalledWith('listSkills', expect.objectContaining({ handler: expect.any(Function) }))
    expect(api.backend.registerMethod).toHaveBeenCalledWith('saveSkillContent', expect.objectContaining({ handler: expect.any(Function) }))
    expect(subscriptions.add).toHaveBeenCalledTimes(2)
  })
})
