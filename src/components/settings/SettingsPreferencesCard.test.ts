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
		it('associates the caller-owned theme description with the selector', () => {
			render(SettingsPreferencesCard, { props: defaultProps() })
			expect(screen.getByRole('button', { name: 'Theme', description: 'Choose an application theme' })).toBeTruthy()
		})

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

		it('lists registry themes with provider attribution', async () => {
			render(SettingsPreferencesCard, {
				props: defaultProps({ availableThemes: themes, selectedThemeId: 'openforge-light' }),
			})

			const select = screen.getByRole('button', { name: 'Theme' })
			await fireEvent.keyDown(select, { key: 'ArrowDown' })
			expect(screen.getAllByRole('option').map((option) => option.textContent?.trim())).toEqual([
				'OpenForge Light — Built in',
				'OpenForge Dark — Built in',
				'Paper — Provided by com.example.paper',
			])
		})

		it('selects a theme with the keyboard and keeps focus on the selector', async () => {
			const onThemeChange = vi.fn()
			render(SettingsPreferencesCard, { props: defaultProps({ availableThemes: themes, onThemeChange }) })
			const select = screen.getByRole('button', { name: 'Theme' })
			select.focus()
			await fireEvent.keyDown(select, { key: 'ArrowDown' })
			await screen.findByRole('option', { name: /OpenForge Dark/ })
			await fireEvent.keyDown(select, { key: 'ArrowDown' })
			await fireEvent.keyDown(select, { key: 'Enter' })
			expect(onThemeChange).toHaveBeenCalledWith(DARK_THEME.id)
			expect(document.activeElement).toBe(select)
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

			await fireEvent.keyDown(screen.getByRole('button', { name: 'Theme' }), { key: 'ArrowDown' })
			await fireEvent.pointerUp(screen.getByRole('option', { name: /Paper/ }), { button: 0 })

			expect(onThemeChange).toHaveBeenCalledWith('com.example.paper:paper')
		})

		it('reflects a changed registry snapshot without remounting', async () => {
			const view = render(SettingsPreferencesCard, {
				props: defaultProps({ availableThemes: themes, selectedThemeId: 'com.example.paper:paper' }),
			})
			const select = screen.getByRole('button', { name: 'Theme' })
			expect(select.textContent).toContain('Paper')

			await view.rerender(defaultProps({
				availableThemes: themes.slice(0, 2),
				selectedThemeId: 'openforge-light',
			}))

			expect(select.textContent).toContain('OpenForge Light')
			expect(screen.queryByRole('option', { name: /Paper/ })).toBeNull()
		})
	})

	describe('terminal font picker', () => {
		it('renders all curated terminal font options', async () => {
			render(SettingsPreferencesCard, { props: defaultProps() })

			await fireEvent.keyDown(screen.getByRole('button', { name: 'Terminal font' }), { key: 'ArrowDown' })
			const optionValues = screen.getAllByRole('option').map((option) => option.textContent?.trim())
			expect(optionValues).toEqual([
				'JetBrains Mono (default)',
				'IBM Plex Mono',
				'Cascadia Code',
				'VT323 (exotic)',
				'Martian Mono',
				'Overpass Mono',
				'Courier Prime',
				'Space Mono',
			])
		})

		it('reflects the current terminalFont prop', () => {
			render(SettingsPreferencesCard, {
				props: defaultProps({ terminalFont: 'vt323' }),
			})

			expect(screen.getByRole('button', { name: 'Terminal font' }).textContent).toContain('VT323')
		})

		it('calls onTerminalFontChange when a different font is selected', async () => {
			const onTerminalFontChange = vi.fn()
			render(SettingsPreferencesCard, {
				props: defaultProps({ onTerminalFontChange }),
			})

			await fireEvent.keyDown(screen.getByRole('button', { name: 'Terminal font' }), { key: 'ArrowDown' })
			await fireEvent.pointerUp(screen.getByRole('option', { name: 'VT323 (exotic)' }), { button: 0 })

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
