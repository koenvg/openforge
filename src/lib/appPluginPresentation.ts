import type { ResolvedContributions, RuntimeContributionSource } from './plugin/contributionResolver'
import { getPluginRenderProps } from './plugin/pluginRegistry'
import { isPluginViewKey, makePluginViewKey } from './plugin/types'
import type { IconRailPluginNavItem, SidebarPluginNavItem } from './iconRailNav'
import type { AppView, Project } from './types'
import { getViews } from './views'

interface AppPluginPresentationContext {
  activeProject: Project | null
  activeProjectId: string | null
  currentView: AppView
  onCloseSettings(): void
  onProjectDeleted(): void | Promise<void>
  onProjectSettingsSaved(): void | Promise<void>
}

export function resolveAppPluginPresentation(
  contributionSources: RuntimeContributionSource[],
  contributions: ResolvedContributions,
  context: AppPluginPresentationContext,
) {
  const views = getViews(contributionSources)
  const pluginNavItems: IconRailPluginNavItem[] = contributions.views
    .filter((view) => view.showInRail)
    .sort((left, right) => left.railOrder - right.railOrder || left.title.localeCompare(right.title))
    .map((view) => ({
      viewKey: makePluginViewKey(view.pluginId, view.contributionId),
      icon: view.icon,
      title: view.title,
      shortcut: view.shortcut,
    }))
  const sidebarPluginNavItems: SidebarPluginNavItem[] = contributions.views
    .filter((view) => view.showInSidebar)
    .sort((left, right) => left.railOrder - right.railOrder || left.title.localeCompare(right.title))
    .map((view) => {
      const item: SidebarPluginNavItem = {
        viewKey: makePluginViewKey(view.pluginId, view.contributionId),
        icon: view.icon,
        title: view.title,
        shortcut: view.shortcut,
      }
      if (!view.navigationComponent) return item

      return {
        ...item,
        navigation: {
          component: view.navigationComponent,
          props: {
            ...getPluginRenderProps(view.pluginId, { projectId: context.activeProjectId }),
            view: {
              pluginId: view.pluginId,
              id: view.contributionId,
              qualifiedId: view.namespacedId,
              title: view.title,
              icon: view.icon,
            },
          },
        },
      }
    })
  const sidebarPluginViewKeySet = new Set(sidebarPluginNavItems.map((item) => item.viewKey))
  const activeViewEntry = context.currentView === 'board' || context.currentView === 'files'
    ? null
    : views[context.currentView] ?? null
  const renderedActiveView = activeViewEntry === null
    ? null
    : {
        component: activeViewEntry.component,
        props: activeViewEntry.getProps({
          projectId: context.activeProjectId,
          projectName: context.activeProject?.name ?? '',
          projectPath: context.activeProject?.path ?? '',
          onCloseSettings: context.onCloseSettings,
          onProjectDeleted: context.onProjectDeleted,
          onProjectSettingsSaved: context.onProjectSettingsSaved,
        }),
      }

  return {
    contributions,
    pluginNavItems,
    sidebarPluginNavItems,
    sidebarPluginViewKeySet,
    renderedActiveView,
    pluginViewActive: isPluginViewKey(context.currentView) && activeViewEntry === null,
  }
}
