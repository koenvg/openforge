import { isPluginViewKey, parsePluginViewKey } from './types'
import { sanitizePluginIcon } from '@openforge-app/plugin-sdk/pluginIcons'
import type { CommandShortcutMetadata, PluginIcon, ReplaceableViewTarget } from '@openforge-app/plugin-sdk'
import type {
  RuntimeBackgroundServiceContribution,
  RuntimeCommandContribution,
  RuntimeReviewRowActionContribution,
  RuntimeSettingsSectionContribution,
  RuntimeTaskPaneTabContribution,
  RuntimeTaskUISectionContribution,
  RuntimeViewContribution,
} from './runtimeContributionRegistry'

type RuntimeViewSource = Pick<RuntimeViewContribution, 'id' | 'title' | 'icon' | 'shortcut' | 'navigationComponent'> & Partial<Pick<RuntimeViewContribution, 'placement' | 'order'>>
type RuntimeViewReplacementSource = {
  id: string
  target: ReplaceableViewTarget
  title: string
  icon?: PluginIcon
}
type RuntimeTaskPaneTabSource = Pick<RuntimeTaskPaneTabContribution, 'id' | 'title' | 'icon' | 'order' | 'requiresWorkspace'>
type RuntimeTaskUISectionSource = Pick<RuntimeTaskUISectionContribution, 'id' | 'order'>
type RuntimeReviewRowActionSource = Pick<RuntimeReviewRowActionContribution, 'id' | 'order'>
type RuntimeCommandSource = Pick<RuntimeCommandContribution, 'id' | 'title' | 'shortcut' | 'discoverable'>
type RuntimeSettingsSectionSource = Pick<RuntimeSettingsSectionContribution, 'id' | 'title' | 'order' | 'scope'>
type RuntimeBackgroundServiceSource = Pick<RuntimeBackgroundServiceContribution, 'id' | 'scope'>

export interface ResolvedView {
  pluginId: string
  contributionId: string
  namespacedId: string
  title: string
  icon: PluginIcon
  shortcut: string | null
  navigationComponent: RuntimeViewContribution['navigationComponent']
  showInRail: boolean
  showInSidebar: boolean
  railOrder: number
}


export interface ResolvedViewReplacement {
  pluginId: string
  contributionId: string
  qualifiedId: string
  target: ReplaceableViewTarget
  title: string
  icon: PluginIcon | null
}
export interface ResolvedTab {
  pluginId: string
  contributionId: string
  namespacedId: string
  title: string
  icon: string | null
  order: number
  requiresWorkspace: boolean
}

export interface ResolvedTaskUISection {
  pluginId: string
  contributionId: string
  namespacedId: string
  order: number
}

/** A plugin control rendered on each review-requested pull-request row. */
export interface ResolvedReviewRowAction {
  pluginId: string
  contributionId: string
  namespacedId: string
  order: number
}

export interface ResolvedCommand {
  pluginId: string
  contributionId: string
  namespacedId: string
  title: string
  shortcut: string | null
  discoverable: boolean
}

export interface ResolvedSettingsSection {
  pluginId: string
  contributionId: string
  namespacedId: string
  title: string
  order: number
  scope: 'project' | 'global'
}

export interface ResolvedBackgroundService {
  pluginId: string
  contributionId: string
  namespacedId: string
  scope: RuntimeBackgroundServiceSource['scope']
}

export interface RuntimeContributionSource {
  pluginId: string
  views?: RuntimeViewSource[]
  viewReplacements?: RuntimeViewReplacementSource[]
  taskPaneTabs?: RuntimeTaskPaneTabSource[]
  taskUISections?: RuntimeTaskUISectionSource[]
  reviewRowActions?: RuntimeReviewRowActionSource[]
  commands?: RuntimeCommandSource[]
  settingsSections?: RuntimeSettingsSectionSource[]
  backgroundServices?: RuntimeBackgroundServiceSource[]
}

export interface ResolvedContributions {
  views: ResolvedView[]
  viewReplacements: ResolvedViewReplacement[]
  taskPaneTabs: ResolvedTab[]
  taskUISections: ResolvedTaskUISection[]
  reviewRowActions: ResolvedReviewRowAction[]
  commands: ResolvedCommand[]
  settingsSections: ResolvedSettingsSection[]
  backgroundServices: ResolvedBackgroundService[]
}

type ResolvedSlot = Exclude<keyof ResolvedContributions, 'viewReplacements'>

