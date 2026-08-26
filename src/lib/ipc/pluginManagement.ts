import type { ConfigureStartPromptContributionRequest, JsonValue, StartPromptContribution } from '@openforge-app/plugin-sdk'
import { invokeDesktopCommand as invoke } from '../desktopIpc'

export async function configureStartPromptContribution(
  ownerPluginId: string | undefined,
  request: ConfigureStartPromptContributionRequest,
): Promise<StartPromptContribution[]> {
  const order = request.order ?? 0;
  if (!Number.isSafeInteger(order)) {
    throw new Error('start prompt contribution order must be a safe integer');
  }
  return invoke<StartPromptContribution[]>("configure_start_prompt_contribution", {
    ownerPluginId: ownerPluginId ?? null,
    projectId: request.projectId,
    id: request.id,
    enabled: request.enabled !== false,
    content: request.content,
    order,
  });
}

type PluginRowSnake = {
  id: string;
  name: string;
  version: string;
  api_version: number;
  description: string;
  permissions: string;
  contributes: string;
  frontend_entry: string;
  backend_entry: string | null;
  install_path: string;
  source_kind: string;
  source_spec: string;
  package_metadata: string;
  installed_at: number;
  is_builtin: boolean;
}

export type NormalizedPluginRow = {
  id: string;
  name: string;
  version: string;
  apiVersion: number;
  description: string;
  permissions: string;
  contributes: string;
  frontendEntry: string;
  backendEntry: string | null;
  installPath: string;
  sourceKind: string;
  sourceSpec: string;
  packageMetadata: string;
  installedAt: number;
  isBuiltin: boolean;
}

function normalizePluginRow(raw: PluginRowSnake): NormalizedPluginRow {
  return {
    id: raw.id,
    name: raw.name,
    version: raw.version,
    apiVersion: raw.api_version,
    description: raw.description,
    permissions: raw.permissions,
    contributes: raw.contributes,
    frontendEntry: raw.frontend_entry,
    backendEntry: raw.backend_entry,
    installPath: raw.install_path,
    sourceKind: raw.source_kind ?? 'legacy',
    sourceSpec: raw.source_spec ?? '',
    packageMetadata: raw.package_metadata ?? '{}',
    installedAt: raw.installed_at,
    isBuiltin: raw.is_builtin,
  };
}

export async function registerBuiltinPlugin(plugin: {
  id: string;
  name: string;
  version: string;
  apiVersion: number;
  description: string;
  permissions: string;
  contributes: string;
  frontendEntry: string;
  backendEntry: string | null;
  installPath: string;
  sourceKind?: string;
  sourceSpec?: string;
  packageMetadata?: string;
  installedAt: number;
  isBuiltin: boolean;
}): Promise<void> {
  return invoke("register_builtin_plugin", {
    plugin: {
      id: plugin.id,
      name: plugin.name,
      version: plugin.version,
      apiVersion: plugin.apiVersion,
      description: plugin.description,
      permissions: plugin.permissions,
      contributes: plugin.contributes,
      frontendEntry: plugin.frontendEntry,
      backendEntry: plugin.backendEntry,
      installPath: plugin.installPath,
      sourceKind: plugin.sourceKind ?? 'legacy',
      sourceSpec: plugin.sourceSpec ?? '',
      packageMetadata: plugin.packageMetadata ?? '{}',
      installedAt: plugin.installedAt,
      isBuiltin: plugin.isBuiltin,
    },
  });
}

export async function installPluginFromLocal(sourcePath: string): Promise<NormalizedPluginRow> {
  const raw = await invoke<PluginRowSnake>("install_plugin_from_local", { sourcePath })
  return normalizePluginRow(raw)
}

export async function installPluginFromNpm(packageName: string): Promise<NormalizedPluginRow> {
  const raw = await invoke<PluginRowSnake>("install_plugin_from_npm", { packageName })
  return normalizePluginRow(raw)
}

export async function installPluginFromGit(gitSpec: string): Promise<NormalizedPluginRow> {
  const raw = await invoke<PluginRowSnake>("install_plugin_from_git", { gitSpec })
  return normalizePluginRow(raw)
}

