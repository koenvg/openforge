<script lang="ts">
	import { SlidersHorizontal } from '@lucide/svelte'
	import type { Snippet } from 'svelte'
	import { HIERARCHICAL_SETTINGS } from '../../lib/hierarchicalSettings'
	import type { SettingLevel } from '../../lib/hierarchicalSettings'

	interface Props {
		mode: 'global' | 'project'
		values: Record<string, string>
		pluginRows?: { id: string; name: string; enabled: boolean }[]
		onChange: (key: string, value: string) => void
		onPluginToggle?: (pluginId: string, enabled: boolean) => void
		onResetToGlobal?: () => void
		// Setting keys to hide in this card (e.g. keys owned by a dedicated control).
		excludeKeys?: string[]
		// Optional replacement for the default ai_provider select. When supplied the
		// card renders this snippet in place of the plain registry select so callers
		// (the project page) can surface the rich provider install/recovery UX while
		// the plain select stays the default (the global page).
		providerField?: Snippet
		disabled?: boolean
	}

	const {
		mode,
		values,
		pluginRows = [],
		onChange,
		onPluginToggle,
		onResetToGlobal,
		excludeKeys = [],
		providerField,
		disabled = false,
	}: Props = $props()

	const visibleSettings = $derived(
		HIERARCHICAL_SETTINGS.filter(
			(setting) =>
				setting.levels.includes(mode as SettingLevel) && !excludeKeys.includes(setting.key),
		),
	)

	// Explain what this card controls so users don't have to guess. On the global
	// page these values are the defaults every project inherits until it overrides
	// one; once a project overrides a setting, later changes here no longer reach it.
	const helperText = $derived(
		mode === 'global'
			? 'Default settings for every project. Projects use these automatically until you change a setting on a specific project — after that, the project keeps its own value and changes here no longer affect it.'
			: 'Settings inherited from your global defaults. Change one to override it for this project only — use ‘Default to global settings’ to go back to inheriting.',
	)

	function currentValue(key: string): string {
		return values[key] ?? ''
	}
</script>

<div id="section-configuration" class="rounded-lg border border-base-300 overflow-hidden" style="background-color: var(--project-bg, oklch(var(--b1)))">
	<div class="flex items-center justify-between gap-2 px-5 py-3 border-b border-base-300">
		<div class="flex items-center gap-2">
			<SlidersHorizontal size={16} />
			<h3 class="text-sm font-semibold text-base-content m-0">Configuration</h3>
		</div>
		{#if mode === 'project' && onResetToGlobal}
			<button
				type="button"
				class="btn btn-sm btn-ghost"
				disabled={disabled}
				onclick={onResetToGlobal}
				data-testid="reset-to-global"
			>
				Default to global settings
			</button>
		{/if}
	</div>

	<div class="p-5">
		{#if helperText}
			<p class="text-xs text-base-content/60 m-0 mb-4">{helperText}</p>
		{/if}
		<div class="flex flex-col gap-4">
			{#each visibleSettings as setting (setting.key)}
				{#if setting.control === 'toggle'}
					<label class="flex items-center justify-between cursor-pointer">
						<div class="flex flex-col gap-0.5">
							<span class="text-sm text-base-content">{setting.label}</span>
							<span class="text-[0.7rem] text-base-content/50">{setting.description}</span>
						</div>
						<input
							type="checkbox"
							class="toggle toggle-primary toggle-sm"
							checked={currentValue(setting.key) === 'true'}
							disabled={disabled}
							onchange={(e) => onChange(setting.key, e.currentTarget.checked ? 'true' : 'false')}
							data-testid={setting.key}
						/>
					</label>
				{:else if setting.control === 'select'}
					{#if setting.key === 'ai_provider' && providerField}
						<div class="flex flex-col gap-2">
							<div class="flex flex-col gap-0.5">
								<span class="text-sm text-base-content">{setting.label}</span>
								<span class="text-[0.7rem] text-base-content/50">{setting.description}</span>
							</div>
							{@render providerField()}
						</div>
					{:else}
						<label class="flex items-center justify-between gap-4">
							<div class="flex flex-col gap-0.5">
								<span class="text-sm text-base-content">{setting.label}</span>
								<span class="text-[0.7rem] text-base-content/50">{setting.description}</span>
							</div>
							<select
								class="select select-bordered select-sm"
								value={currentValue(setting.key)}
								disabled={disabled}
								onchange={(e) => onChange(setting.key, e.currentTarget.value)}
								data-testid={setting.key}
							>
								{#each setting.options ?? [] as option (option.value)}
									<option value={option.value}>{option.label}</option>
								{/each}
							</select>
						</label>
					{/if}
				{:else if setting.control === 'text'}
					<label class="flex flex-col gap-1">
						<span class="text-sm text-base-content">{setting.label}</span>
						<span class="text-[0.7rem] text-base-content/50">{setting.description}</span>
						<input
							type="text"
							class="input input-bordered input-sm w-full"
							value={currentValue(setting.key)}
							disabled={disabled}
							oninput={(e) => onChange(setting.key, e.currentTarget.value)}
							data-testid={setting.key}
						/>
					</label>
				{:else if setting.control === 'number'}
					<label class="flex flex-col gap-1">
						<span class="text-sm text-base-content">{setting.label}</span>
						<span class="text-[0.7rem] text-base-content/50">{setting.description}</span>
						<input
							type="number"
							class="input input-bordered input-sm w-full"
							value={currentValue(setting.key)}
							disabled={disabled}
							oninput={(e) => onChange(setting.key, e.currentTarget.value)}
							data-testid={setting.key}
						/>
					</label>
				{:else if setting.control === 'plugins'}
					<div class="flex flex-col gap-2">
						<div class="flex flex-col gap-0.5">
							<span class="text-sm text-base-content">{setting.label}</span>
							<span class="text-[0.7rem] text-base-content/50">{setting.description}</span>
						</div>
						{#if pluginRows.length === 0}
							<div class="text-[0.7rem] text-base-content/50">No plugins installed</div>
						{:else}
							<div class="flex flex-col gap-2 pl-1">
								{#each pluginRows as plugin (plugin.id)}
									<label class="flex items-center justify-between cursor-pointer">
										<span class="text-sm text-base-content">{plugin.name}</span>
										<input
											type="checkbox"
											class="toggle toggle-primary toggle-sm"
											role="switch"
											aria-label="Toggle plugin default: {plugin.name}"
											checked={plugin.enabled}
											disabled={disabled}
											onchange={(e) => onPluginToggle?.(plugin.id, e.currentTarget.checked)}
											data-testid="plugin-default-{plugin.id}"
										/>
									</label>
								{/each}
							</div>
						{/if}
					</div>
				{/if}
			{/each}
		</div>
	</div>
</div>
