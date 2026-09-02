import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi } from 'vitest'
import { requireElement } from '../../test-utils/dom'
import { MAX_TERMINAL_FONT_SIZE, MIN_TERMINAL_FONT_SIZE } from '../../lib/terminalFontSize'
import SettingsPreferencesCard from './SettingsPreferencesCard.svelte'

function defaultProps(overrides: Record<string, unknown> = {}) {
	return {
		isDarkMode: false,
		onThemeToggle: vi.fn(),
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

	describe('dark mode toggle', () => {
		it('renders Dark Mode label', () => {
			render(SettingsPreferencesCard, { props: defaultProps() })

			expect(screen.getByText('Dark Mode')).toBeTruthy()
		})

		it('renders toggle unchecked when isDarkMode is false', () => {
			render(SettingsPreferencesCard, {
				props: defaultProps({ isDarkMode: false }),
			})

			const toggle = requireElement(screen.getByTestId('theme-toggle'), HTMLInputElement)
			expect(toggle.checked).toBe(false)
		})

		it('renders toggle checked when isDarkMode is true', () => {
			render(SettingsPreferencesCard, {
				props: defaultProps({ isDarkMode: true }),
			})

			const toggle = requireElement(screen.getByTestId('theme-toggle'), HTMLInputElement)
			expect(toggle.checked).toBe(true)
		})

		it('calls onThemeToggle when toggle is clicked', async () => {
			const onThemeToggle = vi.fn()
			render(SettingsPreferencesCard, {
				props: defaultProps({ onThemeToggle }),
			})

			const toggle = screen.getByTestId('theme-toggle')
			await fireEvent.click(toggle)

			expect(onThemeToggle).toHaveBeenCalledOnce()
		})

		it('renders description text', () => {
			render(SettingsPreferencesCard, { props: defaultProps() })

			expect(screen.getByText('Switch between light and dark theme')).toBeTruthy()
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
