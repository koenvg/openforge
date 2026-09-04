<script lang="ts">
  import { ArrowDown, ArrowUp, CheckCircle2, CirclePause, CircleX, Clock3, TriangleAlert } from '@lucide/svelte'
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import Panel from '@openforge-app/plugin-sdk/ui/Panel.svelte'
  import PluginViewState from '@openforge-app/plugin-sdk/ui/PluginViewState.svelte'
  import type { TaskSchedule } from '../lib/types'
  import { nextScheduleFireAt, scheduleStatusLabel } from '../lib/taskSchedulesViewModel'
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
    { key: 'title', label: 'Task Schedule' },
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

<section class="min-w-0 flex-1 overflow-auto" aria-label="Task Schedules list">
  {#if loading && schedules.length === 0}
    <PluginViewState loading loadingLabel="Loading Task Schedules" />
  {:else if schedules.length === 0}
    <Panel class="schedule-list-empty" style="display: grid; min-height: 16rem; border-style: dashed; place-items: center">
      <div class="schedule-list-empty-content">
        <Clock3 class="size-8" aria-hidden="true" />
        <h3>No Task Schedules found</h3>
        <p>Use New Task Schedule to create a one-off or recurring Task Schedule.</p>
      </div>
    </Panel>
  {:else}
    <Panel class="schedule-table-panel">
      <table class="schedule-table" aria-label="Task Schedules">
        <thead>
          <tr class="schedule-table-header">
            {#each columns as column}
              <th aria-sort={sortKey === column.key ? sortDirection : 'none'}>
                <Button
                  class="schedule-sort-button"
                  style="justify-content: flex-start; padding-inline: var(--of-space1)"
                  variant="ghost"
                  size="sm"
                  type="button"
                  aria-label={`Sort by ${column.label}`}
                  onClick={() => onSort(column.key)}
                >
                  {column.label}
                  {#if sortKey === column.key}
                    {#if sortDirection === 'ascending'}
                      <ArrowUp class="size-3.5" aria-hidden="true" />
                    {:else}
                      <ArrowDown class="size-3.5" aria-hidden="true" />
                    {/if}
                  {/if}
                </Button>
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
              <td class="schedule-title-cell">
                <Button class="schedule-title-button" style="width: 100%; justify-content: flex-start; gap: var(--of-space3); padding-inline: 0; text-align: left" variant="ghost" size="sm" type="button" tabindex="-1" aria-label={schedule.title} onClick={() => onSelectSchedule(schedule)}>
                  <span class="schedule-icon"><Clock3 class="size-4" aria-hidden="true" /></span>
                  <span class="schedule-title-copy"><span>{schedule.title}</span><span>{schedule.prompt}</span></span>
                </Button>
              </td>
              <td class="text-sm">
                <span class="font-medium">{cadenceLabel(schedule)}</span>
                {#if schedule.timing.type === 'recurring' && schedule.timing.preset === 'custom'}
                  <span class="schedule-cron">{schedule.timing.cron}</span>
                {/if}
              </td>
              <td class="text-sm">{schedule.mode === 'create-and-start' ? 'Create + start' : 'Create only'}</td>
              <td class="whitespace-nowrap text-sm tabular-nums">{formatDate(nextScheduleFireAt(schedule))}</td>
              <td class="text-sm">
                <span class="inline-flex items-center gap-1.5 font-medium">
                  {#if !outcome}
                    <Clock3 class="size-4 status-muted" aria-hidden="true" />
                  {:else if outcome.status === 'started' || outcome.status === 'created'}
                    <CheckCircle2 class="size-4 status-success" aria-hidden="true" />
                  {:else if outcome.status === 'skipped'}
                    <TriangleAlert class="size-4 status-warning" aria-hidden="true" />
                  {:else}
                    <CircleX class="size-4 status-danger" aria-hidden="true" />
                  {/if}
                  {resultLabel(schedule)}
                </span>
                {#if outcome?.taskId}
                  <Button style="justify-content: flex-start; margin-top: var(--of-space1); padding-inline: 0; color: var(--of-link)" variant="ghost" size="xs" type="button" onClick={() => onOpenTask(outcome.taskId!)}>{outcome.taskId}</Button>
                {/if}
              </td>
              <td class="text-sm">
                <span class="inline-flex items-center gap-1.5 font-medium">
                  {#if status === 'Enabled'}
                    <CheckCircle2 class="size-4 status-success" aria-hidden="true" /> Enabled
                  {:else if status === 'Completed'}
                    <CheckCircle2 class="size-4 status-success" aria-hidden="true" /> Completed
                  {:else if status === 'Cancelled'}
                    <CircleX class="size-4 status-danger" aria-hidden="true" /> Cancelled
                  {:else}
                    <CirclePause class="size-4 status-warning" aria-hidden="true" /> Paused
                  {/if}
                </span>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </Panel>
  {/if}
</section>

<style>

  .schedule-list-empty-content {
    max-width: 24rem;
    text-align: center;
  }

  .schedule-list-empty-content :global(svg) {
    margin: 0 auto;
    color: var(--of-icon-muted);
  }

  .schedule-list-empty-content h3 {
    margin: var(--of-space3) 0 0;
    color: var(--of-text);
    font-size: var(--of-text-md);
    font-weight: var(--of-weight-semibold);
    line-height: var(--of-line-height-md);
  }

  .schedule-list-empty-content p {
    margin: var(--of-space1) 0 0;
    color: var(--of-text-muted);
    font-size: var(--of-text-sm);
    line-height: var(--of-line-height-sm);
  }

  :global(.schedule-table-panel) {
    overflow-x: auto;
  }

  .schedule-table {
    width: 100%;
    min-width: 47.5rem;
    border-collapse: collapse;
    color: var(--of-text);
    font-size: var(--of-text-sm);
    line-height: var(--of-line-height-sm);
  }

  .schedule-table th,
  .schedule-table td {
    padding: var(--of-space2) var(--of-space3);
    text-align: left;
  }

  .schedule-table-header {
    color: var(--of-text-muted);
    font-size: var(--of-text-xs);
    line-height: var(--of-line-height-xs);
  }

  tbody tr {
    border-top: var(--of-border-width) solid var(--of-border);
    cursor: pointer;
  }

  tbody tr:focus-visible {
    outline: var(--of-focus-width) solid var(--of-focus-ring);
    outline-offset: calc(-1 * var(--of-focus-width));
  }

  tbody tr.selected {
    background: var(--of-accent-subtle);
    box-shadow: inset var(--of-focus-width) 0 var(--of-accent);
  }

  tbody tr:hover {
    background: var(--of-surface-subtle);
  }

  .schedule-title-cell {
    max-width: 18rem;
  }


  .schedule-icon {
    display: grid;
    width: var(--of-control-height-compact);
    height: var(--of-control-height-compact);
    flex: none;
    border-radius: var(--of-radius-control);
    background: var(--of-accent-subtle);
    color: var(--of-on-accent-subtle);
    place-items: center;
  }

  .schedule-title-copy {
    min-width: 0;
  }

  .schedule-title-copy span {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .schedule-title-copy span:first-child {
    color: var(--of-text);
    font-weight: var(--of-weight-semibold);
  }

  .schedule-title-copy span:last-child,
  .schedule-cron {
    color: var(--of-text-muted);
    font-size: var(--of-text-xs);
    line-height: var(--of-line-height-xs);
  }

  .schedule-cron {
    display: block;
    max-width: 10rem;
    margin-top: var(--of-space1);
    overflow: hidden;
    font-family: var(--of-font-mono);
    text-overflow: ellipsis;
    white-space: nowrap;
  }


  .schedule-table :global(.status-muted) { color: var(--of-icon-muted); }
  .schedule-table :global(.status-success) { color: var(--of-status-success); }
  .schedule-table :global(.status-warning) { color: var(--of-status-warning); }
  .schedule-table :global(.status-danger) { color: var(--of-status-danger); }
</style>
