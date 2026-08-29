import {
  OPENFORGE_PLUGIN_API_VERSION,
  type AgentCommandMetadata,
  type CommandRegistration,
  type OpenForgePackageMetadata,
  type PluginSidebarNavigationProps,
  type PluginCommandInvocationContext,
  type Task,
  type TaskUsageCandidatePage,
  type TasksAPI,
} from '@openforge-app/plugin-sdk'
import { defineBackendPlugin } from '@openforge-app/plugin-sdk/backend'
import { defineFrontendPlugin, type PluginViewRegistration } from '@openforge-app/plugin-sdk/frontend'
import {
  createOpenForgeRegistryFake,
  type TestingCommandContribution,
} from '@openforge-app/plugin-sdk/testing'

const agentMetadata = {
  description: 'Synchronize the current project.',
  examples: [{ force: true }],
  discoverable: true,
} satisfies AgentCommandMetadata

const registration: CommandRegistration<{ force?: boolean }, { projectId: string | null }> = {
  id: 'sync',
  title: 'Sync project',
  discoverable: false,
  agent: agentMetadata,
  input: { type: 'object' },
  output: { type: 'object' },
  handler: async (_input, invocation) => ({ projectId: invocation.projectId }),
}

const invocation: PluginCommandInvocationContext = {
  taskId: 'KVG-3423',
  projectId: 'P-4',
  source: 'agent-cli',
}

const testingCommand = null as unknown as TestingCommandContribution
void testingCommand.handler({}, invocation)
void testingCommand.agent?.description

const task = null as unknown as Task
// @ts-expect-error Task handoff summaries were removed from the host contract.
void task.summary

const tasks = null as unknown as TasksAPI
// @ts-expect-error The host no longer exposes the legacy handoff-summary mutation.
void tasks.updateSummary('KVG-3423', 'obsolete handoff')

const usageCandidates: Promise<TaskUsageCandidatePage> = tasks.listUsageCandidates({
  provider: 'pi',
  periodStart: 1_775_174_400,
  taskId: 'KVG-3423',
  pageSize: 100,
})
void usageCandidates
const appPackageMetadata = {
  id: 'contract-fixture',
  apiVersion: 1,
  displayName: 'Contract fixture',
  description: 'Exercises app-level custom sidebar navigation.',
  enablement: 'app',
  frontend: './frontend.js',
  requires: ['views', 'appEnablement', 'customSidebarNavigation'],
} satisfies OpenForgePackageMetadata

const registry = createOpenForgeRegistryFake({
  pluginId: 'contract-fixture',
  projectId: invocation.projectId,
  taskId: invocation.taskId,
  packageMetadata: appPackageMetadata,
})
void registry.backendApi.commands.register(registration)
void registry.backendApi.fs.external.stat({ root: '/collector', path: 'events.jsonl' })
void registry.backendApi.fs.external.readTextFileChunks({
  root: '/collector',
  path: 'events.jsonl',
  expectedIdentity: '41:9',
  startOffsetBytes: 128,
  maxBytes: 4096,
})
void registry.backendApi.fs.userData.appendTextFile({ path: 'events/index.jsonl', content: '{}\n' })
void registry.backendApi.fs.userData.writeTextFile({ path: 'events/state.json', content: '{"bytes":3}' })

declare const viewComponent: PluginViewRegistration['component']
declare const navigationComponent: NonNullable<PluginViewRegistration['navigationComponent']>
declare const navigationProps: PluginSidebarNavigationProps
navigationProps.onActivate()
void navigationProps.view.qualifiedId

void registry.frontendApi.views.register({
  id: 'usage',
  title: 'Usage',
  icon: 'chart-column-big',
  placement: 'sidebar',
  component: viewComponent,
  navigationComponent,
})

void defineBackendPlugin({
  activate(openforge, context) {
    context.subscriptions.add(openforge.commands.register(registration))
  },
})

void defineFrontendPlugin({
  activate(openforge, context) {
    context.subscriptions.add(openforge.commands.register(registration))
  },
})

const apiVersion: 1 = OPENFORGE_PLUGIN_API_VERSION
void apiVersion

const packageMetadata = {
  id: 'contract-fixture',
  apiVersion,
  displayName: 'Contract fixture',
  description: 'Exercises the public Plugin SDK authoring contract.',
  requires: ['injectionPoints'],
} satisfies OpenForgePackageMetadata
void packageMetadata
