<script lang="ts">
	import { Settings2, Minus, Plus } from '@lucide/svelte'
	import Select from '@openforge-app/plugin-sdk/ui/Select.svelte'
	import IconButton from '@openforge-app/plugin-sdk/ui/IconButton.svelte'
	import Panel from '@openforge-app/plugin-sdk/ui/Panel.svelte'
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

	const generatedId = $props.id()
	const descriptionId = `theme-description-${generatedId}`

	const themeOptions = $derived(availableThemes.map((theme) => ({
		value: theme.id,
		label: `${theme.label} — ${theme.owner.kind === 'builtin' ? 'Built in' : `Provided by ${theme.owner.pluginId}`}`,
	})))
	const fontOptions = TERMINAL_FONT_OPTIONS.map((font) => ({ value: font.id, label: font.label }))
	const TERMINAL_FONT_DEMO = `$ write a paragraph of a fake book
● Marta counted the empty glasses on Sully's bar and decided
  the night wasn't going to get any better.
✻ Worked for 20s`
</script>

<SettingsSectionCard id="section-preferences" title="Preferences">
	{#snippet icon()}<Settings2 size={16} />{/snippet}
	<div class="flex flex-col gap-4">
		<div class="flex items-center justify-between gap-4">
			<div class="flex flex-col gap-0.5">
				<span class="text-sm">Theme</span>
				<span id={descriptionId} class="text-[0.7rem] text-[var(--of-text-muted)]">Choose an application theme</span>
			</div>
			<!-- Keep the committed theme visible while candidate stylesheets load. -->
			<Select label="Theme" hideLabel options={themeOptions} bind:value={() => selectedThemeId, onThemeChange}
				aria-describedby={descriptionId} class="settings-layout min-w-0 max-w-full" testId="theme-select" />
		</div>
		<div class="flex flex-col gap-2">
			<div class="flex items-center justify-between gap-4">
				<div class="flex flex-col gap-0.5">
					<span class="text-sm">Terminal font</span>
					<span class="text-[0.7rem] text-[var(--of-text-muted)]">Font used by the Agent and Terminal panes (must be monospace)</span>
				</div>
				<Select label="Terminal font" hideLabel options={fontOptions} value={terminalFont}
					onValueChange={(value) => onTerminalFontChange(value as TerminalFontId)} testId="terminal-font-select" />
			</div>
			<p class="text-[0.7rem] text-[var(--of-text-muted)]">
				{TERMINAL_FONT_OPTIONS.find((font) => font.id === terminalFont)?.description}
			</p>
			<Panel padding="none">
				<pre class="m-0 overflow-x-auto p-3 leading-relaxed"
					style="background: var(--of-agent-terminal-bg); color: var(--of-agent-terminal-text); font-family: {TERMINAL_FONT_OPTIONS.find((font) => font.id === terminalFont)?.fontFamily}; font-size: {terminalFontSize}px"
					data-testid="terminal-font-demo">{TERMINAL_FONT_DEMO}</pre>
			</Panel>
		</div>
		<div class="flex items-center justify-between gap-4">
			<div class="flex flex-col gap-0.5">
				<span class="text-sm text-[var(--of-text)]">Terminal font size</span>
				<span class="text-[0.7rem] text-[var(--of-text-muted)]">Size of the font used by the Agent and Terminal panes</span>
			</div>
			<div class="flex items-center gap-2">
				<IconButton label="Decrease terminal font size" size="sm" disabled={terminalFontSize <= MIN_TERMINAL_FONT_SIZE}
					onClick={() => onTerminalFontSizeChange(terminalFontSize - 1)} data-testid="terminal-font-size-decrement"><Minus size={16} /></IconButton>
				<span class="settings-layout w-8 text-center text-sm tabular-nums" data-testid="terminal-font-size-value">{terminalFontSize}</span>
				<IconButton label="Increase terminal font size" size="sm" disabled={terminalFontSize >= MAX_TERMINAL_FONT_SIZE}
					onClick={() => onTerminalFontSizeChange(terminalFontSize + 1)} data-testid="terminal-font-size-increment"><Plus size={16} /></IconButton>
			</div>
		</div>
	</div>
</SettingsSectionCard>
