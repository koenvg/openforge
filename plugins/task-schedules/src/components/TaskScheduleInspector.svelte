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
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import IconButton from '@openforge-app/plugin-sdk/ui/IconButton.svelte'
  import Panel from '@openforge-app/plugin-sdk/ui/Panel.svelte'
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

  function runStateVariant(state: ScheduleRunState): 'success' | 'warning' | 'danger' | 'info' {
    if (state.phase === 'success') return 'success'
    if (state.phase === 'warning' || state.phase === 'already-running') return 'warning'
    if (state.phase === 'failure') return 'danger'
    return 'info'
  }
</script>

<Panel class="schedule-inspector" role="complementary" aria-label="Task Schedule details">
  {#snippet header()}
    <header class="schedule-inspector-header">
      <div class="schedule-inspector-heading">
        <span class="schedule-inspector-icon"><CalendarDays class="size-4" aria-hidden="true" /></span>
        <div>
          <h2>{schedule.title}</h2>
          <span class="schedule-status">
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
        </div>
      </div>
      <IconButton label="Close Task Schedule details" type="button" onClick={onClose}>
        <X class="size-4" aria-hidden="true" />
      </IconButton>
    </header>
  {/snippet}

  <div class="schedule-inspector-content">
    <section class="schedule-detail-section" aria-labelledby="schedule-prompt-heading">
      <h3 id="schedule-prompt-heading" class="schedule-eyebrow">Prompt</h3>
      <p class="schedule-prompt">{schedule.prompt}</p>
    </section>

    <section class="schedule-detail-section" aria-labelledby="schedule-cadence-heading">
      <h3 id="schedule-cadence-heading"><CalendarDays class="size-4" aria-hidden="true" /> Task Schedule</h3>
      <dl>
        <div><dt>Cadence</dt><dd>{cadenceLabel(schedule)}</dd></div>
        {#if cadenceDescription(schedule)}
          <div><dt>Details</dt><dd>{cadenceDescription(schedule)}</dd></div>
        {/if}
        <div><dt>Timezone</dt><dd>{timezone}</dd></div>
        <div><dt>Next run</dt><dd class="schedule-date">{formatDate(nextScheduleFireAt(schedule))}</dd></div>
      </dl>
    </section>

    <section class="schedule-detail-section" aria-labelledby="schedule-mode-heading">
      <h3 id="schedule-mode-heading"><Play class="size-4" aria-hidden="true" /> Mode</h3>
      <p class="schedule-mode">{schedule.mode === 'create-and-start' ? 'Create + start' : 'Create only'}</p>
      <p class="schedule-help">
        {schedule.mode === 'create-and-start'
          ? 'Creates a board Task and starts implementation when no previous scheduled Task is still open.'
          : 'Creates a board Task in the backlog for a manual start.'}
      </p>
    </section>

    <section class="schedule-detail-section" aria-labelledby="schedule-history-heading">
      <h3 id="schedule-history-heading"><Clock3 class="size-4" aria-hidden="true" /> Recent runs</h3>
      {#if history.length === 0}
        <p class="schedule-help schedule-history-empty">No runs yet.</p>
      {:else}
        <ul class="schedule-history" aria-label="Recent run history">
          {#each history as outcome (outcome.id)}
            <li>
              <div>
                {#if outcome.taskId}
                  <Button style="justify-content: flex-start; padding-inline: 0; color: var(--of-link)" variant="ghost" size="xs" type="button" onClick={() => onOpenTask(outcome.taskId!)}>{outcome.taskId}</Button>
                {:else}
                  <span class="schedule-history-missing">No Task created</span>
                {/if}
                <p title={outcome.message}>{outcome.message}</p>
              </div>
              <div class="schedule-history-result">
                <span>
                  {#if outcome.status === 'started' || outcome.status === 'created'}
                    <CheckCircle2 class="size-3.5 status-success" aria-hidden="true" />
                  {:else if outcome.status === 'skipped'}
                    <TriangleAlert class="size-3.5 status-warning" aria-hidden="true" />
                  {:else}
                    <CircleX class="size-3.5 status-danger" aria-hidden="true" />
                  {/if}
                  {resultLabel(outcome.status)}
                </span>
                <time datetime={new Date(outcome.firedAt).toISOString()}>{formatDate(outcome.firedAt)}</time>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  </div>

  {#snippet footer()}
    <footer class="schedule-inspector-footer">
      {#if !terminal}
        <div class="schedule-actions">
          <Button type="button" disabled={busy} onClick={() => onRunNow(schedule.id)}>
            <Play class="size-4" aria-hidden="true" /> Run now
          </Button>
          <Button variant="secondary" type="button" disabled={busy} onClick={() => onEdit(schedule)}>
            <Pencil class="size-4" aria-hidden="true" /> Edit
          </Button>
          <Button variant="secondary" type="button" disabled={busy} onClick={() => onToggleEnabled(schedule)}>
            {#if updating}<span class="schedule-spinner" aria-hidden="true"></span> Updating…{:else if schedule.lifecycle.state === 'active' && schedule.lifecycle.enabled}<CirclePause class="size-4" aria-hidden="true" /> Pause{:else}<CheckCircle2 class="size-4" aria-hidden="true" /> Enable{/if}
          </Button>
        </div>
      {/if}

      {#if runState}
        <div class="schedule-run-state" data-variant={runStateVariant(runState)} role="status" aria-live="polite">
          <div>
            <div>
              <p>
                {runState.phase === 'running' ? 'Running now…'
                  : runState.phase === 'cancelling' ? 'Cancelling…'
                  : runState.phase === 'success' ? 'Run completed'
                  : runState.phase === 'warning' ? 'Run completed with a warning'
                  : runState.phase === 'failure' ? 'Run failed'
                  : runState.phase === 'already-running' ? 'Already running'
                  : 'Run cancelled'}
              </p>
              <p>{runState.message}</p>
            </div>
            {#if runState.phase === 'running'}
              <Button variant="outline" size="sm" type="button" onClick={() => onCancelRun(schedule.id)}>Cancel run</Button>
            {/if}
          </div>
        </div>
      {/if}

      <div class="schedule-delete-action">
        <Button style="width: 100%; justify-content: flex-start" variant="danger" type="button" disabled={busy} onClick={() => onRequestDelete(schedule)}>
          <Trash2 class="size-4" aria-hidden="true" /> Delete Task Schedule
        </Button>
      </div>
    </footer>
  {/snippet}
</Panel>

<style>
  :global(.schedule-inspector) {
    height: 100%;
    min-height: 0;
    overflow-y: auto;
  }

  .schedule-inspector-header,
  .schedule-inspector-heading,
  .schedule-status,
  .schedule-detail-section h3,
  .schedule-history-result span,
  .schedule-run-state > div {
    display: flex;
    align-items: center;
  }

  .schedule-inspector-header {
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--of-space3);
  }

  .schedule-inspector-heading {
    min-width: 0;
    align-items: flex-start;
    gap: var(--of-space3);
  }

  .schedule-inspector-heading > div {
    min-width: 0;
  }

  .schedule-inspector-icon {
    display: grid;
    width: var(--of-control-height);
    height: var(--of-control-height);
    flex: none;
    border-radius: var(--of-radius-control);
    background: var(--of-accent-subtle);
    color: var(--of-on-accent-subtle);
    place-items: center;
  }

  .schedule-inspector-heading h2 {
    overflow: hidden;
    margin: 0;
    color: var(--of-text);
    font-size: var(--of-text-lg);
    font-weight: var(--of-weight-semibold);
    line-height: var(--of-line-height-lg);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .schedule-status {
    gap: var(--of-space2);
    margin-top: var(--of-space1);
    color: var(--of-text);
    font-size: var(--of-text-sm);
    font-weight: var(--of-weight-medium);
    line-height: var(--of-line-height-sm);
  }

  .schedule-inspector-content {
    color: var(--of-text);
  }

  .schedule-detail-section + .schedule-detail-section {
    margin-top: var(--of-space6);
    padding-top: var(--of-space5);
    border-top: var(--of-border-width) solid var(--of-border);
  }

  .schedule-eyebrow {
    color: var(--of-text-muted);
    font-family: var(--of-font-mono);
    font-size: var(--of-text-xs);
    font-weight: var(--of-weight-semibold);
    line-height: var(--of-line-height-xs);
    text-transform: uppercase;
  }

  .schedule-prompt {
    margin: var(--of-space3) 0 0;
    color: var(--of-text);
    font-size: var(--of-text-sm);
    line-height: var(--of-line-height-md);
    white-space: pre-wrap;
  }

  .schedule-detail-section h3 {
    gap: var(--of-space2);
    margin: 0;
    color: var(--of-text);
    font-size: var(--of-text-sm);
    font-weight: var(--of-weight-semibold);
    line-height: var(--of-line-height-sm);
  }

  .schedule-detail-section h3 :global(svg) {
    color: var(--of-icon-muted);
  }

  .schedule-detail-section dl {
    display: grid;
    gap: var(--of-space2);
    margin: var(--of-space3) 0 0;
    font-size: var(--of-text-sm);
    line-height: var(--of-line-height-sm);
  }

  .schedule-detail-section dl div {
    display: flex;
    justify-content: space-between;
    gap: var(--of-space4);
  }

  .schedule-detail-section dt,
  .schedule-help,
  .schedule-history p,
  .schedule-history time {
    color: var(--of-text-muted);
  }

  .schedule-detail-section dd {
    max-width: 13rem;
    margin: 0;
    font-weight: var(--of-weight-medium);
    text-align: right;
  }

  .schedule-date {
    font-variant-numeric: tabular-nums;
  }

  .schedule-mode {
    margin: var(--of-space3) 0 0;
    font-size: var(--of-text-sm);
    font-weight: var(--of-weight-medium);
    line-height: var(--of-line-height-sm);
  }

  .schedule-help {
    margin: var(--of-space1) 0 0;
    font-size: var(--of-text-xs);
    line-height: var(--of-line-height-md);
  }

  .schedule-history-empty {
    margin-top: var(--of-space3);
    font-size: var(--of-text-sm);
  }

  .schedule-history {
    margin: var(--of-space3) 0 0;
    padding: 0;
    border: var(--of-border-width) solid var(--of-border);
    border-radius: var(--of-radius-container);
    list-style: none;
  }

  .schedule-history li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--of-space2);
    padding: var(--of-space2) var(--of-space3);
    font-size: var(--of-text-xs);
    line-height: var(--of-line-height-xs);
  }

  .schedule-history li + li {
    border-top: var(--of-border-width) solid var(--of-border);
  }

  .schedule-history li > div:first-child {
    min-width: 0;
  }

  .schedule-history-missing {
    font-weight: var(--of-weight-semibold);
  }

  .schedule-history p {
    overflow: hidden;
    margin: var(--of-space1) 0 0;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .schedule-history-result {
    text-align: right;
  }

  .schedule-history-result span {
    justify-content: flex-end;
    gap: var(--of-space1);
    font-weight: var(--of-weight-medium);
  }

  .schedule-history-result time {
    display: block;
    margin-top: var(--of-space1);
  }


  .schedule-inspector-footer {
    display: grid;
    gap: var(--of-space3);
  }

  .schedule-actions {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--of-space2);
  }

  .schedule-run-state {
    padding: var(--of-space3);
    border: var(--of-border-width) solid;
    border-radius: var(--of-radius-container);
    font-size: var(--of-text-sm);
    line-height: var(--of-line-height-sm);
  }

  .schedule-run-state[data-variant='success'] {
    border-color: var(--of-success);
    background: var(--of-success-subtle);
    color: var(--of-success);
  }

  .schedule-run-state[data-variant='warning'] {
    border-color: var(--of-warning);
    background: var(--of-warning-subtle);
    color: var(--of-warning);
  }

  .schedule-run-state[data-variant='danger'] {
    border-color: var(--of-danger);
    background: var(--of-danger-subtle);
    color: var(--of-danger);
  }

  .schedule-run-state[data-variant='info'] {
    border-color: var(--of-info);
    background: var(--of-info-subtle);
    color: var(--of-info);
  }

  .schedule-run-state > div {
    justify-content: space-between;
    gap: var(--of-space3);
  }

  .schedule-run-state p {
    margin: 0;
  }

  .schedule-run-state p:first-child {
    font-weight: var(--of-weight-semibold);
  }

  .schedule-run-state p + p {
    margin-top: var(--of-space1);
    font-size: var(--of-text-xs);
    opacity: 0.8;
  }

  .schedule-delete-action {
    padding-top: var(--of-space3);
    border-top: var(--of-border-width) solid var(--of-border);
  }


  .schedule-spinner {
    box-sizing: border-box;
    width: var(--of-space4);
    height: var(--of-space4);
    border: var(--of-border-width) solid currentColor;
    border-right-color: transparent;
    border-radius: var(--of-radius-round);
    animation: schedule-spin var(--of-duration-deliberate) linear infinite;
  }

  :global(.schedule-inspector .status-success) { color: var(--of-status-success); }
  :global(.schedule-inspector .status-warning) { color: var(--of-status-warning); }
  :global(.schedule-inspector .status-danger) { color: var(--of-status-danger); }

  @media (prefers-reduced-motion: reduce) {
    .schedule-spinner { animation-duration: 1ms; }
  }

  @keyframes schedule-spin {
    to { transform: rotate(360deg); }
  }
</style>
