import { describe, it, expect } from 'vitest'
import { buildInjectables } from './buildInjectables'
import type { CommandInfo } from '../domain'

const cmd = (over: Partial<CommandInfo>): CommandInfo => ({
  name: 'x',
  description: null,
  source: 'skill',
  agent: null,
  origin: 'project',
  triggerMode: 'auto+manual',
  userInvocable: null,
  sourceDir: '.claude',
  sourcePath: 'x',
  ...over,
})

describe('buildInjectables', () => {
  it('drops non-Claude skills (pi/codex/opencode source dirs)', () => {
    const out = buildInjectables({
      commands: [cmd({ name: 'keep', sourceDir: '.claude' }), cmd({ name: 'drop', sourceDir: '.pi' })],
    })
    expect(out.map((i) => i.name)).toEqual(['keep'])
  })

  it('keeps .agents skills and plugin/builtin commands', () => {
    const out = buildInjectables({
      commands: [
        cmd({ name: 'agentskill', sourceDir: '.agents' }),
        cmd({ name: 'pluginc', source: 'plugin', origin: 'plugin', sourceDir: null }),
        cmd({ name: 'builtinc', source: 'builtin', origin: 'builtin', sourceDir: null }),
      ],
    })
    expect(out.map((i) => i.name).sort()).toEqual(['agentskill', 'builtinc', 'pluginc'])
  })

  it('keeps .claude/commands but drops .opencode/commands (legacy command path)', () => {
    const out = buildInjectables({
      commands: [
        cmd({ name: 'keepcmd', source: 'command', origin: 'project', sourceDir: '.claude' }),
        cmd({ name: 'dropcmd', source: 'command', origin: 'project', sourceDir: '.opencode' }),
      ],
    })
    expect(out.map((i) => i.name)).toEqual(['keepcmd'])
  })

  it('drops everything for a non-claude provider (no enrichment)', () => {
    // opencode/pi/codex return items without origin/sourceDir enrichment
    const out = buildInjectables({
      commands: [
        { name: 'oc', description: null, source: 'command', agent: null } as unknown as CommandInfo,
        { name: 'sk', description: null, source: 'skill', agent: null } as unknown as CommandInfo,
      ],
    })
    expect(out).toHaveLength(0)
  })

  it('drops user-invocable:false items', () => {
    const out = buildInjectables({ commands: [cmd({ name: 'bg', userInvocable: false })] })
    expect(out).toHaveLength(0)
  })

  it('maps kind, id and invocationText for a skill', () => {
    const [i] = buildInjectables({ commands: [cmd({ name: 'refactor', source: 'skill', origin: 'project' })] })
    expect(i).toMatchObject({
      id: 'project:skill:refactor',
      kind: 'skill',
      invocationText: '/refactor ',
    })
  })

  it('carries the source dir and folder identity for edit/delete; null when absent', () => {
    const [skill] = buildInjectables({
      commands: [cmd({ name: 's', sourceDir: '.claude', sourcePath: 's' })],
    })
    expect(skill).toMatchObject({ sourceDir: '.claude', sourcePath: 's' })
    const [builtin] = buildInjectables({
      commands: [cmd({ name: 'init', source: 'builtin', origin: 'builtin', sourceDir: null })],
    })
    expect(builtin.sourceDir).toBeNull()
  })

  it('carries source content for the reading pane; null when absent', () => {
    const [skill] = buildInjectables({ commands: [cmd({ name: 's', content: '---\nname: s\n---\nbody' })] })
    expect(skill.content).toContain('body')
    const [builtin] = buildInjectables({
      commands: [cmd({ name: 'init', source: 'builtin', origin: 'builtin', sourceDir: null, content: undefined })],
    })
    expect(builtin.content).toBeNull()
  })

  it('maps a command to kind "command"', () => {
    const [i] = buildInjectables({
      commands: [cmd({ name: 'init', source: 'builtin', origin: 'builtin', sourceDir: null })],
    })
    expect(i).toMatchObject({ id: 'builtin:command:init', kind: 'command' })
  })

  it('normalizes unknown origin/trigger to safe defaults', () => {
    const [i] = buildInjectables({
      commands: [cmd({ name: 'weird', origin: 'wat' as unknown as string, triggerMode: 'huh' as unknown as string })],
    })
    expect(i.origin).toBe('project')
    expect(i.triggerMode).toBe('auto+manual')
  })

  it('maps snippets into snippet injectables (id, content and invocationText = body)', () => {
    const out = buildInjectables({
      commands: [],
      snippets: [{ id: 'abc-123', name: 'PR boilerplate', body: '## Summary\n\n- ', allProjects: true, projectIds: [] }],
    })
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      id: 'snippet:abc-123',
      kind: 'snippet',
      name: 'PR boilerplate',
      origin: 'personal',
      content: '## Summary\n\n- ',
      invocationText: '## Summary\n\n- ',
      sourceDir: null,
      sourcePath: null,
    })
  })

  it('includes both snippets and commands; omitting snippets yields none', () => {
    const both = buildInjectables({
      commands: [cmd({ name: 'skill1' })],
      snippets: [{ id: 's1', name: 'snip', body: 'text', allProjects: true, projectIds: [] }],
    })
    expect(both.map((i) => i.kind).sort()).toEqual(['skill', 'snippet'])
    const commandsOnly = buildInjectables({ commands: [cmd({ name: 'skill1' })] })
    expect(commandsOnly.some((i) => i.kind === 'snippet')).toBe(false)
  })

  it('shows all-projects snippets in any (or no) active project', () => {
    const snippets = [{ id: 'a', name: 'everywhere', body: 'x', allProjects: true, projectIds: [] }]
    expect(buildInjectables({ commands: [], snippets, projectId: 'P-9' }).map((i) => i.name)).toEqual(['everywhere'])
    expect(buildInjectables({ commands: [], snippets, projectId: null }).map((i) => i.name)).toEqual(['everywhere'])
  })

  it('shows a project-scoped snippet only for the projects it targets', () => {
    const snippets = [{ id: 'b', name: 'scoped', body: 'x', allProjects: false, projectIds: ['P-1'] }]
    expect(buildInjectables({ commands: [], snippets, projectId: 'P-1' }).map((i) => i.name)).toEqual(['scoped'])
    expect(buildInjectables({ commands: [], snippets, projectId: 'P-2' }).map((i) => i.name)).toEqual([])
    expect(buildInjectables({ commands: [], snippets, projectId: null }).map((i) => i.name)).toEqual([])
  })
})
