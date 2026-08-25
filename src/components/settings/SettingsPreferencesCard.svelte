<script lang="ts">
	import { Settings2 } from '@lucide/svelte'
	import SettingsSectionCard from './SettingsSectionCard.svelte'

	interface Props {
		isDarkMode: boolean
		onThemeToggle: () => void
		ghosttyTerminalDiagnosticsEnabled: boolean
		onGhosttyTerminalDiagnosticsChange: (enabled: boolean) => void
		disabled?: boolean
	}

	const {
		isDarkMode,
		onThemeToggle,
		ghosttyTerminalDiagnosticsEnabled,
		onGhosttyTerminalDiagnosticsChange,
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
				<span class="text-sm text-base-content">Ghostty terminal diagnostics <span class="badge badge-warning badge-xs">Experimental</span></span>
				<span class="text-[0.7rem] text-base-content/50">Observe PTY bytes with Ghostty for diagnostics. xterm remains the state and query-response authority.</span>
			</div>
			<input
				type="checkbox"
				class="toggle toggle-primary toggle-sm"
				checked={ghosttyTerminalDiagnosticsEnabled}
				{disabled}
				onchange={(event) => onGhosttyTerminalDiagnosticsChange(event.currentTarget.checked)}
				data-testid="ghostty-terminal-diagnostics-toggle"
			/>
		</label>
	</div>
</SettingsSectionCard>
