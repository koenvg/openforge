<script lang="ts">
	import { FlaskConical } from '@lucide/svelte'
	import SettingsSectionCard from './SettingsSectionCard.svelte'

	interface Props {
		codeCleanupTasksEnabled: boolean
		taskDisplayTitleMetadataUpdatesEnabled: boolean
		onCodeCleanupTasksToggle: () => void
		onTaskDisplayTitleMetadataUpdatesToggle: () => void
		disabled: boolean
	}

	const { codeCleanupTasksEnabled, taskDisplayTitleMetadataUpdatesEnabled, onCodeCleanupTasksToggle, onTaskDisplayTitleMetadataUpdatesToggle, disabled }: Props = $props()
</script>

<SettingsSectionCard id="section-experimental" title="Experimental" {disabled}>
	{#snippet icon()}<FlaskConical size={16} />{/snippet}
	<div class="flex flex-col gap-4">
			<label class="flex items-center justify-between cursor-pointer">
				<div class="flex flex-col gap-0.5">
					<span class="text-sm text-base-content">Code Cleanup Tasks</span>
					<span class="text-[0.7rem] text-base-content/50">Agents create tasks for code that needs cleanup or splitting</span>
				</div>
				<input
					type="checkbox"
					class="toggle toggle-primary toggle-sm"
					checked={codeCleanupTasksEnabled}
					disabled={disabled}
					onchange={onCodeCleanupTasksToggle}
					data-testid="code-cleanup-tasks-toggle"
				/>
			</label>

			<label class="flex items-center justify-between cursor-pointer">
				<div class="flex flex-col gap-0.5">
					<span class="text-sm text-base-content">Task Display Title Updates</span>
					<span class="text-[0.7rem] text-base-content/50">Generate Task Display Titles from agent activity metadata</span>
				</div>
				<input
					type="checkbox"
					class="toggle toggle-primary toggle-sm"
					checked={taskDisplayTitleMetadataUpdatesEnabled}
					disabled={disabled}
					onchange={onTaskDisplayTitleMetadataUpdatesToggle}
					data-testid="task-display-title-metadata-updates-toggle"
				/>
			</label>
	</div>
</SettingsSectionCard>
