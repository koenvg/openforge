import type { Component, ComponentType, SvelteComponent } from 'svelte'
import { FolderOpen, GitPullRequest, LayoutDashboard, Settings, Sparkles } from 'lucide-svelte'
import type { IconProps } from 'lucide-svelte'
import SettingsView from '../components/settings/SettingsView.svelte'
import PrReviewView from '../components/review/pr/PrReviewView.svelte'
import SkillsView from '../components/SkillsView.svelte'
import WorkQueueView from '../components/work-queue/WorkQueueView.svelte'
import FilesView from '../components/FilesView.svelte'
import type { AppView } from './types'

export type RunActionHandler = (data: { taskId: string; actionPrompt: string; agent: string | null }) => void | Promise<void>

export interface ViewContext {
  projectName: string
  onCloseSettings: () => void
  onProjectDeleted: () => void
  onRunAction: RunActionHandler
}

export interface ViewEntry {
  component: Component<Record<string, unknown>>
  getProps: (context: ViewContext) => Record<string, unknown>
}

type LucideIcon = ComponentType<SvelteComponent<IconProps>>
type ShortcutNavigableView = 'board' | 'files' | 'pr_review' | 'skills' | 'settings' | 'workqueue'

interface NavigationItem {
  view: ShortcutNavigableView
  label: string
  shortcutKey: string
  shortcutBindings: readonly string[]
  shortcutHint: string
  showInIconRail: boolean
  Icon?: LucideIcon
}

export interface IconRailNavItem {
  view: ShortcutNavigableView
  label: string
  shortcutHint: string
  Icon: LucideIcon
}

export interface NavigationShortcutItem {
  view: ShortcutNavigableView
  shortcutKey: string
  shortcutBindings: readonly string[]
}

const NAVIGATION_ITEMS: readonly NavigationItem[] = [
  {
    view: 'board',
    label: 'Board',
    shortcutKey: 'h',
    shortcutBindings: ['⌘h'],
    shortcutHint: 'H',
    showInIconRail: true,
    Icon: LayoutDashboard,
  },
  {
    view: 'files',
    label: 'Files',
    shortcutKey: 'o',
    shortcutBindings: ['⌘o'],
    shortcutHint: 'O',
    showInIconRail: true,
    Icon: FolderOpen,
  },
  {
    view: 'pr_review',
    label: 'Pull Requests',
    shortcutKey: 'g',
    shortcutBindings: ['⌘g'],
    shortcutHint: 'G',
    showInIconRail: true,
    Icon: GitPullRequest,
  },
  {
    view: 'skills',
    label: 'Skills',
    shortcutKey: 'l',
    shortcutBindings: ['⌘l'],
    shortcutHint: 'L',
    showInIconRail: true,
    Icon: Sparkles,
  },
  {
    view: 'settings',
    label: 'Settings',
    shortcutKey: ',',
    shortcutBindings: ['⌘,'],
    shortcutHint: ',',
    showInIconRail: true,
    Icon: Settings,
  },
  {
    view: 'workqueue',
    label: 'Work Queue',
    shortcutKey: 'r',
    shortcutBindings: ['⌘r', '⌃r'],
    shortcutHint: 'R',
    showInIconRail: false,
  },
]

function hasIconRailMetadata(item: NavigationItem): item is NavigationItem & { Icon: LucideIcon } {
  return item.showInIconRail && item.Icon !== undefined
}

export const ICON_RAIL_NAV_ITEMS: readonly IconRailNavItem[] = NAVIGATION_ITEMS
  .filter(hasIconRailMetadata)
  .map(({ view, label, shortcutHint, Icon }) => ({ view, label, shortcutHint, Icon }))

export const NAVIGATION_SHORTCUT_ITEMS: readonly NavigationShortcutItem[] = NAVIGATION_ITEMS
  .map(({ view, shortcutKey, shortcutBindings }) => ({ view, shortcutKey, shortcutBindings }))

export const TASK_CLEARING_VIEWS: ReadonlySet<AppView> = new Set([
  'pr_review',
  'settings',
  'workqueue',
  'global_settings',
  'files',
])

export const ICON_RAIL_HIDDEN_VIEWS: ReadonlySet<AppView> = new Set([
  'workqueue',
  'global_settings',
])

export const VIEWS: Record<Exclude<AppView, 'board'>, ViewEntry> = {
  settings: {
    component: SettingsView,
    getProps: ({ onCloseSettings, onProjectDeleted }) => ({
      mode: 'project',
      onClose: onCloseSettings,
      onProjectDeleted,
    }),
  },
  global_settings: {
    component: SettingsView,
    getProps: ({ onCloseSettings, onProjectDeleted }) => ({
      mode: 'global',
      onClose: onCloseSettings,
      onProjectDeleted,
    }),
  },
  pr_review: {
    component: PrReviewView,
    getProps: ({ projectName }) => ({ projectName }),
  },
  skills: {
    component: SkillsView,
    getProps: ({ projectName }) => ({ projectName }),
  },
  workqueue: {
    component: WorkQueueView,
    getProps: ({ onRunAction }) => ({ onRunAction }),
  },
  files: {
    component: FilesView,
    getProps: ({ projectName }) => ({ projectName }),
  },
}
