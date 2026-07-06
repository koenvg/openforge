import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi } from 'vitest'
import { requireElement } from '../../test-utils/dom'
import SettingsExperimentalCard from './SettingsExperimentalCard.svelte'

function defaultProps(overrides: Record<string, unknown> = {}) {
	return {
		codeCleanupTasksEnabled: false,
		taskDisplayTitleMetadataUpdatesEnabled: false,
		onCodeCleanupTasksToggle: vi.fn(),
		onTaskDisplayTitleMetadataUpdatesToggle: vi.fn(),
		disabled: false,
		...overrides,
	}
}

describe('SettingsExperimentalCard', () => {
	it('renders Experimental heading', () => {
		render(SettingsExperimentalCard, { props: defaultProps() })

		expect(screen.getByText('Experimental')).toBeTruthy()
	})

	describe('code cleanup tasks experiment toggle', () => {
		it('renders Code Cleanup Tasks label', () => {
			render(SettingsExperimentalCard, { props: defaultProps() })

			expect(screen.getByText('Code Cleanup Tasks')).toBeTruthy()
		})

		it('renders toggle unchecked when codeCleanupTasksEnabled is false', () => {
			render(SettingsExperimentalCard, {
				props: defaultProps({ codeCleanupTasksEnabled: false }),
			})

			const toggle = requireElement(screen.getByTestId('code-cleanup-tasks-toggle'), HTMLInputElement)
			expect(toggle.checked).toBe(false)
		})

		it('renders toggle checked when codeCleanupTasksEnabled is true', () => {
			render(SettingsExperimentalCard, {
				props: defaultProps({ codeCleanupTasksEnabled: true }),
			})

			const toggle = requireElement(screen.getByTestId('code-cleanup-tasks-toggle'), HTMLInputElement)
			expect(toggle.checked).toBe(true)
		})

		it('calls onCodeCleanupTasksToggle when toggle is clicked', async () => {
			const onCodeCleanupTasksToggle = vi.fn()
			render(SettingsExperimentalCard, {
				props: defaultProps({ onCodeCleanupTasksToggle }),
			})

			const toggle = screen.getByTestId('code-cleanup-tasks-toggle')
			await fireEvent.click(toggle)

			expect(onCodeCleanupTasksToggle).toHaveBeenCalledOnce()
		})

		it('disables code cleanup tasks toggle when disabled', () => {
			render(SettingsExperimentalCard, {
				props: defaultProps({ disabled: true }),
			})

			const toggle = requireElement(screen.getByTestId('code-cleanup-tasks-toggle'), HTMLInputElement)
			expect(toggle.disabled).toBe(true)
		})

		it('renders description text for code cleanup tasks toggle', () => {
			render(SettingsExperimentalCard, { props: defaultProps() })

			expect(screen.getByText('Agents create tasks for code that needs cleanup or splitting')).toBeTruthy()
		})
	})

	describe('Task Display Title updates experiment toggle', () => {
		it('renders Task Display Title Updates label', () => {
			render(SettingsExperimentalCard, { props: defaultProps() })

			expect(screen.getByText('Task Display Title Updates')).toBeTruthy()
		})

		it('renders toggle unchecked when taskDisplayTitleMetadataUpdatesEnabled is false', () => {
			render(SettingsExperimentalCard, {
				props: defaultProps({ taskDisplayTitleMetadataUpdatesEnabled: false }),
			})

			const toggle = requireElement(screen.getByTestId('task-display-title-metadata-updates-toggle'), HTMLInputElement)
			expect(toggle.checked).toBe(false)
		})

		it('renders toggle checked when taskDisplayTitleMetadataUpdatesEnabled is true', () => {
			render(SettingsExperimentalCard, {
				props: defaultProps({ taskDisplayTitleMetadataUpdatesEnabled: true }),
			})

			const toggle = requireElement(screen.getByTestId('task-display-title-metadata-updates-toggle'), HTMLInputElement)
			expect(toggle.checked).toBe(true)
		})

		it('calls onTaskDisplayTitleMetadataUpdatesToggle when toggle is clicked', async () => {
			const onTaskDisplayTitleMetadataUpdatesToggle = vi.fn()
			render(SettingsExperimentalCard, {
				props: defaultProps({ onTaskDisplayTitleMetadataUpdatesToggle }),
			})

			const toggle = screen.getByTestId('task-display-title-metadata-updates-toggle')
			await fireEvent.click(toggle)

			expect(onTaskDisplayTitleMetadataUpdatesToggle).toHaveBeenCalledOnce()
		})

		it('disables Task Display Title updates toggle when disabled', () => {
			render(SettingsExperimentalCard, {
				props: defaultProps({ disabled: true }),
			})

			const toggle = requireElement(screen.getByTestId('task-display-title-metadata-updates-toggle'), HTMLInputElement)
			expect(toggle.disabled).toBe(true)
		})

		it('renders description text for Task Display Title updates toggle', () => {
			render(SettingsExperimentalCard, { props: defaultProps() })

			expect(screen.getByText('Generate Task Display Titles from agent activity metadata')).toBeTruthy()
		})
	})
})
