import { DEFAULT_PR_WALKTHROUGH_PROMPT } from './prWalkthroughPrompt'

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
}

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
    key: 'pr_walkthrough_prompt',
    label: 'PR Walkthrough + AI Review Prompt',
    description: 'Prompt used to generate the PR walkthrough steps and AI review comments. Keep the {{PR_TITLE}}, {{PR_DESCRIPTION}}, {{CHANGED_FILES}}, and {{EXISTING_COMMENTS}} placeholders. They are filled in per PR.',
    control: 'textarea',
    levels: ['global', 'project'],
    default: DEFAULT_PR_WALKTHROUGH_PROMPT,
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
