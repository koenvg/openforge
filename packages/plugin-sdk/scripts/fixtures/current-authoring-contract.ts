import {
  OPENFORGE_PLUGIN_API_VERSION,
  type AgentCommandMetadata,
  type CommandRegistration,
  type OpenForgePackageMetadata,
  type PluginCommandInvocationContext,
  type Task,
  type TasksAPI,
} from '@openforge-app/plugin-sdk'
import { defineBackendPlugin } from '@openforge-app/plugin-sdk/backend'
import { defineFrontendPlugin } from '@openforge-app/plugin-sdk/frontend'
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

const registry = createOpenForgeRegistryFake({
  pluginId: 'contract-fixture',
  projectId: invocation.projectId,
  taskId: invocation.taskId,
})
void registry.backendApi.commands.register(registration)

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
