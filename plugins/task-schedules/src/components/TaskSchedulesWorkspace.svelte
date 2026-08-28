<script lang="ts">
  import { CalendarClock, Plus } from '@lucide/svelte'
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
  let newScheduleButton = $state<HTMLButtonElement | null>(null)
  let handledFocusRequest = 0

  $effect(() => {
    const focusRequest = controller.newScheduleFocusRequest
    if (focusRequest === 0 || focusRequest === handledFocusRequest) return
    handledFocusRequest = focusRequest
    queueMicrotask(() => newScheduleButton?.focus())
  })
</script>

<PluginPageShell>
  {#snippet header()}
    <PluginPageHeader title="Task Schedules" subtitle="Manage one-off and recurring project Task Schedules">
      {#snippet actions()}
        {#if controller.projectId}
          <button bind:this={newScheduleButton} class="btn btn-primary min-h-10" type="button" onclick={controller.openNewSchedule}>
            <Plus class="size-4" aria-hidden="true" /> New Task Schedule
          </button>
        {/if}
      {/snippet}
    </PluginPageHeader>
  {/snippet}

  <div class="sr-only" role="status" aria-live="polite">{controller.announcement}</div>

  {#if !controller.projectId}
    <PluginViewState empty emptyTitle="Select a project to manage Task Schedules." />
  {:else}
    {#if controller.error}
      <div class="mx-5 mt-4 flex items-center justify-between gap-4 rounded-box border border-error/30 bg-error/10 px-4 py-3 text-sm text-error" role="alert" aria-live="assertive">
        <span>{controller.error}</span>
        <button class="btn btn-sm min-h-9" type="button" onclick={controller.retryLoad}>Retry</button>
      </div>
    {/if}

    <div class="flex min-h-0 flex-1">
      <main class="min-w-0 flex-1 overflow-auto px-5 py-5" aria-label="Task Schedules workspace">
        <div class="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div class="flex flex-wrap gap-3" aria-label="Task Schedule summary">
            <div class="min-w-28 rounded-box border border-base-300 bg-base-100 px-4 py-3"><strong class="block text-xl tabular-nums">{controller.schedules.length}</strong><span class="text-xs text-secondary">{controller.schedules.length === 1 ? 'Task Schedule' : 'Task Schedules'}</span></div>
            <div class="min-w-28 rounded-box border border-base-300 bg-base-100 px-4 py-3"><strong class="block text-xl tabular-nums">{controller.enabledCount}</strong><span class="text-xs text-secondary">enabled</span></div>
            <div class="flex min-w-48 items-center gap-3 rounded-box border border-base-300 bg-base-100 px-4 py-3"><CalendarClock class="size-5 text-secondary" aria-hidden="true" /><span><span class="block text-xs text-secondary">Next run</span><strong class="mt-0.5 block text-sm font-medium tabular-nums">{controller.nextRunAt === null ? 'None scheduled' : controller.formatDate(controller.nextRunAt)}</strong></span></div>
          </div>

          <div class="join rounded-box border border-base-300 bg-base-100 p-1" aria-label="Filter Task Schedules">
            <button class="btn join-item min-h-9 border-0 {controller.filter === 'all' ? 'btn-primary' : 'btn-ghost'}" type="button" aria-label="All Task Schedules" aria-pressed={controller.filter === 'all'} onclick={() => controller.setFilter('all')}>All</button>
            <button class="btn join-item min-h-9 border-0 {controller.filter === 'enabled' ? 'btn-primary' : 'btn-ghost'}" type="button" aria-label="Enabled Task Schedules" aria-pressed={controller.filter === 'enabled'} onclick={() => controller.setFilter('enabled')}>Enabled</button>
            <button class="btn join-item min-h-9 border-0 {controller.filter === 'paused' ? 'btn-primary' : 'btn-ghost'}" type="button" aria-label="Paused Task Schedules" aria-pressed={controller.filter === 'paused'} onclick={() => controller.setFilter('paused')}>Paused</button>
          </div>
        </div>

        {#if !controller.loading && controller.schedules.length > 0 && controller.visibleSchedules.length === 0}
          <div class="flex min-h-64 items-center justify-center rounded-box border border-dashed border-base-300 bg-base-100 p-8 text-center">
            <div><CalendarClock class="mx-auto size-8 text-secondary" aria-hidden="true" /><h3 class="mt-3 font-semibold">No matching Task Schedules</h3><p class="mt-1 text-sm text-secondary">Choose another status filter.</p></div>
          </div>
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
