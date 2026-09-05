<script lang="ts">
	import { Settings2 } from '@lucide/svelte'
	import { TERMINAL_FONT_OPTIONS } from '../../lib/terminalFont'
	import type { TerminalFontId } from '../../lib/terminalFont'
	import type { RegisteredTheme } from '../../lib/themeRegistry'
	import { MAX_TERMINAL_FONT_SIZE, MIN_TERMINAL_FONT_SIZE } from '../../lib/terminalFontSize'
	import SettingsSectionCard from './SettingsSectionCard.svelte'

	interface Props {
		availableThemes: readonly RegisteredTheme[]
		selectedThemeId: string
		onThemeChange: (themeId: string) => void
		terminalFont: TerminalFontId
		onTerminalFontChange: (font: TerminalFontId) => void
		terminalFontSize: number
		onTerminalFontSizeChange: (size: number) => void
	}

	const {
		availableThemes,
		selectedThemeId,
		onThemeChange,
		terminalFont,
		onTerminalFontChange,
		terminalFontSize,
		onTerminalFontSizeChange,
	}: Props = $props()

	const TERMINAL_FONT_DEMO = `$ write a paragraph of a fake book
● Marta counted the empty glasses on Sully's bar and decided
  the night wasn't going to get any better.
✻ Worked for 20s`

	function handleThemeChange(event: Event & { currentTarget: HTMLSelectElement }): void {
		const requestedThemeId = event.currentTarget.value
		// Keep the control on the committed theme while candidate CSS loads.
		event.currentTarget.value = selectedThemeId
		onThemeChange(requestedThemeId)
	}

	function handleTerminalFontChange(event: Event & { currentTarget: HTMLSelectElement }): void {
		onTerminalFontChange(event.currentTarget.value as TerminalFontId)
	}
</script>

<SettingsSectionCard id="section-preferences" title="Preferences">
	{#snippet icon()}<Settings2 size={16} />{/snippet}
	<div class="flex flex-col gap-4">
		<label class="flex items-center justify-between gap-4 cursor-pointer">
			<div class="flex flex-col gap-0.5">
				<span id="theme-label" class="text-sm text-base-content">Theme</span>
				<span id="theme-description" class="text-[0.7rem] text-base-content/50">Choose an application theme</span>
			</div>
			<select
				aria-labelledby="theme-label"
				aria-describedby="theme-description"
				class="select select-bordered select-sm min-w-56"
				value={selectedThemeId}
				onchange={handleThemeChange}
				data-testid="theme-select"
			>
				{#each availableThemes as theme (theme.id)}
					<option value={theme.id}>
						{theme.label} — {theme.owner.kind === 'builtin' ? 'Built in' : `Provided by ${theme.owner.pluginId}`}
					</option>
				{/each}
			</select>
		</label>

		<div class="flex flex-col gap-2">
			<label class="flex items-center justify-between gap-4 cursor-pointer">
				<div class="flex flex-col gap-0.5">
					<span class="text-sm text-base-content">Terminal font</span>
					<span class="text-[0.7rem] text-base-content/50">Font used by the Agent and Terminal panes (must be monospace)</span>
				</div>
				<select
					class="select select-bordered select-sm"
					value={terminalFont}
					onchange={handleTerminalFontChange}
					data-testid="terminal-font-select"
				>
					{#each TERMINAL_FONT_OPTIONS as font (font.id)}
						<option value={font.id} style="font-family: {font.fontFamily}">{font.label}</option>
					{/each}
				</select>
			</label>
			<p class="text-[0.7rem] text-base-content/50">
				{TERMINAL_FONT_OPTIONS.find((font) => font.id === terminalFont)?.description}
			</p>
			<pre
				class="m-0 overflow-x-auto rounded-lg border border-base-300 p-3 leading-relaxed"
				style="background: var(--of-agent-terminal-bg); color: var(--of-agent-terminal-text); font-family: {TERMINAL_FONT_OPTIONS.find((font) => font.id === terminalFont)?.fontFamily}; font-size: {terminalFontSize}px"
				data-testid="terminal-font-demo"
			>{TERMINAL_FONT_DEMO}</pre>
		</div>

		<label class="flex items-center justify-between gap-4 cursor-pointer">
			<div class="flex flex-col gap-0.5">
				<span class="text-sm text-base-content">Terminal font size</span>
				<span class="text-[0.7rem] text-base-content/50">Size of the font used by the Agent and Terminal panes</span>
			</div>
			<div class="flex items-center gap-2">
				<button
					type="button"
					class="btn btn-square btn-sm"
					disabled={terminalFontSize <= MIN_TERMINAL_FONT_SIZE}
					onclick={() => onTerminalFontSizeChange(terminalFontSize - 1)}
					data-testid="terminal-font-size-decrement"
					aria-label="Decrease terminal font size"
				>−</button>
				<span class="w-8 text-center text-sm tabular-nums" data-testid="terminal-font-size-value">{terminalFontSize}</span>
				<button
					type="button"
					class="btn btn-square btn-sm"
					disabled={terminalFontSize >= MAX_TERMINAL_FONT_SIZE}
					onclick={() => onTerminalFontSizeChange(terminalFontSize + 1)}
					data-testid="terminal-font-size-increment"
					aria-label="Increase terminal font size"
				>+</button>
			</div>
		</label>
	</div>
</SettingsSectionCard>
