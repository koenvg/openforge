import { Boxes, ChartColumnBig, Clock, Code, FileText, FolderOpen, GitPullRequest, Kanban, LayoutDashboard, Plug, Puzzle, Settings, Sparkles, Terminal, Wrench } from '@lucide/svelte'
import { sanitizePluginIcon } from '@openforge-app/plugin-sdk/pluginIcons'
import type { PluginIcon } from '@openforge-app/plugin-sdk'

type IconComponent = typeof LayoutDashboard

export type ResolvedPluginNavigationIcon =
  | { type: 'component'; component: IconComponent }
  | { type: 'svg'; svg: string }

const iconRegistry: Record<string, IconComponent> = {
  'layout-dashboard': LayoutDashboard,
  'folder-open': FolderOpen,
  'git-pull-request': GitPullRequest,
  sparkles: Sparkles,
  settings: Settings,
  terminal: Terminal,
  code: Code,
  'file-text': FileText,
  plug: Plug,
  puzzle: Puzzle,
  boxes: Boxes,
  wrench: Wrench,
  clock: Clock,
  'chart-column-big': ChartColumnBig,
  kanban: Kanban,
}

export function resolveIconRailIcon(icon: string): IconComponent {
  return iconRegistry[icon] ?? Plug
}

export function resolvePluginNavigationIcon(icon: PluginIcon): ResolvedPluginNavigationIcon {
  try {
    const sanitizedIcon = sanitizePluginIcon(icon)
    if (typeof sanitizedIcon === 'string') {
      return { type: 'component', component: resolveIconRailIcon(sanitizedIcon) }
    }
    return { type: 'svg', svg: sanitizedIcon.svg }
  } catch {
    return { type: 'component', component: Plug }
  }
}
