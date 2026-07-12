<script lang="ts">
	import { Settings2 } from '@lucide/svelte'
	import {
		MAX_GITHUB_POLL_INTERVAL_SECONDS,
		MIN_GITHUB_POLL_INTERVAL_SECONDS,
		parseGitHubPollIntervalSeconds,
	} from '../../lib/settingsConfig'
	import SettingsSectionCard from './SettingsSectionCard.svelte'

	interface Props {
		taskIdPrefix: string
		onTaskIdPrefixChange: (value: string) => void
		isDarkMode: boolean
		onThemeToggle: () => void
		githubPollInterval: number
		onGithubPollIntervalChange: (value: number) => void
		disabled: boolean
	}

	const { taskIdPrefix, onTaskIdPrefixChange, isDarkMode, onThemeToggle, githubPollInterval, onGithubPollIntervalChange, disabled }: Props = $props()

	// Sanitize input: strip non-alphanumeric, uppercase, max 5 chars
	function handleInput(e: Event) {
		if (!(e.currentTarget instanceof HTMLInputElement)) return
		const raw = e.currentTarget.value
		const sanitized = raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 5)
		onTaskIdPrefixChange(sanitized)
	}

	function handlePollIntervalInput(e: Event) {
		if (!(e.currentTarget instanceof HTMLInputElement)) return
		onGithubPollIntervalChange(parseGitHubPollIntervalSeconds(e.currentTarget.value))
	}

	const isValid = $derived(
		taskIdPrefix.length >= 1 && taskIdPrefix.length <= 5 && /^[A-Z0-9]+$/.test(taskIdPrefix)
	)
	const nextTaskNumber = $derived(1)
	const previewTaskId = $derived(isValid ? `${taskIdPrefix}-${nextTaskNumber}` : '')
</script>

<SettingsSectionCard id="section-preferences" title="Preferences" {disabled}>
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

		<div class="border-b border-base-300"></div>

			<label class="flex flex-col gap-1">
				<span class="text-[0.7rem] text-base-content/50">Task ID Prefix</span>
				<input
					type="text"
					value={taskIdPrefix}
					oninput={handleInput}
					placeholder="e.g. ABC"
					maxlength="5"
					disabled={disabled}
					class="input input-bordered input-sm w-full {!isValid && taskIdPrefix.length > 0
						? 'input-error'
						: ''}"
				/>
			</label>

			{#if !isValid && taskIdPrefix.length > 0}
				<p class="text-xs text-error">Task ID prefix must be 1-5 alphanumeric characters</p>
			{/if}

		{#if isValid}
			<div class="bg-base-200 rounded px-3 py-2">
				<p class="text-xs text-base-content/70">
					New tasks will be created as <span class="font-semibold">{previewTaskId}</span>,
					<span class="font-semibold">{taskIdPrefix}-2</span>, etc.
				</p>
			</div>
		{/if}

		<div class="border-b border-base-300"></div>

		<div class="flex flex-col gap-1">
			<span class="text-sm text-base-content">GitHub Poll Interval</span>
			<span class="text-[0.7rem] text-base-content/50">How often to check GitHub for updates (seconds)</span>
			<input
				type="number"
				min={String(MIN_GITHUB_POLL_INTERVAL_SECONDS)}
				max={String(MAX_GITHUB_POLL_INTERVAL_SECONDS)}
				step="5"
				value={githubPollInterval}
				data-testid="poll-interval-input"
				disabled={disabled}
				class="input input-bordered input-sm w-full"
				oninput={handlePollIntervalInput}
			/>
			<p class="text-xs text-base-content/70">Polls every {githubPollInterval} seconds</p>
		</div>
	</div>
</SettingsSectionCard>
