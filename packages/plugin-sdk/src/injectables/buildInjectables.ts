import type { CommandInfo, Injectable, InjectableOrigin, InjectableTriggerMode, Snippet } from '../domain'

const CLAUDE_SKILL_DIRS = new Set(['.claude', '.agents'])
// builtin commands + plugin skills are provided by the tool/plugin and carry no source dir.
const CLAUDE_PROVIDED_ORIGINS = new Set(['builtin', 'plugin'])
const ORIGINS = new Set<InjectableOrigin>(['personal', 'project', 'plugin', 'builtin'])
const TRIGGERS = new Set<InjectableTriggerMode>(['auto+manual', 'manual-only'])

function isClaudeRelevant(c: CommandInfo): boolean {
  // Tool/plugin-provided items are always Claude-relevant (no source dir to gate on).
  if (c.origin != null && CLAUDE_PROVIDED_ORIGINS.has(c.origin)) return true
  // Everything else — skills AND legacy .md commands — must live in a Claude source dir.
  // This drops .pi/.codex/.opencode skills and .opencode/commands, and yields an empty
  // catalog for non-claude-code providers (which don't emit origin/sourceDir enrichment).
  return c.sourceDir != null && CLAUDE_SKILL_DIRS.has(c.sourceDir)
}

function normOrigin(v: string | null | undefined): InjectableOrigin {
  return v != null && ORIGINS.has(v as InjectableOrigin) ? (v as InjectableOrigin) : 'project'
}

function normTrigger(v: string | null | undefined): InjectableTriggerMode {
  return v != null && TRIGGERS.has(v as InjectableTriggerMode) ? (v as InjectableTriggerMode) : 'auto+manual'
}

/**
 * A personal snippet becomes a `kind:'snippet'` Injectable. It has no slash
 * identity or trigger mode, so origin/triggerMode carry unused sentinels
 * (`personal`/`manual-only`) that are never displayed; `sectionOf` routes it to
 * the dedicated "Snippets" section instead. Its `body` is both the preview
 * content and the literal text inserted on select.
 */
function snippetToInjectable(s: Snippet): Injectable {
  return {
    id: `snippet:${s.id}`,
    kind: 'snippet',
    name: s.name,
    description: null,
    origin: 'personal',
    triggerMode: 'manual-only',
    sourceDir: null,
    sourcePath: null,
    content: s.body,
    invocationText: s.body,
  }
}

/**
 * Map the provider command list (plus the user's personal snippets) into the
 * picker's Claude-scoped Injectable view model. Drops non-Claude ecosystem
 * skills (.pi/.codex/.opencode) and hidden background skills.
 */
/** A snippet is visible in the active project when it targets all projects, or when
 * its explicit scope includes that project. With no active project only all-projects
 * snippets show. */
function snippetVisibleIn(s: Snippet, projectId: string | null): boolean {
  return s.allProjects || (projectId !== null && s.projectIds.includes(projectId))
}

export function buildInjectables(input: {
  commands: CommandInfo[]
  snippets?: Snippet[]
  projectId?: string | null
}): Injectable[] {
  const projectId = input.projectId ?? null
  const commands = input.commands
    .filter((c) => isClaudeRelevant(c) && c.userInvocable !== false)
    .map((c) => {
      const kind = c.source === 'skill' ? 'skill' : 'command'
      const origin = normOrigin(c.origin)
      return {
        id: `${origin}:${kind}:${c.name}`,
        kind,
        name: c.name,
        description: c.description,
        origin,
        triggerMode: normTrigger(c.triggerMode),
        sourceDir: c.sourceDir ?? null,
        sourcePath: c.sourcePath ?? null,
        content: c.content ?? null,
        invocationText: `/${c.name} `,
      } satisfies Injectable
    })
  const snippets = (input.snippets ?? [])
    .filter((s) => snippetVisibleIn(s, projectId))
    .map(snippetToInjectable)
  return [...snippets, ...commands]
}
