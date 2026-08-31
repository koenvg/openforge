import { fireEvent, render, screen } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetSettingsViewTaskLabelsTest } from './SettingsView.taskLabels.testFixture'
import { defaultProps } from './SettingsView.testUtils'
import { getProjectTaskLabels } from '../../lib/ipc'
import SettingsView from './SettingsView.svelte'

describe('SettingsView Task Labels integration', () => {
  beforeEach(resetSettingsViewTaskLabelsTest)

  it('renders Task Labels management on the project settings page', async () => {
    vi.mocked(getProjectTaskLabels).mockResolvedValue([{ id: 1, projectId: 'test-project-id', name: 'bug' }])
    render(SettingsView, { props: defaultProps })

    await fireEvent.click(screen.getByRole('button', { name: /Labels/ }))
    expect(await screen.findByText('Task Labels')).toBeTruthy()
    expect(screen.getByText('bug')).toBeTruthy()
    expect(getProjectTaskLabels).toHaveBeenCalledWith('test-project-id')
  })
})