export async function installPluginFromSource(sourceSpec: string): Promise<NormalizedPluginRow> {
  const raw = await invoke<PluginRowSnake>("install_plugin_from_source", { sourceSpec })
  return normalizePluginRow(raw)
}

/**
 * A plugin package found inside the remembered plugin folder. The sidecar already emits
 * camelCase for this shape, so it needs no normalization.
 */
export type DiscoveredPlugin = {
  path: string
  id: string
  name: string
  version: string
  description: string
  installable: boolean
  needsBuild: boolean
  problem: string | null
}

export async function scanPluginFolder(folderPath: string): Promise<DiscoveredPlugin[]> {
  return invoke<DiscoveredPlugin[]>("scan_plugin_folder", { folderPath })
}

export async function uninstallPlugin(pluginId: string): Promise<void> {
  return invoke("uninstall_plugin", { pluginId });
}

export async function getPlugin(pluginId: string): Promise<NormalizedPluginRow | null> {
  const raw = await invoke<PluginRowSnake | null>("get_plugin", { pluginId });
  return raw ? normalizePluginRow(raw) : null;
}

export async function listPlugins(): Promise<NormalizedPluginRow[]> {
  const rows = await invoke<PluginRowSnake[]>("list_plugins");
  return rows.map(normalizePluginRow);
}

export async function setPluginEnabled(projectId: string, pluginId: string, enabled: boolean): Promise<void> {
  return invoke("set_plugin_enabled", { projectId, pluginId, enabled });
}

export async function getEnabledPlugins(projectId: string): Promise<NormalizedPluginRow[]> {
  const rows = await invoke<PluginRowSnake[]>("get_enabled_plugins", { projectId });
  return rows.map(normalizePluginRow);
}

export async function setAppPluginEnabled(pluginId: string, enabled: boolean): Promise<void> {
  return invoke('set_app_plugin_enabled', { pluginId, enabled })
}

export async function getEnabledAppPlugins(): Promise<NormalizedPluginRow[]> {
  const rows = await invoke<PluginRowSnake[]>('get_enabled_app_plugins', {})
  return rows.map(normalizePluginRow)
}

export async function setGlobalPluginDefault(pluginId: string, enabled: boolean): Promise<void> {
  return invoke("set_global_plugin_default", { pluginId, enabled });
}

export async function getGlobalPluginDefaults(): Promise<{ pluginId: string; enabled: boolean }[]> {
  return invoke<{ pluginId: string; enabled: boolean }[]>("get_global_plugin_defaults", {});
}

export type PluginStorageScopeKind = 'global' | 'project' | 'task'

export async function getPluginStorage(pluginId: string, scope: PluginStorageScopeKind, scopeId: string | null, key: string): Promise<JsonValue | null> {
  return invoke<JsonValue | null>('get_plugin_storage', { pluginId, scope, scopeId, key })
}

export async function setPluginStorage(pluginId: string, scope: PluginStorageScopeKind, scopeId: string | null, key: string, value: JsonValue): Promise<void> {
  return invoke('set_plugin_storage', { pluginId, scope, scopeId, key, value })
}

export async function deletePluginStorage(pluginId: string, scope: PluginStorageScopeKind, scopeId: string | null, key: string): Promise<void> {
  return invoke('delete_plugin_storage', { pluginId, scope, scopeId, key })
}

export async function pluginInvoke(pluginId: string, command: string, payload: unknown): Promise<unknown> {
  return invoke("plugin_invoke", { pluginId, command, payload: payload ?? null })
}

export async function pluginBackendWhenReady(
  pluginId: string,
  projectId: string | null = null,
  preserveActivation = false,
): Promise<void> {
  await invoke('plugin_backend_when_ready', { pluginId, projectId, preserveActivation })
}

export async function pluginBackendDeactivate(pluginId: string): Promise<void> {
  await invoke('plugin_backend_deactivate', { pluginId })
}

export async function stopPluginSidecar(): Promise<void> {
  return invoke('stop_plugin_sidecar', {})
}
