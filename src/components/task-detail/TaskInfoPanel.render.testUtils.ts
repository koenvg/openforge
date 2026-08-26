import { render } from '@testing-library/svelte'
import type { ComponentProps } from 'svelte'
import TaskInfoPanel from './TaskInfoPanel.svelte'
import { baseTask } from './TaskInfoPanel.testFixtures'

type TaskInfoPanelProps = ComponentProps<typeof TaskInfoPanel>

function renderTaskInfoPanel(overrides: Partial<TaskInfoPanelProps> = {}) {
  const props: TaskInfoPanelProps = {
    task: baseTask,
    workspacePath: null,
    ...overrides,
  }
  return render(TaskInfoPanel, { props })
}

export { renderTaskInfoPanel }
