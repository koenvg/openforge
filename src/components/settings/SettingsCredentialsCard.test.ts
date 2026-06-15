import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi } from 'vitest'
import { requireElement } from '../../test-utils/dom'
import SettingsCredentialsCard from './SettingsCredentialsCard.svelte'

function defaultProps(overrides: Record<string, unknown> = {}) {
	return {
		githubToken: '',
		onGithubTokenChange: vi.fn(),
		disabled: false,
		...overrides,
	}
}

describe('SettingsCredentialsCard', () => {
	it('renders the GitHub token field as a password input', () => {
		render(SettingsCredentialsCard, { props: defaultProps({ githubToken: 'ghp_old' }) })

		const input = requireElement(screen.getByPlaceholderText('ghp_...'), HTMLInputElement)
		expect(input.type).toBe('password')
		expect(input.value).toBe('ghp_old')
	})

	it('calls onGithubTokenChange when token input changes', async () => {
		const onGithubTokenChange = vi.fn()
		render(SettingsCredentialsCard, { props: defaultProps({ onGithubTokenChange }) })

		const input = screen.getByPlaceholderText('ghp_...')
		await fireEvent.input(input, { target: { value: 'ghp_new' } })

		expect(onGithubTokenChange).toHaveBeenCalledWith('ghp_new')
	})

	it('disables the GitHub token field when disabled', () => {
		render(SettingsCredentialsCard, { props: defaultProps({ disabled: true }) })

		const input = requireElement(screen.getByPlaceholderText('ghp_...'), HTMLInputElement)
		expect(input.disabled).toBe(true)
	})
})
