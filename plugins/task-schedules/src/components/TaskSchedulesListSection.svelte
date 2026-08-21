<script lang="ts">
  import { ArrowDown, ArrowUp, CheckCircle2, CirclePause, CircleX, Clock3, TriangleAlert } from '@lucide/svelte'
  import PluginViewState from '@openforge-app/plugin-sdk/ui/PluginViewState.svelte'
  import type { TaskSchedule } from '../lib/types'
  import { scheduleStatusLabel } from '../lib/taskSchedulesViewModel'
  import type { ScheduleSortKey, SortDirection } from '../lib/viewTypes'

  interface Props {
    loading: boolean
    schedules: TaskSchedule[]
    selectedScheduleId: string | null
    sortKey: ScheduleSortKey
    sortDirection: SortDirection
    onSelectSchedule: (schedule: TaskSchedule) => void
    onSort: (key: ScheduleSortKey) => void
    onOpenTask: (taskId: string) => void
    cadenceLabel: (schedule: TaskSchedule) => string
    formatDate: (value: number | null) => string
  }

  let {
    loading,
    schedules,
    selectedScheduleId,
    sortKey,
    sortDirection,
    onSelectSchedule,
    onSort,
    onOpenTask,
    cadenceLabel,
    formatDate,
  }: Props = $props()

  const columns: { key: ScheduleSortKey; label: string }[] = [
    { key: 'title', label: 'Schedule' },
    { key: 'cadence', label: 'Cadence' },
    { key: 'mode', label: 'Mode' },
    { key: 'nextFireAt', label: 'Next run' },
    { key: 'lastResult', label: 'Last result' },
    { key: 'status', label: 'Status' },
  ]

  function latestOutcome(schedule: TaskSchedule) {
    return schedule.history.at(-1) ?? null
  }

  function resultLabel(schedule: TaskSchedule): string {
    const outcome = latestOutcome(schedule)
    if (!outcome) return 'No runs yet'
    if (outcome.status === 'started') return 'Started'
    if (outcome.status === 'created') return 'Created'
    if (outcome.status === 'skipped') return 'Warning'
    if (outcome.status === 'cancelled') return 'Cancelled'
    return 'Failed'
  }

  function isInteractiveTarget(target: EventTarget | null): boolean {
    return target instanceof Element && target.closest('button, a, input, select, textarea') !== null
  }

  function handleRowClick(event: MouseEvent, schedule: TaskSchedule): void {
    if (isInteractiveTarget(event.target)) return
    onSelectSchedule(schedule)
  }

  function handleRowKeydown(event: KeyboardEvent, schedule: TaskSchedule): void {
    if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    onSelectSchedule(schedule)
  }
</script>

<section class="min-w-0 flex-1 overflow-auto" aria-label="Task schedules list">
  {#if loading && schedules.length === 0}
    <PluginViewState loading loadingLabel="Loading Task Schedules" />
  {:else if schedules.length === 0}
    <div class="flex min-h-64 items-center justify-center rounded-box border border-dashed border-base-300 bg-base-100 p-8">
      <div class="max-w-sm text-center">
        <Clock3 class="mx-auto size-8 text-secondary" aria-hidden="true" />
        <h3 class="mt-3 text-base font-semibold">No schedules found</h3>
        <p class="mt-1 text-sm text-secondary">Use New schedule to create a recurring project task, or adjust your search and filters.</p>
      </div>
    </div>
  {:else}
    <div class="overflow-x-auto rounded-box border border-base-300 bg-base-100">
      <table class="table table-sm w-full min-w-[760px]" aria-label="Task schedules">
        <thead>
          <tr class="border-base-300 text-xs text-secondary">
            {#each columns as column}
              <th aria-sort={sortKey === column.key ? sortDirection : 'none'}>
                <button
                  class="inline-flex min-h-10 items-center gap-1 rounded-md px-1 font-semibold text-base-content hover:text-primary"
                  type="button"
                  aria-label={`Sort by ${column.label.toLowerCase()}`}
                  onclick={() => onSort(column.key)}
                >
                  {column.label}
                  {#if sortKey === column.key}
                    {#if sortDirection === 'ascending'}
                      <ArrowUp class="size-3.5" aria-hidden="true" />
                    {:else}
                      <ArrowDown class="size-3.5" aria-hidden="true" />
                    {/if}
                  {/if}
                </button>
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each schedules as schedule (schedule.id)}
            {@const outcome = latestOutcome(schedule)}
            {@const status = scheduleStatusLabel(schedule)}
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions a11y_no_noninteractive_tabindex -->
            <tr
              class:selected={selectedScheduleId === schedule.id}
              aria-selected={selectedScheduleId === schedule.id}
              aria-label={`Select ${schedule.title}`}
              tabindex="0"
              onclick={(event) => handleRowClick(event, schedule)}
              onkeydown={(event) => handleRowKeydown(event, schedule)}
            >
              <td class="max-w-72 py-3">
                <button class="flex w-full items-center gap-3 rounded-md text-left" type="button" tabindex="-1" aria-label={schedule.title} onclick={() => onSelectSchedule(schedule)}>
                  <span class="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Clock3 class="size-4" aria-hidden="true" /></span>
                  <span class="min-w-0"><span class="block truncate text-sm font-semibold text-base-content">{schedule.title}</span><span class="mt-0.5 block truncate text-xs text-secondary">{schedule.prompt}</span></span>
                </button>
              </td>
              <td class="text-sm">
                <span class="font-medium">{cadenceLabel(schedule)}</span>
                {#if schedule.kind === 'recurring' && schedule.preset === 'custom' && schedule.cron}
                  <span class="mt-0.5 block max-w-40 truncate font-mono text-xs text-secondary">{schedule.cron}</span>
                {/if}
              </td>
              <td class="text-sm">{schedule.mode === 'create-and-start' ? 'Create + start' : 'Create only'}</td>
              <td class="whitespace-nowrap text-sm tabular-nums">{formatDate(schedule.nextFireAt)}</td>
              <td class="text-sm">
                <span class="inline-flex items-center gap-1.5 font-medium">
                  {#if !outcome}
                    <Clock3 class="size-4 text-secondary" aria-hidden="true" />
                  {:else if outcome.status === 'started' || outcome.status === 'created'}
                    <CheckCircle2 class="size-4 text-success" aria-hidden="true" />
                  {:else if outcome.status === 'skipped'}
                    <TriangleAlert class="size-4 text-warning" aria-hidden="true" />
                  {:else}
                    <CircleX class="size-4 text-error" aria-hidden="true" />
                  {/if}
                  {resultLabel(schedule)}
                </span>
                {#if outcome?.taskId}
                  <button class="mt-0.5 block rounded text-xs font-medium text-primary hover:underline" type="button" onclick={() => onOpenTask(outcome.taskId!)}>{outcome.taskId}</button>
                {/if}
              </td>
              <td class="text-sm">
                <span class="inline-flex items-center gap-1.5 font-medium">
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
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>

<style>
  tbody tr {
    border-color: var(--of-divider);
    cursor: pointer;
  }

  tbody tr:focus-visible {
    outline: 2px solid var(--of-focus);
    outline-offset: -2px;
  }

  tbody tr.selected {
    background: color-mix(in srgb, var(--color-primary) 7%, var(--of-surface));
    box-shadow: inset 3px 0 var(--color-primary);
  }

  tbody tr:hover {
    background: color-mix(in srgb, var(--color-primary) 4%, var(--of-surface));
  }
</style>
