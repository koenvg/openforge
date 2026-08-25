import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi } from 'vitest'
import { requireElement } from '../../test-utils/dom'
import SettingsPreferencesCard from './SettingsPreferencesCard.svelte'

function defaultProps(overrides: Record<string, unknown> = {}) {
	return {
		isDarkMode: false,
		onThemeToggle: vi.fn(),
		ghosttyTerminalDiagnosticsEnabled: false,
		onGhosttyTerminalDiagnosticsChange: vi.fn(),
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

	describe('Ghostty terminal diagnostics', () => {
		it('offers the experimental diagnostic model disabled by default', async () => {
			const onGhosttyTerminalDiagnosticsChange = vi.fn()
			render(SettingsPreferencesCard, {
				props: defaultProps({ onGhosttyTerminalDiagnosticsChange }),
			})

			const toggle = requireElement(
				screen.getByTestId('ghostty-terminal-diagnostics-toggle'),
				HTMLInputElement,
			)
			expect(toggle.checked).toBe(false)

			await fireEvent.click(toggle)

			expect(onGhosttyTerminalDiagnosticsChange).toHaveBeenCalledWith(true)
		})
	})
})
