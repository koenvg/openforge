import { DEFAULT_PR_REVIEW_GUIDANCE, DEFAULT_PR_WALKTHROUGH_GUIDANCE } from './prGuidanceDefaults'

export type SettingLevel = 'global' | 'project' | 'task'
export type SettingControl = 'toggle' | 'select' | 'text' | 'number' | 'textarea' | 'plugins'

export interface HierarchicalSettingDef {
  key: string
  label: string
  description: string
  control: SettingControl
  levels: SettingLevel[]
  default: string
  options?: { value: string; label: string }[]
  /**
   * Rendered above the field as a warning. For stating what a value can and
   * cannot do — a limit the user would otherwise only discover by hitting it.
   */
  notice?: string
}

/**
 * Both PR guidance fields carry this. Generation runs the Claude Code CLI, so it
 * is the only provider that works at all (every other one is rejected in
 * `agent_generate.rs`), and skills resolve from the machine running OpenForge:
 * `~/.claude/skills` plus the reviewed repo's own `.claude/skills`. Skills that
 * arrive through an installed plugin or marketplace are not included.
 */
export const PR_GUIDANCE_KEYS = ['pr_review_guidance', 'pr_walkthrough_guidance']

/** Card heading and blurb for the PR guidance settings, shared by both scopes. */
export const PR_GUIDANCE_SECTION = {
  id: 'pr-review-prompt',
  title: 'PR review prompt',
  subtitle:
    'These two blocks are inserted into the prompt sent when you run Generate Walkthrough + AI Review on a pull request. The rest of that prompt carries the diff and the output format, and is not editable.',
}

const PR_GUIDANCE_NOTICE =
  'Requires the Claude Code provider. You can reference any skill in your own ~/.claude/skills folder, ' +
  'or one committed to the reviewed repository under .claude/skills — for example "Follow the ' +
  '/strict-code-review skill". Skills installed through a plugin or marketplace are not available here. ' +
  'Newly added skills need an OpenForge restart.'

export const HIERARCHICAL_SETTINGS: HierarchicalSettingDef[] = [
  {
    key: 'task_display_title_metadata_updates_enabled',
    label: 'Task Display Title Updates',
    description: 'Generate task display titles from agent activity metadata',
    control: 'toggle',
    levels: ['global', 'project', 'task'],
    default: 'false',
  },
  {
    key: 'ai_provider',
    label: 'AI Provider',
    description: 'Coding agent used to run tasks',
    control: 'select',
    levels: ['global', 'project', 'task'],
    default: 'claude-code',
    options: [
      { value: 'claude-code', label: 'Claude Code' },
      { value: 'opencode', label: 'OpenCode' },
      { value: 'pi', label: 'Pi Coding Agent' },
      { value: 'codex', label: 'Codex' },
      { value: 'grok', label: 'Grok' },
    ],
  },
  {
    key: 'use_worktrees',
    label: 'Default new tasks to worktrees',
    description: 'New tasks default to isolated worktrees',
    control: 'toggle',
    levels: ['global', 'project', 'task'],
    default: 'true',
  },
  {
    key: 'plugins',
    label: 'Plugins',
    description: 'Which plugins are enabled',
    control: 'plugins',
    levels: ['global', 'project'],
    default: '',
  },
  {
    key: 'task_id_prefix',
    label: 'Task ID Prefix',
    description: 'Prefix for new task IDs (e.g. WEB-1)',
    control: 'text',
    levels: ['global', 'project'],
    default: '',
  },
  {
    key: 'github_poll_interval',
    label: 'GitHub Poll Interval',
    description: 'How often to check GitHub for updates (seconds)',
    control: 'number',
    levels: ['global', 'project'],
    default: '60',
  },
  {
    key: 'pr_review_guidance',
    label: 'AI Review Instructions',
    description: 'What the AI reviewer should look for and how picky to be. Name one of your own skills to reuse it, e.g. "Follow the /strict-code-review skill". Point at skills that describe what to look for, not what format to answer in. Leave empty for no extra guidance.',
    control: 'textarea',
    levels: ['global', 'project'],
    default: DEFAULT_PR_REVIEW_GUIDANCE,
    notice: PR_GUIDANCE_NOTICE,
  },
  {
    key: 'pr_walkthrough_guidance',
    label: 'Walkthrough Guidelines',
    description: 'How to split the PR into steps: how many, how granular, what order. Name one of your own skills to reuse it. Leave empty for no extra guidance.',
    control: 'textarea',
    levels: ['global', 'project'],
    default: DEFAULT_PR_WALKTHROUGH_GUIDANCE,
    notice: PR_GUIDANCE_NOTICE,
  },
]

/** Effective project value per key: project override if present, else global, else default. */
export function computeEffectiveProjectSettings(
  global: Record<string, string>,
  projectRaw: Record<string, string | null>,
): Record<string, string> {
  const result: Record<string, string> = {}
  for (const def of HIERARCHICAL_SETTINGS) {
    if (def.control === 'plugins') continue
    const projectValue = projectRaw[def.key]
    if (projectValue != null) {
      result[def.key] = projectValue
    } else if (global[def.key] != null) {
      result[def.key] = global[def.key]
    } else {
      result[def.key] = def.default
    }
  }
  return result
}
