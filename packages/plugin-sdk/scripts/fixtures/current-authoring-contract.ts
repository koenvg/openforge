import {
  type AgentSessionSummary,
  type AgentSessionSummaryPage,
  type AgentSessionsAPI,
  type ListAgentSessionsRequest,
  OPENFORGE_PLUGIN_API_VERSION,
  THEME_TOKEN_NAMES,
  type AgentCommandMetadata,
  type CommandRegistration,
  type OpenForgePackageMetadata,
  type PluginSidebarNavigationProps,
  type PluginCommandInvocationContext,
  type ActiveTasks,
  type CompletedTaskPage,
  type TaskDetail,
  type TaskRead,
  type TaskReference,
  type TaskSummary,
  type TaskChangeEvent,
  type TaskChangeReason,
  type Task,
  type TasksAPI,
} from '@openforge-app/plugin-sdk'
import { defineBackendPlugin } from '@openforge-app/plugin-sdk/backend'
import {
  defineFrontendPlugin,
  type PluginProjectDashboardReplacementRegistration,
  type PluginProjectDashboardReplacementProps,
  type PluginTaskDetailReplacementRegistration,
  type PluginTaskDetailReplacementProps,
  type PluginThemeDefinition,
  type PluginViewRegistration,
} from '@openforge-app/plugin-sdk/frontend'
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
declare const reference: TaskReference
declare const summary: TaskSummary
declare const detail: TaskDetail
declare const active: ActiveTasks
declare const page: CompletedTaskPage
declare const read: TaskRead
void reference.dependsOn
void summary.promptPreview
void detail.prompt
void active.related
void page.nextCursor
void read.task
void tasks.active('P-4')
void tasks.completed('P-4', { search: 'completed task' })
void tasks.detail('P-4', 'KVG-3423')

const taskChangeReasons = ['created', 'updated', 'completed', 'attention', 'execution'] satisfies TaskChangeReason[]
const taskChangeSubscription = tasks.onDidChange('P-4', (event: TaskChangeEvent) => {
  void event.projectId
  void event.taskId
  void taskChangeReasons.includes(event.reason)
})
void taskChangeSubscription.dispose()
const listAgentSessionsRequest = {
  provider: 'pi',
  overlaps: { startInclusive: 1_775_174_400, endExclusive: 1_777_852_800 },
  taskId: 'KVG-3423',
  pageSize: 100,
} satisfies ListAgentSessionsRequest
const agentSessionSummary = {
  id: 'session-1',
  provider: 'pi',
  providerSessionId: 'pi-session-1',
  createdAt: 1_775_174_400,
  updatedAt: 1_775_174_500,
  task: {
    id: 'KVG-3423',
    title: 'Contract fixture',
    status: 'doing',
    createdAt: 1_775_174_300,
    updatedAt: 1_775_174_600,
  },
  workspace: { rootPath: '/repo', kind: 'project' },
} satisfies AgentSessionSummary
const agentSessions = null as unknown as AgentSessionsAPI
const agentSessionPage: Promise<AgentSessionSummaryPage> = agentSessions.list(listAgentSessionsRequest)
void agentSessionPage
// @ts-expect-error Compact Agent Session summaries never expose Task prompts.
void agentSessionSummary.prompt

const appPackageMetadata = {
  id: 'contract-fixture',
  apiVersion: 1,
  displayName: 'Contract fixture',
  description: 'Exercises app-level custom sidebar navigation.',
  enablement: 'app',
  frontend: './frontend.js',
  requires: ['views', 'viewReplacements', 'appEnablement', 'customSidebarNavigation', 'themes'],
} satisfies OpenForgePackageMetadata

const registry = createOpenForgeRegistryFake({
  pluginId: 'contract-fixture',
  projectId: invocation.projectId,
  taskId: invocation.taskId,
  packageMetadata: appPackageMetadata,
})
const themeDefinition = {
  id: 'paper',
  label: 'Paper',
  appearance: 'light',
  tokens: Object.fromEntries(THEME_TOKEN_NAMES.map(token => [token, `var(--contract-${token})`])),
} as PluginThemeDefinition
const themeRegistration = registry.frontendApi.themes.register(themeDefinition)
void themeRegistration.dispose()
void registry.frontendApi.agentSessions.list(listAgentSessionsRequest)
void registry.backendApi.agentSessions.list(listAgentSessionsRequest)
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
declare const dashboardComponent: PluginProjectDashboardReplacementRegistration['component']
const dashboardPropsContract = (props: PluginProjectDashboardReplacementProps) => {
  void props.project.id
  void props.api.tasks.onDidChange
  void props.onOpenTask('task-id')
  void props.api.navigation.navigate({ viewId: 'board' })
  void props.api.system.openUrl('https://example.com')
}
declare const taskDetailComponent: PluginTaskDetailReplacementRegistration['component']
const taskDetailPropsContract = (props: PluginTaskDetailReplacementProps) => {
  void props.project.id
  void props.task.prompt
  void props.relatedTasks[0]?.id
  void props.context.taskId
  void props.onOpenTask('related-task', props.project.id)
  void props.onEditTask()
  void props.onOpenTaskActions()
  void props.onRefreshTask()
}
void taskDetailPropsContract
void dashboardPropsContract
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


void registry.frontendApi.viewReplacements.register({
  id: 'dashboard',
  target: 'project.dashboard',
  title: 'Usage dashboard',
  icon: 'panels-top-left',
  component: dashboardComponent,
})
void registry.frontendApi.viewReplacements.register({
  id: 'task-workspace',
  target: 'task.detail',
  title: 'Task workspace',
  component: taskDetailComponent,
})
void defineBackendPlugin({
  activate(openforge, context) {
    context.subscriptions.add(openforge.commands.register(registration))
    // @ts-expect-error Task invalidations are exposed only by the frontend host.
    openforge.tasks.onDidChange('P-4', () => {})
  },
})

void defineFrontendPlugin({
  activate(openforge, context) {
    context.subscriptions.add(openforge.commands.register(registration))
    context.subscriptions.add(openforge.tasks.onDidChange('P-4', () => {}))
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
