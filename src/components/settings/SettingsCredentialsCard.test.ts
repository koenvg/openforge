import { render, screen, fireEvent } from '@testing-library/svelte'
import { describe, it, expect, vi } from 'vitest'
import { requireElement } from '../../test-utils/dom'
import SettingsCredentialsCard from './SettingsCredentialsCard.svelte'

function defaultProps(overrides: Record<string, unknown> = {}) {
	return {
		githubToken: '',
		onGithubTokenChange: vi.fn(),
		anthropicApiKey: '',
		onAnthropicApiKeyChange: vi.fn(),
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

	it('renders the Anthropic API key field as a password input', () => {
		render(SettingsCredentialsCard, { props: defaultProps({ anthropicApiKey: 'sk-ant-old' }) })

		const input = requireElement(screen.getByPlaceholderText('sk-ant-...'), HTMLInputElement)
		expect(input.type).toBe('password')
		expect(input.value).toBe('sk-ant-old')
	})

	it('calls onAnthropicApiKeyChange when the Anthropic key input changes', async () => {
		const onAnthropicApiKeyChange = vi.fn()
		render(SettingsCredentialsCard, { props: defaultProps({ onAnthropicApiKeyChange }) })

		const input = screen.getByPlaceholderText('sk-ant-...')
		await fireEvent.input(input, { target: { value: 'sk-ant-new' } })

		expect(onAnthropicApiKeyChange).toHaveBeenCalledWith('sk-ant-new')
	})

	it('disables the Anthropic API key field when disabled', () => {
		render(SettingsCredentialsCard, { props: defaultProps({ disabled: true }) })

		const input = requireElement(screen.getByPlaceholderText('sk-ant-...'), HTMLInputElement)
		expect(input.disabled).toBe(true)
	})
})
