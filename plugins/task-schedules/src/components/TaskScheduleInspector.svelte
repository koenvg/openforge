<script lang="ts">
  import {
    CalendarDays,
    CheckCircle2,
    CirclePause,
    CircleX,
    Clock3,
    Pencil,
    Play,
    Trash2,
    TriangleAlert,
    X,
  } from '@lucide/svelte'
  import { isTerminalTaskSchedule } from '../lib/taskScheduleLifecycle'
  import type { TaskSchedule } from '../lib/types'
  import { nextScheduleFireAt, scheduleStatusLabel } from '../lib/taskSchedulesViewModel'
  import type { ScheduleRunState } from '../lib/viewTypes'

  interface Props {
    schedule: TaskSchedule
    runState: ScheduleRunState | null
    updating: boolean
    timezone: string
    cadenceLabel: (schedule: TaskSchedule) => string
    cadenceDescription: (schedule: TaskSchedule) => string | null
    formatDate: (value: number | null) => string
    onClose: () => void
    onRunNow: (scheduleId: string) => void
    onCancelRun: (scheduleId: string) => void
    onEdit: (schedule: TaskSchedule) => void
    onToggleEnabled: (schedule: TaskSchedule) => void
    onRequestDelete: (schedule: TaskSchedule) => void
    onOpenTask: (taskId: string) => void
  }

  let {
    schedule,
    runState,
    updating,
    timezone,
    cadenceLabel,
    cadenceDescription,
    formatDate,
    onClose,
    onRunNow,
    onCancelRun,
    onEdit,
    onToggleEnabled,
    onRequestDelete,
    onOpenTask,
  }: Props = $props()

  let busy = $derived(updating || runState?.phase === 'running' || runState?.phase === 'cancelling')
  let history = $derived([...schedule.history].reverse())
  let status = $derived(scheduleStatusLabel(schedule))
  let terminal = $derived(isTerminalTaskSchedule(schedule))
  function resultLabel(status: string): string {
    if (status === 'started') return 'Succeeded'
    if (status === 'created') return 'Created'
    if (status === 'skipped') return 'Succeeded with warnings'
    if (status === 'cancelled') return 'Cancelled'
    return 'Failed'
  }

  function runStateClasses(state: ScheduleRunState): string {
    if (state.phase === 'success') return 'border-success/30 bg-success/10 text-success'
    if (state.phase === 'warning' || state.phase === 'already-running') return 'border-warning/30 bg-warning/10 text-base-content'
    if (state.phase === 'failure') return 'border-error/30 bg-error/10 text-error'
    return 'border-primary/30 bg-primary/5 text-base-content'
  }
</script>

