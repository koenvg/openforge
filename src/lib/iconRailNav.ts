import type { PluginIcon, PluginSidebarNavigationProps } from '@openforge-app/plugin-sdk'
import type { PluginViewRegistration } from '@openforge-app/plugin-sdk/frontend'
import type { AppView } from './types'

export interface IconRailPluginNavItem {
  viewKey: AppView
  icon: PluginIcon
  title: string
  shortcut: string | null
}


export interface DashboardNavItem {
  icon: PluginIcon
  title: string
}
export interface SidebarPluginNavigation {
  component: NonNullable<PluginViewRegistration['navigationComponent']>
  props: Pick<PluginSidebarNavigationProps, 'api' | 'context' | 'view'>
}

export interface SidebarPluginNavItem extends IconRailPluginNavItem {
  navigation?: SidebarPluginNavigation
}

export interface IconRailNavItem {
  view: AppView
  icon: PluginIcon
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
  shortcut: '',
  label: 'Project Settings',
}

function normalizeShortcut(shortcut: string | null): string {
  return shortcut ? shortcut.replace(/^[⌘⌃⌥⇧]+/, '').toUpperCase() : ''
}

export function getIconRailNavItems(
  pluginNavItems: IconRailPluginNavItem[] = [],
  dashboardNavItem?: DashboardNavItem | null,
): IconRailNavItem[] {
  return [
    dashboardNavItem
      ? { ...boardNavItem, icon: dashboardNavItem.icon, label: dashboardNavItem.title }
      : boardNavItem,
    ...pluginNavItems.map((item) => ({
      view: item.viewKey,
      icon: item.icon,
      shortcut: normalizeShortcut(item.shortcut),
      label: item.title,
    })),
    settingsNavItem,
  ]
}
