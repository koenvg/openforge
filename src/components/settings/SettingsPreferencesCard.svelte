<script lang="ts">
	import { Settings2 } from '@lucide/svelte'
	import SettingsSectionCard from './SettingsSectionCard.svelte'

	interface Props {
		isDarkMode: boolean
		onThemeToggle: () => void
		ghosttyTerminalStateEnabled: boolean
		onGhosttyTerminalStateChange: (enabled: boolean) => void
		disabled?: boolean
	}

	const {
		isDarkMode,
		onThemeToggle,
		ghosttyTerminalStateEnabled,
		onGhosttyTerminalStateChange,
		disabled = false,
	}: Props = $props()
</script>

<SettingsSectionCard id="section-preferences" title="Preferences">
	{#snippet icon()}<Settings2 size={16} />{/snippet}
	<div class="flex flex-col gap-4">
		<label class="flex items-center justify-between cursor-pointer">
			<div class="flex flex-col gap-0.5">
				<span class="text-sm text-base-content">Dark Mode</span>
				<span class="text-[0.7rem] text-base-content/50">Switch between light and dark theme</span>
			</div>
			<input
				type="checkbox"
				class="toggle toggle-primary toggle-sm"
				checked={isDarkMode}
				onchange={onThemeToggle}
				data-testid="theme-toggle"
			/>
		</label>

		<label class="flex items-center justify-between gap-4 cursor-pointer">
			<div class="flex flex-col gap-0.5">
				<span class="text-sm text-base-content">Ghostty terminal state <span class="badge badge-warning badge-xs">Experimental</span></span>
				<span class="text-[0.7rem] text-base-content/50">Use Ghostty-owned snapshots for new terminal sessions. Existing sessions keep their current mode.</span>
			</div>
			<input
				type="checkbox"
				class="toggle toggle-primary toggle-sm"
				checked={ghosttyTerminalStateEnabled}
				{disabled}
				onchange={(event) => onGhosttyTerminalStateChange(event.currentTarget.checked)}
				data-testid="ghostty-terminal-state-toggle"
			/>
		</label>
	</div>
</SettingsSectionCard>
