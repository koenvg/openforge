import { vi } from 'vitest'

import { createEmptyGithubSyncResult } from './TaskInfoPanel.testFixtures'

vi.mock('../../lib/ipc', () => ({
  forceGithubSync: vi.fn().mockImplementation(() => Promise.resolve(createEmptyGithubSyncResult())),
  refreshTaskGithubStatus: vi.fn().mockImplementation(() => Promise.resolve(createEmptyGithubSyncResult())),
  getPullRequests: vi.fn().mockResolvedValue([]),
  getPrComments: vi.fn().mockResolvedValue([]),
  linkPullRequest: vi.fn().mockResolvedValue(undefined),
  mergePullRequest: vi.fn().mockResolvedValue(undefined),
  openUrl: vi.fn().mockResolvedValue(undefined),
  getProjectTaskLabels: vi.fn().mockResolvedValue([]),
  addTaskLabel: vi.fn().mockResolvedValue({ id: 1, project_id: 'proj-1', name: 'bug' }),
  removeTaskLabel: vi.fn().mockResolvedValue(undefined),
  updateTaskSourceTicketUrl: vi.fn().mockResolvedValue(undefined),
  getTaskGitStatus: vi.fn().mockResolvedValue({
    has_remote: false,
    remote_ahead: 0,
    remote_behind: 0,
    local_commits: 0,
    uncommitted_files: 0,
    insertions: 0,
    deletions: 0,
    untracked_files: 0,
    untracked_insertions: 0,
  }),
  writeClipboardText: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../lib/desktopIpc', () => ({
  listenDesktopEvent: vi.fn().mockResolvedValue(() => {}),
}))
