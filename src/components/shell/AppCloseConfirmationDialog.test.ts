import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import AppCloseConfirmationDialog from './AppCloseConfirmationDialog.svelte'
import { useAppCloseController } from '../../lib/appCloseController.svelte'
import type { ProjectAttention } from '../../lib/types'

function activeAttention(): Map<string, ProjectAttention> {
  return new Map([[
    'proj-1',
    {
      project_id: 'proj-1',
      running_agents: 1,
      needs_input: 0,
      ci_failures: 0,
      unaddressed_comments: 0,
      completed_agents: 0,
    },
  ]])
}

describe('AppCloseConfirmationDialog', () => {
  it('focuses the destructive action and exposes cancel and confirm through the close controller', async () => {
    const destroy = vi.fn(async () => undefined)
    const controller = useAppCloseController({
      refreshAttention: vi.fn(async () => undefined),
      getAttention: activeAttention,
      getAppWindow: () => ({ onCloseRequested: vi.fn(), destroy }),
    })
    render(AppCloseConfirmationDialog, { controller })

    expect(screen.queryByRole('dialog')).toBeNull()

    await controller.handleCloseRequested({ preventDefault: vi.fn() })

    const quitButton = await screen.findByRole('button', { name: 'Quit' })
    await waitFor(() => {
      expect(document.activeElement).toBe(quitButton)
    })

    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(destroy).not.toHaveBeenCalled()

    await controller.handleCloseRequested({ preventDefault: vi.fn() })
    await fireEvent.click(await screen.findByRole('button', { name: 'Quit' }))

    expect(destroy).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
