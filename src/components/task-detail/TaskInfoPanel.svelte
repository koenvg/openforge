<script lang="ts">
  import type { Task, TaskLabel, PullRequestInfo } from '../../lib/types'
  import { deriveTaskAttention } from '../../lib/taskAttention'
  import { activeSessions, tasks as allTasks, ticketPrs } from '../../lib/stores'
  import { addTaskLabel, getPullRequests, removeTaskLabel } from '../../lib/ipc'
  import { getAgentSessionResumeCommand } from '../../lib/agentResumeCommand'
  import { buildTicketPullRequestMap } from '../../lib/pullRequestStore'
  import { getTaskLabels, hasLabelNamed } from '../../lib/taskLabels'
  import { getTaskDependentSummaries, getTaskDependencySummaries, getWaitingDependencyCount } from '../../lib/taskDependencies'
  import CopyButton from '../shared/ui/CopyButton.svelte'
  import TaskPromptSummary from './TaskPromptSummary.svelte'
  import TaskPullRequestStatus from './TaskPullRequestStatus.svelte'
  import TaskGitStatus from './TaskGitStatus.svelte'
  import TaskLabelEditor from '../shared/tasks/TaskLabelEditor.svelte'
  import TaskRelationshipDetailSection from '../shared/tasks/TaskRelationshipDetailSection.svelte'

  interface Props {
    task: Task
    workspacePath: string | null
    allTasksOverride?: Task[]
    taskPrsOverride?: PullRequestInfo[]
    allowCommentAddressing?: boolean
    surface?: 'default' | 'transparent'
    onEditPrompt?: () => void
  }

  let { task, workspacePath, allTasksOverride, taskPrsOverride, allowCommentAddressing = false, surface = 'default', onEditPrompt }: Props = $props()

  let labels = $state<TaskLabel[]>([])
  let previousTaskId: string | null = null
  let previousTaskLabelSignature = ''

  let taskPrs = $derived((taskPrsOverride ?? $ticketPrs.get(task.id)) || [])
  let taskList = $derived(allTasksOverride ?? $allTasks)
  let dependencies = $derived(getTaskDependencySummaries(task, taskList))
  let waitingDependencyCount = $derived(getWaitingDependencyCount(task, taskList))
  let dependents = $derived(getTaskDependentSummaries(task, taskList))
  let surfaceClass = $derived(surface === 'transparent' ? 'bg-transparent' : 'bg-base-200')
  let attention = $derived(deriveTaskAttention(taskPrs, waitingDependencyCount))
  let resumeCommand = $derived(getAgentSessionResumeCommand($activeSessions.get(task.id) || null))

  function labelSignature(nextLabels: TaskLabel[]): string {
    return JSON.stringify(nextLabels.map((label) => [label.id, label.name, label.color]))
  }

  function chipClass(tone: 'error' | 'warning' | 'success' | 'info'): string {
    if (tone === 'error') return 'badge-error badge-outline'
    if (tone === 'warning') return 'badge-warning badge-outline'
    if (tone === 'success') return 'badge-success badge-outline'
    return 'badge-info badge-outline'
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

  async function refreshLinkedPullRequests() {
    const prs = await getPullRequests()
    ticketPrs.set(buildTicketPullRequestMap(prs, $ticketPrs))
  }

</script>

<div data-testid="task-info-panel" data-scroll-owner="false" class="flex flex-col gap-3 p-3 {surfaceClass} min-h-max">
  {#if attention}
    <section
      data-task-info-card="attention"
      data-card-sizing="natural"
      class="flex flex-wrap items-center gap-1.5 shrink-0"
      aria-label="Attention"
    >
      <span class="badge badge-sm rounded-md {chipClass(attention.tone)}">{attention.message}</span>
    </section>
  {/if}

  <TaskPullRequestStatus taskId={task.id} {taskPrs} onPullRequestLinked={refreshLinkedPullRequests} {allowCommentAddressing} />

  <TaskPromptSummary {task} {onEditPrompt} />

  <section data-task-info-card="details" data-card-sizing="natural" class="rounded-lg border border-base-300/70 bg-base-100 overflow-hidden shrink-0" aria-label="Details">
    <h3 class="m-0 px-3 py-2 text-sm font-semibold text-base-content border-b border-base-300/70">Details</h3>

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
  </section>

  <TaskRelationshipDetailSection
    kind="dependencies"
    items={dependencies}
    {waitingDependencyCount}
    density="full"
  />

  <TaskRelationshipDetailSection
    kind="dependents"
    items={dependents}
    density="full"
  />

  {#if workspacePath !== null}
    <TaskGitStatus taskId={task.id} />
  {/if}
</div>
