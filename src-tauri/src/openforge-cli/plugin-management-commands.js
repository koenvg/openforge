import { optionalString, requireFlag } from './command-line.js';
import { printJson, requestJson } from './http-transport.js';

const LOCAL_PLUGIN_INSTALL_ERROR = 'plugin install supports local Plugin Installation only; pass --path <local-plugin-source>';
const PLUGIN_RELOAD_SOURCE_ERROR = 'plugin reload uses installed Plugin Installation artifacts only';

function rejectPluginInstallSources(flags, positionals) {
  if (positionals.length > 0 || flags.npm !== undefined || flags.git !== undefined || flags.source !== undefined) {
    throw new Error(LOCAL_PLUGIN_INSTALL_ERROR);
  }
}

function rejectPluginReloadSources(flags, positionals) {
  if (positionals.length > 0 || flags.path !== undefined || flags.npm !== undefined || flags.git !== undefined || flags.source !== undefined) {
    throw new Error(PLUGIN_RELOAD_SOURCE_ERROR);
  }
}

async function installPluginFromLocal(flags) {
  const sourcePath = requireFlag(flags, 'path');
  printJson(await requestJson('/install_plugin_from_local', {
    method: 'POST',
    body: JSON.stringify({ sourcePath }),
  }));
}

async function setPluginEnabled(flags, enabled) {
  const pluginId = requireFlag(flags, 'pluginId');
  const projectId = requireFlag(flags, 'projectId');
  printJson(await requestJson('/set_plugin_enabled', {
    method: 'POST',
    body: JSON.stringify({ pluginId, projectId, enabled }),
  }));
}

async function setAppPluginEnabled(flags, enabled) {
  const pluginId = requireFlag(flags, 'pluginId');
  printJson(await requestJson('/set_app_plugin_enabled', {
    method: 'POST',
    body: JSON.stringify({ pluginId, enabled }),
  }));
}

async function reloadPlugin(flags) {
  const payload = {
    pluginId: requireFlag(flags, 'pluginId'),
    projectId: optionalString(flags, 'projectId'),
  };
  printJson(await requestJson('/reload_plugin', {
    method: 'POST',
    body: JSON.stringify(payload),
  }));
}

export const PLUGIN_MANAGEMENT_COMMAND_SPECS = [
  {
    path: ['plugin', 'install'],
    flags: ['path', 'npm', 'git', 'source'],
    allowPositionals: true,
    usage: 'openforge plugin install --path <local-plugin-source>',
    validate: rejectPluginInstallSources,
    handler: installPluginFromLocal,
  },
  {
    path: ['plugin', 'enable'],
    flags: ['pluginId', 'projectId'],
    usage: 'openforge plugin enable --plugin-id <id> --project-id <id>',
    handler: (flags) => setPluginEnabled(flags, true),
  },
  {
    path: ['plugin', 'disable'],
    flags: ['pluginId', 'projectId'],
    usage: 'openforge plugin disable --plugin-id <id> --project-id <id>',
    handler: (flags) => setPluginEnabled(flags, false),
  },
  {
    path: ['plugin', 'app', 'enable'],
    flags: ['pluginId'],
    usage: 'openforge plugin app enable --plugin-id <id>',
    handler: (flags) => setAppPluginEnabled(flags, true),
  },
  {
    path: ['plugin', 'app', 'disable'],
    flags: ['pluginId'],
    usage: 'openforge plugin app disable --plugin-id <id>',
    handler: (flags) => setAppPluginEnabled(flags, false),
  },
  {
    path: ['plugin', 'reload'],
    flags: ['pluginId', 'projectId', 'path', 'npm', 'git', 'source'],
    allowPositionals: true,
    usage: 'openforge plugin reload --plugin-id <id> [--project-id <id>]',
    validate: rejectPluginReloadSources,
    handler: reloadPlugin,
  },
];
