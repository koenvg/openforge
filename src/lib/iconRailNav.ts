import type { AppView } from './types'

export interface IconRailPluginNavItem {
  viewKey: AppView
  icon: string
  title: string
  shortcut: string | null
}

export interface IconRailNavItem {
  view: AppView
  icon: string
  shortcut: string
  label: string
}

const boardNavItem: IconRailNavItem = {
  view: 'board',
  icon: 'layout-dashboard',
  shortcut: 'H',
  label: 'Board',
}

const settingsNavItem: IconRailNavItem = {
  view: 'settings',
  icon: 'settings',
  shortcut: ',',
  label: 'Settings',
}

function normalizeShortcut(shortcut: string | null): string {
  return shortcut ? shortcut.replace(/^[⌘⌃⌥⇧]+/, '').toUpperCase() : ''
}

export function getIconRailNavItems(pluginNavItems: IconRailPluginNavItem[] = []): IconRailNavItem[] {
  return [
    boardNavItem,
    ...pluginNavItems.map((item) => ({
      view: item.viewKey,
      icon: item.icon,
      shortcut: normalizeShortcut(item.shortcut),
      label: item.title,
    })),
    settingsNavItem,
  ]
}
