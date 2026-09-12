import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import PluginViewStateTestWrapper from './PluginViewStateTestWrapper.svelte'
import { createRawSnippet } from 'svelte'
import PluginViewState from './PluginViewState.svelte'

describe('plugin-sdk PluginViewState', () => {
  it('retains state precedence and caller-owned action snippets', async () => {
    const errorActions = createRawSnippet(() => ({ render: () => '<button type="button">Inspect connection</button>' }))
    const emptyActions = createRawSnippet(() => ({ render: () => '<button type="button">Create record</button>' }))
    const { rerender } = render(PluginViewState, { loading: true, error: '', empty: true, onRetry: vi.fn(), errorActions, emptyActions })
    expect(screen.getByRole('status').textContent).toContain('Loading…')
    expect(screen.queryByRole('alert')).toBeNull()
    await rerender({ loading: false })
    expect(screen.getByRole('alert').textContent).toContain('Unable to load')
    expect(screen.getByRole('button', { name: 'Inspect connection' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    await rerender({ error: null })
    expect(screen.getByRole('status').textContent).toContain('Nothing to show')
    expect(screen.getByRole('button', { name: 'Create record' })).toBeTruthy()
  })

  it('renders slotted plugin content when no view state is active', () => {
    render(PluginViewStateTestWrapper, { props: { mode: 'content' } })

    expect(screen.getByRole('article', { name: 'Plugin records' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Plugin record list' })).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('announces loading state without rendering plugin content', () => {
    render(PluginViewStateTestWrapper, { props: { mode: 'loading' } })

    const status = screen.getByRole('status')
    expect(status.getAttribute('aria-live')).toBe('polite')
    expect(status.textContent).toContain('Loading plugin records…')
    expect(status.querySelectorAll('[aria-label="Loading plugin records…"]')).toHaveLength(0)
    expect(screen.getAllByRole('status')).toHaveLength(1)
    expect(screen.queryByRole('article', { name: 'Plugin records' })).toBeNull()
  })

  it('announces error state and wires retry actions', async () => {
    const onRetry = vi.fn()
    render(PluginViewStateTestWrapper, { props: { mode: 'error', onRetry } })

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('Unable to load plugin records')
    expect(alert.textContent).toContain('Network unavailable')

    await fireEvent.click(screen.getByRole('button', { name: 'Retry loading records' }))

    expect(onRetry).toHaveBeenCalledOnce()
    expect(screen.queryByRole('article', { name: 'Plugin records' })).toBeNull()
  })

  it('keeps retry disabled while the caller is already retrying', async () => {
    const onRetry = vi.fn()
    render(PluginViewStateTestWrapper, { props: { mode: 'error', onRetry, retryDisabled: true } })

    const retry = screen.getByRole('button', { name: 'Retry loading records' })
    expect(retry).toBeInstanceOf(HTMLButtonElement)
    expect((retry as HTMLButtonElement).disabled).toBe(true)

    await fireEvent.click(retry)

    expect(onRetry).not.toHaveBeenCalled()
  })

  it('renders empty state copy without announcing an error', () => {
    render(PluginViewStateTestWrapper, { props: { mode: 'empty' } })

    const status = screen.getByRole('status')
    expect(status.getAttribute('aria-live')).toBe('polite')
    expect(screen.getByRole('heading', { name: 'No plugin records' })).toBeTruthy()
    expect(status.textContent).toContain('Records created by this plugin will appear here.')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('article', { name: 'Plugin records' })).toBeNull()
  })
})