<aside class="h-full min-h-0 overflow-y-auto border-l border-base-300 bg-base-100" aria-label="Task Schedule details">
  <header class="flex min-h-16 items-start justify-between gap-3 border-b border-base-300 px-5 py-4">
    <div class="flex min-w-0 items-start gap-3">
      <span class="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><CalendarDays class="size-4" aria-hidden="true" /></span>
      <div class="min-w-0">
        <h2 class="truncate text-lg font-semibold">{schedule.title}</h2>
        <span class="mt-1 inline-flex items-center gap-1.5 text-sm font-medium">
          {#if status === 'Enabled'}
            <CheckCircle2 class="size-4 text-success" aria-hidden="true" /> Enabled
          {:else if status === 'Completed'}
            <CheckCircle2 class="size-4 text-success" aria-hidden="true" /> Completed
          {:else if status === 'Cancelled'}
            <CircleX class="size-4 text-error" aria-hidden="true" /> Cancelled
          {:else}
            <CirclePause class="size-4 text-warning" aria-hidden="true" /> Paused
          {/if}
        </span>
      </div>
    </div>
    <button class="btn btn-ghost btn-sm btn-square min-h-10 min-w-10" type="button" aria-label="Close Task Schedule details" onclick={onClose}>
      <X class="size-4" aria-hidden="true" />
    </button>
  </header>

  <div class="px-5 py-5">
    <section aria-labelledby="schedule-prompt-heading">
      <h3 id="schedule-prompt-heading" class="text-xs font-semibold uppercase tracking-wide text-secondary">Prompt</h3>
      <p class="mt-3 whitespace-pre-wrap text-sm leading-6 text-base-content">{schedule.prompt}</p>
    </section>

    <section class="mt-6 border-t border-base-300 pt-5" aria-labelledby="schedule-cadence-heading">
      <h3 id="schedule-cadence-heading" class="flex items-center gap-2 text-sm font-semibold">
        <CalendarDays class="size-4 text-secondary" aria-hidden="true" /> Task Schedule
      </h3>
      <dl class="mt-3 space-y-2 text-sm">
        <div class="flex justify-between gap-4"><dt class="text-secondary">Cadence</dt><dd class="text-right font-medium">{cadenceLabel(schedule)}</dd></div>
        {#if cadenceDescription(schedule)}
          <div class="flex justify-between gap-4"><dt class="text-secondary">Details</dt><dd class="max-w-52 text-right">{cadenceDescription(schedule)}</dd></div>
        {/if}
        <div class="flex justify-between gap-4"><dt class="text-secondary">Timezone</dt><dd class="text-right font-medium">{timezone}</dd></div>
        <div class="flex justify-between gap-4"><dt class="text-secondary">Next run</dt><dd class="text-right font-medium tabular-nums">{formatDate(nextScheduleFireAt(schedule))}</dd></div>
      </dl>
    </section>

    <section class="mt-6 border-t border-base-300 pt-5" aria-labelledby="schedule-mode-heading">
      <h3 id="schedule-mode-heading" class="flex items-center gap-2 text-sm font-semibold"><Play class="size-4 text-secondary" aria-hidden="true" /> Mode</h3>
      <p class="mt-3 text-sm font-medium">{schedule.mode === 'create-and-start' ? 'Create + start' : 'Create only'}</p>
      <p class="mt-1 text-xs leading-5 text-secondary">
        {schedule.mode === 'create-and-start'
          ? 'Creates a board Task and starts implementation when no previous scheduled Task is still open.'
          : 'Creates a board Task in the backlog for a manual start.'}
      </p>
    </section>

    <section class="mt-6 border-t border-base-300 pt-5" aria-labelledby="schedule-history-heading">
      <h3 id="schedule-history-heading" class="flex items-center gap-2 text-sm font-semibold"><Clock3 class="size-4 text-secondary" aria-hidden="true" /> Recent runs</h3>
      {#if history.length === 0}
        <p class="mt-3 text-sm text-secondary">No runs yet.</p>
      {:else}
        <ul class="mt-3 divide-y divide-base-300 rounded-box border border-base-300" aria-label="Recent run history">
          {#each history as outcome (outcome.id)}
            <li class="grid grid-cols-[minmax(0,1fr)_auto] gap-2 px-3 py-2.5 text-xs">
              <div class="min-w-0">
                {#if outcome.taskId}
                  <button class="rounded font-semibold text-primary hover:underline" type="button" onclick={() => onOpenTask(outcome.taskId!)}>{outcome.taskId}</button>
                {:else}
                  <span class="font-semibold">No Task created</span>
                {/if}
                <p class="mt-0.5 truncate text-secondary" title={outcome.message}>{outcome.message}</p>
              </div>
              <div class="text-right">
                <span class="inline-flex items-center gap-1 font-medium">
                  {#if outcome.status === 'started' || outcome.status === 'created'}
                    <CheckCircle2 class="size-3.5 text-success" aria-hidden="true" />
                  {:else if outcome.status === 'skipped'}
                    <TriangleAlert class="size-3.5 text-warning" aria-hidden="true" />
                  {:else}
                    <CircleX class="size-3.5 text-error" aria-hidden="true" />
                  {/if}
                  {resultLabel(outcome.status)}
                </span>
                <time class="mt-0.5 block text-secondary" datetime={new Date(outcome.firedAt).toISOString()}>{formatDate(outcome.firedAt)}</time>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  </div>

  <footer class="border-t border-base-300 p-4">
    {#if !terminal}
      <div class="grid grid-cols-3 gap-2">
      <button class="btn btn-primary min-h-10" type="button" disabled={busy} onclick={() => onRunNow(schedule.id)}>
        <Play class="size-4" aria-hidden="true" /> Run now
      </button>
      <button class="btn min-h-10" type="button" disabled={busy} onclick={() => onEdit(schedule)}>
        <Pencil class="size-4" aria-hidden="true" /> Edit
      </button>
      <button class="btn min-h-10" type="button" disabled={busy} onclick={() => onToggleEnabled(schedule)}>
        {#if updating}<span class="loading loading-spinner loading-xs" aria-hidden="true"></span> Updating…{:else if schedule.lifecycle.state === 'active' && schedule.lifecycle.enabled}<CirclePause class="size-4" aria-hidden="true" /> Pause{:else}<CheckCircle2 class="size-4" aria-hidden="true" /> Enable{/if}
      </button>
      </div>
    {/if}

    {#if runState}
      <div class={`mt-3 rounded-box border p-3 text-sm ${runStateClasses(runState)}`} role="status" aria-live="polite">
        <div class="flex items-center justify-between gap-3">
          <div>
            <p class="font-semibold">
              {runState.phase === 'running' ? 'Running now…'
                : runState.phase === 'cancelling' ? 'Cancelling…'
                : runState.phase === 'success' ? 'Run completed'
                : runState.phase === 'warning' ? 'Run completed with a warning'
                : runState.phase === 'failure' ? 'Run failed'
                : runState.phase === 'already-running' ? 'Already running'
                : 'Run cancelled'}
            </p>
            <p class="mt-0.5 text-xs opacity-80">{runState.message}</p>
          </div>
          {#if runState.phase === 'running'}
            <button class="btn btn-outline btn-sm min-h-9" type="button" onclick={() => onCancelRun(schedule.id)}>Cancel run</button>
          {/if}
        </div>
      </div>
    {/if}

    <div class="mt-4 border-t border-base-300 pt-3">
      <button class="btn btn-ghost min-h-10 w-full justify-start text-error" type="button" disabled={busy} onclick={() => onRequestDelete(schedule)}>
        <Trash2 class="size-4" aria-hidden="true" /> Delete Task Schedule
      </button>
    </div>
  </footer>
</aside>
