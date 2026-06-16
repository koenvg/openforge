import { Boxes, Clock, Code, FileText, FolderOpen, GitPullRequest, LayoutDashboard, Plug, Puzzle, Settings, Sparkles, Terminal, Wrench } from '@lucide/svelte'

type IconComponent = typeof LayoutDashboard

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
}

export function resolveIconRailIcon(icon: string): IconComponent {
  return iconRegistry[icon] ?? Plug
}