type ResolvedSlotItems = {
  views: ResolvedView[]
  taskPaneTabs: ResolvedTab[]
  taskUISections: ResolvedTaskUISection[]
  reviewRowActions: ResolvedReviewRowAction[]
  commands: ResolvedCommand[]
  settingsSections: ResolvedSettingsSection[]
  backgroundServices: ResolvedBackgroundService[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function toNamespacedId(pluginId: string, contributionId: string): string {
  return `${pluginId}:${contributionId}`
}

function matchesSlotId(item: { contributionId: string; namespacedId: string }, slotId: string): boolean {
  if (item.contributionId === slotId || item.namespacedId === slotId) {
    return true
  }

  if (isPluginViewKey(slotId)) {
    const { pluginId, viewId } = parsePluginViewKey(slotId)
    return item.namespacedId === `${pluginId}:${viewId}`
  }

  return false
}

function normalizeShortcut(shortcut: string): string {
  let result = ''
  const parts = shortcut.split('+')
  const key = parts[parts.length - 1]
  const modifiers = parts.slice(0, -1)

  if (modifiers.includes('Cmd')) result += '⌘'
  if (modifiers.includes('Ctrl')) result += '⌃'
  if (modifiers.includes('Alt')) result += '⌥'
  if (modifiers.includes('Shift')) result += '⇧'

  result += key.toLowerCase()
  return result
}

function resolveView(pluginId: string, item: unknown): ResolvedView | null {
  if (!isRecord(item)) {
    return null
  }

  const { id, title, icon, shortcut, placement, order, navigationComponent } = item
  if (!isNonEmptyString(id) || !isNonEmptyString(title)) {
    return null
  }

  let sanitizedIcon: PluginIcon
  try {
    sanitizedIcon = sanitizePluginIcon(icon)
  } catch {
    return null
  }

  return {
    pluginId,
    contributionId: id,
    namespacedId: toNamespacedId(pluginId, id),
    title,
    icon: sanitizedIcon,
    shortcut: isNonEmptyString(shortcut) ? normalizeShortcut(shortcut) : null,
    navigationComponent: typeof navigationComponent === 'function'
      ? navigationComponent as NonNullable<RuntimeViewContribution['navigationComponent']>
      : undefined,
    showInRail: placement === undefined || placement === 'rail',
    showInSidebar: placement === 'sidebar',
    railOrder: isNumber(order) ? order : 100,
  }
}

function resolveViewReplacement(pluginId: string, item: unknown): ResolvedViewReplacement | null {
  if (!isRecord(item)) return null

  const { id, target, title, icon } = item
  if (
    !isNonEmptyString(id)
    || (target !== 'project.dashboard' && target !== 'task.detail')
    || !isNonEmptyString(title)
  ) return null

  let sanitizedIcon: PluginIcon | null = null
  if (target === 'project.dashboard') {
    try {
      sanitizedIcon = sanitizePluginIcon(icon)
    } catch {
      return null
    }
  }

  return {
    pluginId,
    contributionId: id,
    qualifiedId: `${pluginId}.${id}`,
    target,
    title,
    icon: sanitizedIcon,
  }
}

function resolveTab(pluginId: string, item: unknown): ResolvedTab | null {
  if (!isRecord(item)) {
    return null
  }

  const { id, title, icon, order, requiresWorkspace } = item
  if (!isNonEmptyString(id) || !isNonEmptyString(title)) {
    return null
  }

  return {
    pluginId,
    contributionId: id,
    namespacedId: toNamespacedId(pluginId, id),
    title,
    icon: isNonEmptyString(icon) ? icon : null,
    order: isNumber(order) ? order : 0,
    requiresWorkspace: requiresWorkspace !== false,
  }
}

function resolveTaskUISection(pluginId: string, item: unknown): ResolvedTaskUISection | null {
  if (!isRecord(item)) {
    return null
  }

  const { id, order } = item
  if (!isNonEmptyString(id)) {
    return null
  }

  return {
    pluginId,
    contributionId: id,
    namespacedId: toNamespacedId(pluginId, id),
    order: isNumber(order) ? order : 0,
  }
}

// Same shape as a task UI section: an id and a rank, with no title to validate.
function resolveReviewRowAction(pluginId: string, item: unknown): ResolvedReviewRowAction | null {
  if (!isRecord(item)) {
    return null
  }

  const { id, order } = item
  if (!isNonEmptyString(id)) {
    return null
  }

  return {
    pluginId,
    contributionId: id,
    namespacedId: toNamespacedId(pluginId, id),
    order: isNumber(order) ? order : 0,
  }
}

function normalizeCommandShortcut(shortcut: unknown): string | null {
  if (isNonEmptyString(shortcut)) {
    return normalizeShortcut(shortcut)
  }

  const shortcutMetadata = shortcut as CommandShortcutMetadata | undefined
  if (isRecord(shortcutMetadata) && isNonEmptyString(shortcutMetadata.key)) {
    return normalizeShortcut(shortcutMetadata.key)
  }

  return null
}

function resolveCommand(pluginId: string, item: unknown): ResolvedCommand | null {
  if (!isRecord(item)) {
    return null
  }

  const { id, title, shortcut, discoverable } = item
  if (!isNonEmptyString(id) || !isNonEmptyString(title)) {
    return null
  }

  return {
    pluginId,
    contributionId: id,
    namespacedId: toNamespacedId(pluginId, id),
    title,
    shortcut: normalizeCommandShortcut(shortcut),
    discoverable: discoverable !== false,
  }
}

function resolveSettingsSection(pluginId: string, item: unknown): ResolvedSettingsSection | null {
  if (!isRecord(item)) {
    return null
  }

  const { id, title, order, scope } = item
  if (!isNonEmptyString(id) || !isNonEmptyString(title)) {
    return null
  }

  return {
    pluginId,
    contributionId: id,
    namespacedId: toNamespacedId(pluginId, id),
    title,
    order: isNumber(order) ? order : 0,
    // Unknown values fall back to project so a typo can't strand a section off
    // both pages.
    scope: scope === 'global' ? 'global' : 'project',
  }
}

function resolveBackgroundService(pluginId: string, item: unknown): ResolvedBackgroundService | null {
  if (!isRecord(item)) {
    return null
  }

  const { id, scope } = item
  if (!isNonEmptyString(id) || (scope !== 'global' && scope !== 'project' && scope !== 'task')) {
    return null
  }

  return {
    pluginId,
    contributionId: id,
    namespacedId: toNamespacedId(pluginId, id),
    scope,
  }
}

function collectResolved<T>(pluginId: string, items: unknown, resolver: (pluginId: string, item: unknown) => T | null): T[] {
  if (!Array.isArray(items)) {
    return []
  }

  return items.flatMap((item) => {
    const resolved = resolver(pluginId, item)
    return resolved === null ? [] : [resolved]
  })
}

export function resolveContributions(enabledPlugins: RuntimeContributionSource[]): ResolvedContributions {
  const resolved: ResolvedContributions = {
    views: [],
    viewReplacements: [],
    taskPaneTabs: [],
    taskUISections: [],
    reviewRowActions: [],
    commands: [],
    settingsSections: [],
    backgroundServices: [],
  }

  for (const plugin of enabledPlugins) {
    if (!isRecord(plugin) || !isNonEmptyString(plugin.pluginId)) {
      continue
    }

    resolved.views.push(...collectResolved(plugin.pluginId, plugin.views, resolveView))
    resolved.taskPaneTabs.push(...collectResolved(plugin.pluginId, plugin.taskPaneTabs, resolveTab))
    resolved.viewReplacements.push(...collectResolved(plugin.pluginId, plugin.viewReplacements, resolveViewReplacement))
    resolved.taskUISections.push(...collectResolved(plugin.pluginId, plugin.taskUISections, resolveTaskUISection))
    resolved.reviewRowActions.push(...collectResolved(plugin.pluginId, plugin.reviewRowActions, resolveReviewRowAction))
    resolved.commands.push(...collectResolved(plugin.pluginId, plugin.commands, resolveCommand))
    resolved.settingsSections.push(...collectResolved(plugin.pluginId, plugin.settingsSections, resolveSettingsSection))
    resolved.backgroundServices.push(...collectResolved(plugin.pluginId, plugin.backgroundServices, resolveBackgroundService))
  }

  resolved.taskUISections.sort((left, right) => left.order - right.order || left.namespacedId.localeCompare(right.namespacedId))
  resolved.reviewRowActions.sort((left, right) => left.order - right.order || left.namespacedId.localeCompare(right.namespacedId))
  resolved.settingsSections.sort((left, right) => left.order - right.order)
  return resolved
}

export function resolveContributionsForSlot<TSlot extends ResolvedSlot>(
  contributions: ResolvedContributions,
  slotType: TSlot,
  slotId: string
): ResolvedSlotItems[TSlot] {
  const slotContributions = contributions[slotType]
  return slotContributions.filter((item): item is ResolvedSlotItems[TSlot][number] => matchesSlotId(item, slotId)) as ResolvedSlotItems[TSlot]
}
