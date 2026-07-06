<script lang="ts">
  import PluginViewState from '@openforge-app/plugin-sdk/ui/PluginViewState.svelte'
  import type { TaskSchedule } from '../lib/types'

  interface Props {
    loading: boolean
    schedules: TaskSchedule[]
    runningScheduleId: string | null
    deletingScheduleId: string | null
    confirmingDeleteId: string | null
    onEditSchedule: (schedule: TaskSchedule) => void
    onDeleteSchedule: (schedule: TaskSchedule) => void
    onRunNow: (scheduleId: string) => void
    onConfirmDelete: (scheduleId: string | null) => void
    runNowDescription: (schedule: TaskSchedule) => string
    schedulePresetLabel: (schedule: TaskSchedule) => string
    scheduleHumanDescription: (schedule: TaskSchedule) => string | null
    formatDate: (value: number | null) => string
  }

  let {
    loading,
    schedules,
    runningScheduleId,
    deletingScheduleId,
    confirmingDeleteId,
    onEditSchedule,
    onDeleteSchedule,
    onRunNow,
    onConfirmDelete,
    runNowDescription,
    schedulePresetLabel,
    scheduleHumanDescription,
    formatDate,
  }: Props = $props()
</script>

<section class="min-w-0 space-y-3" aria-label="Task schedules list">
  {#if loading && schedules.length === 0}
    <PluginViewState loading loadingLabel="Loading Task Schedules" />
  {:else if schedules.length === 0}
    <PluginViewState
      empty
      emptyTitle="No Task Schedules yet"
      emptyDescription="Create the first project-scoped Task Schedule with the composer."
    />
  {:else}
    {#each schedules as schedule (schedule.id)}
      <article class="rounded-box border border-base-300 bg-base-100 px-3 py-4 shadow-sm">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 class="text-lg font-semibold">{schedule.title}</h2>
            <p class="mt-1 line-clamp-3 whitespace-pre-wrap text-sm text-base-content/70">{schedule.prompt}</p>
          </div>
          <div class="badge {schedule.enabled ? 'badge-success' : 'badge-ghost'}">
            {schedule.enabled ? 'Enabled' : 'Disabled'}
          </div>
        </div>

        <dl class="mt-4 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt class="text-base-content/60">Schedule Preset</dt>
            <dd class="font-medium">{schedulePresetLabel(schedule)}</dd>
            {#if scheduleHumanDescription(schedule)}
              <dd class="text-xs text-base-content/60">{scheduleHumanDescription(schedule)}</dd>
            {/if}
          </div>
          <div>
            <dt class="text-base-content/60">Mode</dt>
            <dd class="font-medium">{schedule.mode === 'create-and-start' ? 'Create + start' : 'Create only'}</dd>
          </div>
          <div>
            <dt class="text-base-content/60">Next Scheduled Fire</dt>
            <dd class="font-medium">{formatDate(schedule.nextFireAt)}</dd>
          </div>
          <div>
            <dt class="text-base-content/60">Last scheduled Task</dt>
            <dd class="font-medium">{schedule.lastTaskId ?? 'None'}</dd>
          </div>
        </dl>

        <p class="mt-3 text-xs leading-relaxed text-base-content/60">{runNowDescription(schedule)}</p>

        {#if schedule.history.length > 0}
          <div class="mt-4 rounded-box bg-base-200 p-3">
            <h3 class="text-sm font-semibold">Recent Scheduled Fires</h3>
            <ul class="mt-2 space-y-1 text-xs text-base-content/70">
              {#each [...schedule.history].reverse() as outcome (outcome.id)}
                <li>{formatDate(outcome.firedAt)} · {outcome.status} · {outcome.message}</li>
              {/each}
            </ul>
          </div>
        {/if}

        <div class="mt-4 flex flex-wrap gap-2">
          <button class="btn btn-primary btn-sm" type="button" disabled={runningScheduleId === schedule.id || deletingScheduleId === schedule.id} onclick={() => onRunNow(schedule.id)}>
            {runningScheduleId === schedule.id ? 'Running now…' : 'Run now'}
          </button>
          <button class="btn btn-sm" type="button" disabled={runningScheduleId === schedule.id || deletingScheduleId === schedule.id} onclick={() => onEditSchedule(schedule)}>Edit</button>
          {#if confirmingDeleteId === schedule.id}
            <span class="inline-flex flex-wrap items-center gap-2 rounded-box bg-base-200 px-2 py-1 text-sm" role="group" aria-label="Confirm delete Task Schedule">
              <span>Delete this Task Schedule?</span>
              <button class="btn btn-error btn-xs" type="button" disabled={deletingScheduleId === schedule.id} onclick={() => onDeleteSchedule(schedule)}>
                {deletingScheduleId === schedule.id ? 'Deleting…' : 'Confirm delete'}
              </button>
              <button class="btn btn-ghost btn-xs" type="button" disabled={deletingScheduleId === schedule.id} onclick={() => onConfirmDelete(null)}>Cancel</button>
            </span>
          {:else}
            <button class="btn btn-ghost btn-sm" type="button" disabled={runningScheduleId === schedule.id || deletingScheduleId === schedule.id} onclick={() => onConfirmDelete(schedule.id)}>Delete</button>
          {/if}
        </div>
      </article>
    {/each}
  {/if}
</section>
