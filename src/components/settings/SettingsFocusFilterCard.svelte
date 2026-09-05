<script lang="ts">
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
	import { ListFilter } from '@lucide/svelte';
	import Checkbox from '@openforge-app/plugin-sdk/ui/Checkbox.svelte';
	import type { TaskState } from '../../lib/taskState';
	import { TASK_STATE_LABELS } from '../../lib/taskStatePresentation';
	import { DEFAULT_FOCUS_STATES, FOCUS_FILTER_STATES } from '../../lib/boardFilters';
	import SettingsSectionCard from './SettingsSectionCard.svelte';

	interface Props {
		focusStates: TaskState[];
		onFocusStatesChange: (states: TaskState[]) => void;
		disabled: boolean;
	}

	const { focusStates, onFocusStatesChange, disabled }: Props = $props();

	function toggleState(state: TaskState, checked: boolean) {
		if (disabled) return;

		const updated = checked
			? [...focusStates, state]
			: focusStates.filter((s) => s !== state);
		onFocusStatesChange(updated);
	}

	function resetToDefault() {
		if (disabled) return;
		onFocusStatesChange(DEFAULT_FOCUS_STATES);
	}
</script>

<SettingsSectionCard id="section-focus-filter" title="Focus Filter States" {disabled}>
	{#snippet icon()}<ListFilter size={16} />{/snippet}
	<div class="flex flex-col gap-3">
		<p class="text-xs text-[var(--of-text-muted)]">Choose which task states appear in the "Focus" filter chip on the board.</p>

		<div class="flex flex-col gap-1">
			{#each FOCUS_FILTER_STATES as state}
				<label class="flex items-center gap-2 cursor-pointer">
					<Checkbox
						checked={focusStates.includes(state)}
						disabled={disabled}
						onchange={(e) => toggleState(state, e.currentTarget.checked)}
					/>
					<span class="text-sm text-[var(--of-text)]">{TASK_STATE_LABELS[state]}</span>
				</label>
			{/each}
		</div>

		<Button
			variant="ghost" size="sm"
			disabled={disabled}
			onclick={resetToDefault}
		>
			Reset to Default
		</Button>
	</div>
</SettingsSectionCard>
