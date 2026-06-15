<script lang="ts">
  import type { Task, TaskLabel, PullRequestInfo } from '../../lib/types'
  import { hasMergeConflicts, isReadyToMerge } from '../../lib/types'
  import { tasks as allTasks, ticketPrs } from '../../lib/stores'
  import { addTaskLabel, removeTaskLabel } from '../../lib/ipc'
  import { getTaskLabels, hasLabelNamed } from '../../lib/taskLabels'
  import { getTaskDependentSummaries, getTaskDependencySummaries, getWaitingDependencyCount } from '../../lib/taskDependencies'
  import CopyButton from '../shared/ui/CopyButton.svelte'
  import TaskPromptSummary from './TaskPromptSummary.svelte'
  import TaskPullRequestStatus from './TaskPullRequestStatus.svelte'
  import TaskMergeStatus from './TaskMergeStatus.svelte'
  import TaskLabelEditor from '../shared/tasks/TaskLabelEditor.svelte'
  import TaskRelationshipDetailSection from '../shared/tasks/TaskRelationshipDetailSection.svelte'

  interface Props {
    task: Task
    workspacePath: string | null
  }

  let { task, workspacePath }: Props = $props()

  let labels = $state<TaskLabel[]>([])
  let previousTaskId: string | null = null
  let previousTaskLabelSignature = ''

  let taskPrs = $derived($ticketPrs.get(task.id) || [])
  let dependencies = $derived(getTaskDependencySummaries(task, $allTasks))
  let waitingDependencyCount = $derived(getWaitingDependencyCount(task, $allTasks))
  let dependents = $derived(getTaskDependentSummaries(task, $allTasks))

  function labelSignature(nextLabels: TaskLabel[]): string {
    return JSON.stringify(nextLabels.map((label) => [label.id, label.name, label.color]))
  }

  function unaddressedCommentCount(prs: PullRequestInfo[]): number {
    return prs.reduce((total, pr) => total + (pr.unaddressed_comment_count ?? 0), 0)
  }

  function hasCiFailure(prs: PullRequestInfo[]): boolean {
    return prs.some((pr) => pr.ci_status === 'failure')
  }

  function hasPendingCi(prs: PullRequestInfo[]): boolean {
    return prs.some((pr) => pr.ci_status === 'pending')
  }

  function hasChangesRequested(prs: PullRequestInfo[]): boolean {
    return prs.some((pr) => pr.review_status === 'changes_requested')
  }

  function hasReviewNeeded(prs: PullRequestInfo[]): boolean {
    return prs.some((pr) => pr.review_status === 'pending' || pr.review_status === 'review_required')
  }

  function hasMergeReady(prs: PullRequestInfo[]): boolean {
    return prs.some((pr) => isReadyToMerge(pr))
  }

  function attentionTitle(prs: PullRequestInfo[]): string {
    if (prs.some((pr) => hasMergeConflicts(pr))) return 'Resolve merge conflicts'
    if (unaddressedCommentCount(prs) > 0) return 'Review PR comments before merge'
    if (hasCiFailure(prs)) return 'Fix failing CI checks'
    if (hasChangesRequested(prs)) return 'Address requested changes'
    if (hasMergeReady(prs)) return 'Ready to merge'
    if (hasPendingCi(prs)) return 'Waiting for CI'
    if (hasReviewNeeded(prs)) return 'Waiting for review'
    if (prs.length > 0) return 'Pull requests are linked'
    return 'No pull requests linked'
  }

  function attentionSignalChips(prs: PullRequestInfo[]): Array<{ label: string, tone: 'ghost' | 'error' | 'warning' | 'success' | 'info' }> {
    if (prs.length === 0) {
      return [
        { label: 'No PR', tone: 'ghost' },
        { label: 'No CI', tone: 'ghost' },
        { label: 'No review', tone: 'ghost' },
      ]
    }

    const chips: Array<{ label: string, tone: 'ghost' | 'error' | 'warning' | 'success' | 'info' }> = []
    if (hasCiFailure(prs)) chips.push({ label: 'CI failing', tone: 'error' })
    else if (hasPendingCi(prs)) chips.push({ label: 'CI pending', tone: 'warning' })
    else if (prs.some((pr) => pr.ci_status === 'success')) chips.push({ label: 'CI passed', tone: 'success' })
    else chips.push({ label: 'No CI', tone: 'ghost' })

    const comments = unaddressedCommentCount(prs)
    if (comments > 0) chips.push({ label: `${comments} ${comments === 1 ? 'comment' : 'comments'}`, tone: 'warning' })

    if (hasChangesRequested(prs)) chips.push({ label: 'changes requested', tone: 'warning' })
    else if (hasReviewNeeded(prs)) chips.push({ label: 'needs review', tone: 'info' })
    else if (prs.some((pr) => pr.review_status === 'approved')) chips.push({ label: 'approved', tone: 'success' })
    else chips.push({ label: 'No review', tone: 'ghost' })

    if (prs.some((pr) => hasMergeConflicts(pr))) chips.push({ label: 'merge blocked', tone: 'error' })
    else if (hasMergeReady(prs)) chips.push({ label: 'ready to merge', tone: 'success' })

    return chips
  }

  function chipClass(tone: 'ghost' | 'error' | 'warning' | 'success' | 'info'): string {
    if (tone === 'error') return 'badge-error badge-outline'
    if (tone === 'warning') return 'badge-warning badge-outline'
    if (tone === 'success') return 'badge-success badge-outline'
    if (tone === 'info') return 'badge-info badge-outline'
    return 'badge-ghost'
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

</script>

<div class="flex flex-col gap-3 p-3 overflow-y-auto bg-base-200 h-full">
  <header class="flex flex-col gap-2 border-b border-base-300/70 pb-3" aria-label="Task Attention">
    <div class="flex items-center justify-between gap-2">
      <h2 class="m-0 font-mono text-lg font-bold text-base-content tracking-tight">{task.id}</h2>
      <span class="badge badge-primary badge-outline capitalize px-2 py-2 text-xs shrink-0">{task.status}</span>
    </div>
    <p class="m-0 text-xs text-base-content/65">{attentionTitle(taskPrs)}</p>
  </header>

  <section class="flex flex-col gap-2 border-b border-base-300/70 pb-3" aria-label="Attention">
    <h3 class="m-0 text-sm font-semibold text-base-content">Attention</h3>
    <div class="flex flex-wrap items-center gap-1.5" aria-label="Attention signals">
      {#each attentionSignalChips(taskPrs) as chip (chip.label)}
        <span class="badge badge-sm rounded-md {chipClass(chip.tone)}">{chip.label}</span>
      {/each}
    </div>
  </section>

  <TaskPullRequestStatus {taskPrs} />

  <TaskMergeStatus {task} {taskPrs} />

  <TaskPromptSummary {task} />

  <section class="rounded-lg border border-base-300/70 bg-base-100 overflow-hidden" aria-label="Details">
    <h3 class="m-0 px-3 py-2 text-sm font-semibold text-base-content border-b border-base-300/70">Details</h3>

    <div class="grid grid-cols-[6.25rem_minmax(0,1fr)] items-start gap-2 px-3 py-2 border-b border-base-300/70">
      <div class="text-xs text-base-content/55">Status</div>
      <div class="justify-self-end badge badge-primary badge-outline capitalize badge-sm">{task.status}</div>
    </div>

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

    <div class="grid grid-cols-[6.25rem_minmax(0,1fr)] items-center gap-2 px-3 py-2">
      <div class="text-xs text-base-content/55">Pull requests</div>
      <div class="justify-self-end text-xs text-base-content/70">{taskPrs.length === 0 ? 'None' : taskPrs.length}</div>
    </div>
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
</div>
