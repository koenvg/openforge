<script lang="ts">
  import type { Task, TaskLabel } from '../../lib/types'
  import { activeSessions, dependencyReferenceTasks, mergingTaskIds, projects, tasks as allTasks } from '../../lib/stores'
  import { addTaskLabel, removeTaskLabel, updateTaskSourceTicketUrl } from '../../lib/ipc'
  import { getAgentSessionResumeCommand } from '../../lib/agentResumeCommand'
  import { getTaskLabels, hasLabelNamed } from '../../lib/taskLabels'
  import { getTaskDependentSummaries, getTaskDependencySummaries, getWaitingDependencyCount } from '../../lib/taskDependencies'
  import CopyButton from './CopyButton.svelte'
  import SourceTicketLink from './SourceTicketLink.svelte'
  import TaskInitialPrompt from './TaskInitialPrompt.svelte'
  import TaskGitStatus from './TaskGitStatus.svelte'
  import TaskLabelEditor from '../shared/tasks/TaskLabelEditor.svelte'
  import TaskRelationshipDetailSection from '../shared/tasks/TaskRelationshipDetailSection.svelte'
  import PluginSlot from '../plugin/PluginSlot.svelte'
  import CollapsibleSection from '@openforge-app/plugin-sdk/ui/CollapsibleSection.svelte'
  import Info from '@lucide/svelte/icons/info'

  interface Props {
    task: Task
    workspacePath: string | null
    allTasksOverride?: Task[]
    dependencyReferenceTasksOverride?: Task[]
    surface?: 'default' | 'transparent'
    density?: 'default' | 'inspector'
    onEditPrompt?: () => void
    onOpenRelatedTask?: (taskId: string, projectId: string | null) => void
  }

  let { task, workspacePath, allTasksOverride, dependencyReferenceTasksOverride, surface = 'default', density = 'default', onEditPrompt, onOpenRelatedTask }: Props = $props()

  let labels = $state<TaskLabel[]>([])
  let previousTaskId: string | null = null
  let previousTaskLabelSignature = ''

  let activeTaskList = $derived(allTasksOverride ?? $allTasks)
  let relationshipTaskList = $derived([...activeTaskList, ...(dependencyReferenceTasksOverride ?? $dependencyReferenceTasks)])
  let projectNames = $derived(new Map($projects.map((project) => [project.id, project.name])))
  let dependencies = $derived(getTaskDependencySummaries(task, relationshipTaskList, projectNames))
  let waitingDependencyCount = $derived(getWaitingDependencyCount(task, relationshipTaskList))
  let dependents = $derived(getTaskDependentSummaries(task, relationshipTaskList, relationshipTaskList, projectNames))
  let panelClass = $derived(density === 'inspector'
    ? 'gap-0 p-0 bg-base-100'
    : `gap-3 p-3 ${surface === 'transparent' ? 'bg-transparent' : 'bg-base-200'}`)
  let resumeCommand = $derived(getAgentSessionResumeCommand($activeSessions.get(task.id) || null))

  function labelSignature(nextLabels: TaskLabel[]): string {
    return JSON.stringify(nextLabels.map((label) => [label.id, label.name]))
  }


  $effect(() => {
    const taskLabels = getTaskLabels(task)
    const nextTaskLabelSignature = labelSignature(taskLabels)
    if (task.id !== previousTaskId || nextTaskLabelSignature !== previousTaskLabelSignature) {
      previousTaskId = task.id
      previousTaskLabelSignature = nextTaskLabelSignature
      labels = taskLabels
    }
  })

  function replaceTaskLabelsInStore(nextLabels: TaskLabel[]) {
    allTasks.update((current) => current.map((storedTask) => {
      if (storedTask.id !== task.id) return storedTask
      return { ...storedTask, labels: nextLabels } as Task & { labels: TaskLabel[] }
    }))
  }

  async function handleAddLabel(labelOrName: TaskLabel | string) {
    if (hasLabelNamed(labels, typeof labelOrName === 'string' ? labelOrName : labelOrName.name)) return
    const label = typeof labelOrName === 'string'
      ? await addTaskLabel(task.id, labelOrName)
      : await addTaskLabel(task.id, labelOrName.name)
    labels = [...labels, label]
    replaceTaskLabelsInStore(labels)
  }

  async function handleRemoveLabel(label: TaskLabel) {
    await removeTaskLabel(task.id, label.id)
    labels = labels.filter((selected) => selected.id !== label.id)
    replaceTaskLabelsInStore(labels)
  }

  async function handleSaveSourceTicket(nextUrl: string | null) {
    await updateTaskSourceTicketUrl(task.id, nextUrl)
    allTasks.update((current) => current.map((storedTask) => {
      if (storedTask.id !== task.id) return storedTask
      return { ...storedTask, source_ticket_url: nextUrl }
    }))
  }

</script>

<div data-testid="task-info-panel" data-scroll-owner="false" data-density={density} class="flex min-h-max flex-col {panelClass}">
  <SourceTicketLink url={task.source_ticket_url} onSave={handleSaveSourceTicket} />

  <PluginSlot
    slotType="taskUISections"
    taskId={task.id}
    projectId={task.project_id}
    taskActionPending={$mergingTaskIds.has(task.id)}
  />

  <TaskInitialPrompt {task} {onEditPrompt} />

  <CollapsibleSection sectionKey="details" title="Details" cardId="details">
    {#snippet icon()}<Info size={14} />{/snippet}
    <div class="px-3 py-2 border-b border-base-300/70">
      <TaskLabelEditor
        projectId={task.project_id}
        selectedLabels={labels}
        onAdd={handleAddLabel}
        onRemove={handleRemoveLabel}
      />
    </div>

    {#if workspacePath}
      <div class="grid grid-cols-[6.25rem_minmax(0,1fr)_auto] items-center gap-2 px-3 py-2 border-b border-base-300/70" aria-label="Workspace">
        <div class="text-xs text-base-content/55">Workspace</div>
        <span class="text-xs font-mono text-base-content/70 truncate" title={workspacePath}>{workspacePath}</span>
        <CopyButton text={workspacePath} label="Copy workspace path" />
      </div>
    {/if}

    {#if resumeCommand}
      <div class="grid grid-cols-[6.25rem_minmax(0,1fr)_auto] items-center gap-2 px-3 py-2 border-b border-base-300/70" aria-label="Resume command">
        <div class="text-xs text-base-content/55">Resume command</div>
        <code class="text-xs font-mono text-base-content/70 truncate" title={resumeCommand}>{resumeCommand}</code>
        <CopyButton text={resumeCommand} label="Copy resume command" />
      </div>
    {/if}
  </CollapsibleSection>

  <TaskRelationshipDetailSection
    kind="dependencies"
    items={dependencies}
    {waitingDependencyCount}
    density="full"
    {onOpenRelatedTask}
  />

  <TaskRelationshipDetailSection
    kind="dependents"
    items={dependents}
    density="full"
    {onOpenRelatedTask}
  />

  {#if workspacePath !== null}
    <TaskGitStatus taskId={task.id} />
  {/if}
</div>
