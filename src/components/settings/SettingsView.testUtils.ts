import { fireEvent, screen } from '@testing-library/svelte'
import { vi } from 'vitest'

vi.mock('../../lib/boardFilters', () => ({
  loadFocusFilterStates: vi.fn(() => Promise.resolve(['idle', 'needs-input', 'paused', 'agent-done', 'failed', 'interrupted', 'pr-draft', 'pr-open', 'ci-failed', 'changes-requested', 'unaddressed-comments', 'ready-to-merge', 'pr-merged'])),
  saveFocusFilterStates: vi.fn(() => Promise.resolve(undefined)),
  DEFAULT_FOCUS_STATES: ['idle', 'needs-input', 'paused', 'agent-done', 'failed', 'interrupted', 'pr-draft', 'pr-open', 'ci-failed', 'changes-requested', 'unaddressed-comments', 'ready-to-merge', 'pr-merged'],
  FOCUS_FILTER_STATES: ['idle', 'needs-input', 'paused', 'agent-done', 'failed', 'interrupted', 'pr-draft', 'pr-open', 'ci-failed', 'changes-requested', 'unaddressed-comments', 'ready-to-merge', 'pr-merged'],
}))

export async function openSettingsCategory(name: RegExp) {
  await fireEvent.click(screen.getByRole('button', { name }))
}

export const defaultProps = {
  onClose: vi.fn(),
  onProjectDeleted: vi.fn(),
  onProjectSettingsSaved: vi.fn(),
  mode: 'project' as const,
}
