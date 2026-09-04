<script lang="ts">
  import { CalendarClock, Plus } from '@lucide/svelte'
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import Panel from '@openforge-app/plugin-sdk/ui/Panel.svelte'
  import PluginPageHeader from '@openforge-app/plugin-sdk/ui/PluginPageHeader.svelte'
  import PluginPageShell from '@openforge-app/plugin-sdk/ui/PluginPageShell.svelte'
  import PluginViewState from '@openforge-app/plugin-sdk/ui/PluginViewState.svelte'
  import ResizablePanel from '@openforge-app/plugin-sdk/ui/ResizablePanel.svelte'
  import TaskScheduleComposerSection from './TaskScheduleComposerSection.svelte'
  import TaskScheduleInspector from './TaskScheduleInspector.svelte'
  import TaskSchedulesListSection from './TaskSchedulesListSection.svelte'
  import type { TaskSchedulesController } from './taskSchedulesController.svelte'

  interface Props {
    controller: TaskSchedulesController
  }

  let { controller }: Props = $props()
  const newScheduleButtonId = 'new-task-schedule'
  let handledFocusRequest = 0

  $effect(() => {
    const focusRequest = controller.newScheduleFocusRequest
    if (focusRequest === 0 || focusRequest === handledFocusRequest) return
    handledFocusRequest = focusRequest
    queueMicrotask(() => document.getElementById(newScheduleButtonId)?.focus())
  })
</script>

