import type {
  BrowserSurfaceCapture,
  BrowserSurfaceFeedbackSelection,
  BrowserSurfaceRegion,
  BrowserSurfaceErrorCode,
  BrowserSurfaceNavigationError,
  BrowserSurfacesAPI,
  GetOrCreateBrowserSurfaceRequest,
  TaskBrowserSurfaceController,
  TaskBrowserSurfaceState,
} from './browserSurfaces'
import type {
  CommandDescriptor,
  CommandRegistry,
  CommandRegistration,
  CommandShortcutMetadata,
  Disposable,
  FrontendBackendBridge,
  FrontendOpenForgeAPI,
  FrontendPlugin,
  FrontendPluginContext,
  FrontendSettingsRegistry,
  FrontendTaskPaneRegistry,
  FrontendInjectionPointRegistry,
  FrontendTaskUIRegistry,
  FrontendViewRegistry,
  InjectionPointLocation,
  NavigationAPI,
  OpenForgeContextSnapshot,
  OpenForgeNavigationRequest,
  OpenForgeNavigationSnapshot,
  TaskLinkHandler,
  TaskLinkHandlerResult,
  TaskLinkOpenRequest,
  TaskLinksAPI,
  PluginIcon,
  PluginInjectionPointProps,
  PluginInjectionPointRegistration,
  PluginSettingsSectionProps,
  PluginSettingsSectionRegistration,
  PluginSettingsSectionScope,
  PluginStorageScope,
  PluginSvgIcon,
  PluginTaskPaneProps,
  PluginTaskPaneTabRegistration,
  PluginTaskUISectionProps,
  PluginTaskUISectionRegistration,
  PluginViewProps,
  PluginViewRegistration,
  TerminalImageProtocol,
} from './types'

export const OPENFORGE_FRONTEND_PLUGIN_MARKER = '__openforgeFrontendPlugin'

export type MarkedFrontendPlugin<TPlugin extends FrontendPlugin = FrontendPlugin> = TPlugin & {
  readonly [OPENFORGE_FRONTEND_PLUGIN_MARKER]: true
}

export function defineFrontendPlugin<const TPlugin extends FrontendPlugin>(plugin: TPlugin): MarkedFrontendPlugin<TPlugin> {
  Object.defineProperty(plugin, OPENFORGE_FRONTEND_PLUGIN_MARKER, {
    value: true,
    enumerable: false,
    configurable: false,
  })
  return plugin as MarkedFrontendPlugin<TPlugin>
}

export { BrowserSurfaceError, isAllowedBrowserSurfaceUrl } from './browserSurfaces'

export type {
  BrowserSurfaceCapture,
  BrowserSurfaceFeedbackSelection,
  BrowserSurfaceRegion,
  BrowserSurfaceErrorCode,
  BrowserSurfaceNavigationError,
  BrowserSurfacesAPI,
  GetOrCreateBrowserSurfaceRequest,
  TaskBrowserSurfaceController,
  TaskBrowserSurfaceState,
}

export type {
  CommandDescriptor,
  CommandRegistry,
  CommandRegistration,
  CommandShortcutMetadata,
  Disposable,
  FrontendBackendBridge,
  FrontendOpenForgeAPI,
  FrontendPlugin,
  FrontendPluginContext,
  FrontendSettingsRegistry,
  FrontendTaskPaneRegistry,
  FrontendInjectionPointRegistry,
  FrontendTaskUIRegistry,
  FrontendViewRegistry,
  InjectionPointLocation,
  NavigationAPI,
  OpenForgeContextSnapshot,
  OpenForgeNavigationRequest,
  OpenForgeNavigationSnapshot,
  TaskLinkHandler,
  TaskLinkHandlerResult,
  TaskLinkOpenRequest,
  TaskLinksAPI,
  PluginIcon,
  PluginInjectionPointProps,
  PluginInjectionPointRegistration,
  PluginSettingsSectionProps,
  PluginSettingsSectionRegistration,
  PluginSettingsSectionScope,
  PluginStorageScope,
  PluginSvgIcon,
  PluginTaskPaneProps,
  PluginTaskPaneTabRegistration,
  PluginTaskUISectionProps,
  PluginTaskUISectionRegistration,
  PluginViewProps,
  PluginViewRegistration,
  TerminalImageProtocol,
}
