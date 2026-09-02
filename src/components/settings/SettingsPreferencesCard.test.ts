import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi } from 'vitest'
import { DARK_THEME, LIGHT_THEME } from '../../lib/themeContract'
import type { RegisteredTheme } from '../../lib/themeRegistry'
import { requireElement } from '../../test-utils/dom'
import { MAX_TERMINAL_FONT_SIZE, MIN_TERMINAL_FONT_SIZE } from '../../lib/terminalFontSize'
import SettingsPreferencesCard from './SettingsPreferencesCard.svelte'

const builtinThemes: readonly RegisteredTheme[] = [
	{ ...LIGHT_THEME, owner: { kind: 'builtin' } },
	{ ...DARK_THEME, owner: { kind: 'builtin' } },
]

function defaultProps(overrides: Record<string, unknown> = {}) {
	return {
		availableThemes: builtinThemes,
		selectedThemeId: LIGHT_THEME.id,
		onThemeChange: vi.fn(),
		terminalFont: 'jetbrains-mono',
		onTerminalFontChange: vi.fn(),
		terminalFontSize: 13,
		onTerminalFontSizeChange: vi.fn(),
		...overrides,
	}
}

describe('SettingsPreferencesCard', () => {
	it('renders Preferences heading', () => {
		render(SettingsPreferencesCard, { props: defaultProps() })

		expect(screen.getByText('Preferences')).toBeTruthy()
	})

	describe('theme selector', () => {
		const themes: readonly RegisteredTheme[] = [
			{ ...LIGHT_THEME, owner: { kind: 'builtin' } },
			{ ...DARK_THEME, owner: { kind: 'builtin' } },
			{
				...LIGHT_THEME,
				id: 'com.example.paper:paper',
				label: 'Paper',
				owner: { kind: 'plugin', pluginId: 'com.example.paper', generation: 2 },
			},
		]

		it('lists registry themes with provider attribution', () => {
			render(SettingsPreferencesCard, {
				props: defaultProps({ availableThemes: themes, selectedThemeId: 'openforge-light' }),
			})

			const select = requireElement(screen.getByRole('combobox', { name: 'Theme' }), HTMLSelectElement)
			expect(Array.from(select.options).map((option) => option.textContent)).toEqual([
				'OpenForge Light — Built in',
				'OpenForge Dark — Built in',
				'Paper — Provided by com.example.paper',
			])
		})

		it('selects a registry theme by stable id', async () => {
			const onThemeChange = vi.fn()
			render(SettingsPreferencesCard, {
				props: defaultProps({
					availableThemes: themes,
					selectedThemeId: 'openforge-light',
					onThemeChange,
				}),
			})

			await fireEvent.change(screen.getByRole('combobox', { name: 'Theme' }), {
				target: { value: 'com.example.paper:paper' },
			})

			expect(onThemeChange).toHaveBeenCalledWith('com.example.paper:paper')
		})

		it('reflects a changed registry snapshot without remounting', async () => {
			const view = render(SettingsPreferencesCard, {
				props: defaultProps({ availableThemes: themes, selectedThemeId: 'com.example.paper:paper' }),
			})
			const select = requireElement(screen.getByRole('combobox', { name: 'Theme' }), HTMLSelectElement)
			expect(select.value).toBe('com.example.paper:paper')

			await view.rerender(defaultProps({
				availableThemes: themes.slice(0, 2),
				selectedThemeId: 'openforge-light',
			}))

			expect(select.value).toBe('openforge-light')
			expect(screen.queryByRole('option', { name: /Paper/ })).toBeNull()
		})
	})

	describe('terminal font picker', () => {
		it('renders all curated terminal font options', () => {
			render(SettingsPreferencesCard, { props: defaultProps() })

			const select = requireElement(screen.getByTestId('terminal-font-select'), HTMLSelectElement)
			const optionValues = Array.from(select.options).map((option) => option.value)
			expect(optionValues).toEqual([
				'jetbrains-mono',
				'ibm-plex-mono',
				'cascadia-code',
				'vt323',
				'martian-mono',
				'overpass-mono',
				'courier-prime',
				'space-mono',
			])
		})

		it('reflects the current terminalFont prop', () => {
			render(SettingsPreferencesCard, {
				props: defaultProps({ terminalFont: 'vt323' }),
			})

			const select = requireElement(screen.getByTestId('terminal-font-select'), HTMLSelectElement)
			expect(select.value).toBe('vt323')
		})

		it('calls onTerminalFontChange when a different font is selected', async () => {
			const onTerminalFontChange = vi.fn()
			render(SettingsPreferencesCard, {
				props: defaultProps({ onTerminalFontChange }),
			})

			const select = screen.getByTestId('terminal-font-select')
			await fireEvent.change(select, { target: { value: 'vt323' } })

			expect(onTerminalFontChange).toHaveBeenCalledWith('vt323')
		})

		it('renders a demo preview styled with the selected terminal font', () => {
			render(SettingsPreferencesCard, {
				props: defaultProps({ terminalFont: 'vt323' }),
			})

			const demo = requireElement(screen.getByTestId('terminal-font-demo'), HTMLElement)
			expect(demo.style.fontFamily).toContain('VT323')
		})
	})

	describe('terminal font size stepper', () => {
		it('displays the current terminalFontSize prop', () => {
			render(SettingsPreferencesCard, {
				props: defaultProps({ terminalFontSize: 16 }),
			})

			expect(screen.getByTestId('terminal-font-size-value').textContent).toBe('16')
		})

		it('calls onTerminalFontSizeChange with size + 1 when the increment button is clicked', async () => {
			const onTerminalFontSizeChange = vi.fn()
			render(SettingsPreferencesCard, {
				props: defaultProps({ terminalFontSize: 13, onTerminalFontSizeChange }),
			})

			await fireEvent.click(screen.getByTestId('terminal-font-size-increment'))

			expect(onTerminalFontSizeChange).toHaveBeenCalledWith(14)
		})

		it('calls onTerminalFontSizeChange with size - 1 when the decrement button is clicked', async () => {
			const onTerminalFontSizeChange = vi.fn()
			render(SettingsPreferencesCard, {
				props: defaultProps({ terminalFontSize: 13, onTerminalFontSizeChange }),
			})

			await fireEvent.click(screen.getByTestId('terminal-font-size-decrement'))

			expect(onTerminalFontSizeChange).toHaveBeenCalledWith(12)
		})

		it('disables the decrement button at the minimum size', () => {
			render(SettingsPreferencesCard, {
				props: defaultProps({ terminalFontSize: MIN_TERMINAL_FONT_SIZE }),
			})

			const decrement = requireElement(screen.getByTestId('terminal-font-size-decrement'), HTMLButtonElement)
			expect(decrement.disabled).toBe(true)
		})

		it('disables the increment button at the maximum size', () => {
			render(SettingsPreferencesCard, {
				props: defaultProps({ terminalFontSize: MAX_TERMINAL_FONT_SIZE }),
			})

			const increment = requireElement(screen.getByTestId('terminal-font-size-increment'), HTMLButtonElement)
			expect(increment.disabled).toBe(true)
		})

		it('renders a demo preview sized to the selected terminal font size', () => {
			render(SettingsPreferencesCard, {
				props: defaultProps({ terminalFontSize: 20 }),
			})

			const demo = requireElement(screen.getByTestId('terminal-font-demo'), HTMLElement)
			expect(demo.style.fontSize).toBe('20px')
		})
	})

	it('does not expose terminal authority as a user preference', () => {
		render(SettingsPreferencesCard, { props: defaultProps() })

		expect(screen.queryByText('Ghostty terminal model')).toBeNull()
		expect(screen.queryByTestId('ghostty-terminal-state-toggle')).toBeNull()
	})
})