<PluginPageShell>
  {#snippet header()}
    <PluginPageHeader title="Task Schedules" subtitle="Manage one-off and recurring project Task Schedules">
      {#snippet actions()}
        {#if controller.projectId}
          <Button id={newScheduleButtonId} type="button" onClick={controller.openNewSchedule}>
            <Plus class="size-4" aria-hidden="true" /> New Task Schedule
          </Button>
        {/if}
      {/snippet}
    </PluginPageHeader>
  {/snippet}

  <div class="sr-only" role="status" aria-live="polite">{controller.announcement}</div>

  {#if !controller.projectId}
    <PluginViewState empty emptyTitle="Select a project to manage Task Schedules." />
  {:else}
    {#if controller.error}
      <div class="schedule-load-error" role="alert" aria-live="assertive">
        <span>{controller.error}</span>
        <Button variant="secondary" size="sm" type="button" onClick={controller.retryLoad}>Retry</Button>
      </div>
    {/if}

    <div class="flex min-h-0 flex-1">
      <main class="min-w-0 flex-1 overflow-auto px-5 py-5" aria-label="Task Schedules workspace">
        <div class="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div class="schedule-summary" aria-label="Task Schedule summary">
            <Panel class="schedule-summary-card">
              <div class="schedule-summary-card-content">
                <strong>{controller.schedules.length}</strong>
                <span>{controller.schedules.length === 1 ? 'Task Schedule' : 'Task Schedules'}</span>
              </div>
            </Panel>
            <Panel class="schedule-summary-card">
              <div class="schedule-summary-card-content">
                <strong>{controller.enabledCount}</strong>
                <span>enabled</span>
              </div>
            </Panel>
            <Panel class="schedule-summary-card schedule-summary-next">
              <div class="schedule-summary-next-content">
                <CalendarClock class="size-5" aria-hidden="true" />
                <span><span>Next run</span><strong>{controller.nextRunAt === null ? 'None scheduled' : controller.formatDate(controller.nextRunAt)}</strong></span>
              </div>
            </Panel>
          </div>

          <div class="schedule-filters" aria-label="Filter Task Schedules">
            <Button variant={controller.filter === 'all' ? 'primary' : 'ghost'} size="sm" type="button" aria-label="All Task Schedules" aria-pressed={controller.filter === 'all'} onClick={() => controller.setFilter('all')}>All</Button>
            <Button variant={controller.filter === 'enabled' ? 'primary' : 'ghost'} size="sm" type="button" aria-label="Enabled Task Schedules" aria-pressed={controller.filter === 'enabled'} onClick={() => controller.setFilter('enabled')}>Enabled</Button>
            <Button variant={controller.filter === 'paused' ? 'primary' : 'ghost'} size="sm" type="button" aria-label="Paused Task Schedules" aria-pressed={controller.filter === 'paused'} onClick={() => controller.setFilter('paused')}>Paused</Button>
          </div>
        </div>

        {#if !controller.loading && controller.schedules.length > 0 && controller.visibleSchedules.length === 0}
          <Panel class="schedule-empty" style="display: grid; min-height: 16rem; border-style: dashed; place-items: center">
            <div class="schedule-empty-content"><CalendarClock class="size-8" aria-hidden="true" /><h3>No matching Task Schedules</h3><p>Choose another status filter.</p></div>
          </Panel>
        {:else}
          <TaskSchedulesListSection
            loading={controller.loading}
            schedules={controller.visibleSchedules}
            selectedScheduleId={controller.selectedScheduleId}
            sortKey={controller.sortKey}
            sortDirection={controller.sortDirection}
            onSelectSchedule={controller.selectSchedule}
            onSort={controller.handleSort}
            onOpenTask={controller.openTask}
            cadenceLabel={controller.cadenceLabel}
            formatDate={controller.formatDate}
          />
        {/if}
      </main>

      {#if controller.panelMode === 'details' && controller.selectedSchedule}
        <ResizablePanel storageKey="task-schedules-inspector" defaultWidth={430} minWidth={340} maxWidth={620} side="right" label="Task Schedule details">
          <TaskScheduleInspector
            schedule={controller.selectedSchedule}
            runState={controller.runState?.scheduleId === controller.selectedSchedule.id ? controller.runState : null}
            updating={controller.updatingScheduleId === controller.selectedSchedule.id}
            timezone={controller.timezone}
            cadenceLabel={controller.cadenceLabel}
            cadenceDescription={controller.cadenceDescription}
            formatDate={controller.formatDate}
            onClose={controller.requestClosePanel}
            onRunNow={(scheduleId) => { void controller.runNow(scheduleId) }}
            onCancelRun={(scheduleId) => { void controller.cancelRun(scheduleId) }}
            onEdit={controller.editSchedule}
            onToggleEnabled={(schedule) => { void controller.toggleSchedule(schedule) }}
            onRequestDelete={controller.requestDelete}
            onOpenTask={controller.openTask}
          />
        </ResizablePanel>
      {:else if controller.panelMode === 'form'}
        <ResizablePanel storageKey="task-schedules-form" defaultWidth={460} minWidth={360} maxWidth={640} side="right" label="Task Schedule form">
          <TaskScheduleComposerSection
            draft={controller.draft}
            fieldErrors={controller.fieldErrors}
            timeOptions={controller.timeOptions}
            dayOfWeekOptions={controller.dayOfWeekOptions}
            composerTitle={controller.composerTitle}
            enabledToggleLabel={controller.enabledToggleLabel}
            saving={controller.saving}
            cronHelpText={controller.cronHelpText}
            titleFocusRequest={controller.titleFocusRequest}
            errorFocusRequest={controller.errorFocusRequest}
            onDraftChange={controller.handleDraftChange}
            onFieldErrorsChange={controller.setFieldErrors}
            onValidateDraft={() => { controller.validateDraft() }}
            onSaveSchedule={() => { void controller.saveSchedule() }}
            onClose={controller.requestClosePanel}
          />
        </ResizablePanel>
      {/if}
    </div>
  {/if}
</PluginPageShell>

<style>
  .schedule-load-error {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--of-space4);
    margin: var(--of-space4) var(--of-space5) 0;
    padding: var(--of-space3) var(--of-space4);
    border: var(--of-border-width) solid var(--of-danger);
    border-radius: var(--of-radius-container);
    background: var(--of-danger-subtle);
    color: var(--of-danger);
    font-size: var(--of-text-sm);
    line-height: var(--of-line-height-sm);
  }

  .schedule-summary {
    display: flex;
    flex-wrap: wrap;
    gap: var(--of-space3);
  }

  :global(.schedule-summary-card) {
    min-width: 7rem;
  }

  .schedule-summary-card-content strong,
  .schedule-summary-card-content span,
  .schedule-summary-next-content > span,
  .schedule-summary-next-content > span > span,
  .schedule-summary-next-content strong {
    display: block;
  }

  .schedule-summary-card-content strong {
    color: var(--of-text);
    font-size: var(--of-text-xl);
    font-variant-numeric: tabular-nums;
    line-height: var(--of-line-height-xl);
  }

  .schedule-summary-card-content span,
  .schedule-summary-next-content > span > span {
    color: var(--of-text-muted);
    font-size: var(--of-text-xs);
    line-height: var(--of-line-height-xs);
  }

  :global(.schedule-summary-next) {
    min-width: 12rem;
  }

  .schedule-summary-next-content {
    display: flex;
    align-items: center;
    gap: var(--of-space3);
    color: var(--of-icon-muted);
  }

  .schedule-summary-next-content strong {
    margin-top: var(--of-space1);
    color: var(--of-text);
    font-size: var(--of-text-sm);
    font-weight: var(--of-weight-medium);
    font-variant-numeric: tabular-nums;
    line-height: var(--of-line-height-sm);
  }

  .schedule-filters {
    display: flex;
    gap: var(--of-space1);
    padding: var(--of-space1);
    border: var(--of-border-width) solid var(--of-border);
    border-radius: var(--of-radius-container);
    background: var(--of-surface);
  }


  .schedule-empty-content {
    text-align: center;
  }

  .schedule-empty-content :global(svg) {
    margin: 0 auto;
    color: var(--of-icon-muted);
  }

  .schedule-empty-content h3 {
    margin: var(--of-space3) 0 0;
    color: var(--of-text);
    font-size: var(--of-text-md);
    font-weight: var(--of-weight-semibold);
    line-height: var(--of-line-height-md);
  }

  .schedule-empty-content p {
    margin: var(--of-space1) 0 0;
    color: var(--of-text-muted);
    font-size: var(--of-text-sm);
    line-height: var(--of-line-height-sm);
  }
</style>
