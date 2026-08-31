import { vi } from 'vitest'

vi.mock('../../lib/ipc', () => ({
  updateTaskFields: vi.fn().mockResolvedValue(undefined),
  updateTaskTitle: vi.fn().mockResolvedValue(undefined),
  getProjectTaskLabels: vi.fn().mockResolvedValue([]),
  addTaskLabel: vi.fn().mockResolvedValue(null),
  removeTaskLabel: vi.fn().mockResolvedValue(undefined),
  updateTaskSourceTicketUrl: vi.fn().mockResolvedValue(undefined),
  getPullRequests: vi.fn().mockResolvedValue([]),
  forceGithubSync: vi.fn().mockResolvedValue({}),
  deleteTask: vi.fn().mockResolvedValue(undefined),
  getPrComments: vi.fn().mockResolvedValue([]),
  markCommentAddressed: vi.fn().mockResolvedValue(undefined),
  openUrl: vi.fn().mockResolvedValue(undefined),
  openInEditor: vi.fn().mockResolvedValue(undefined),
  hasVsCodeProtocolHandler: vi.fn().mockResolvedValue(true),
  getTaskWorkspace: vi.fn().mockResolvedValue(null),
  getConfig: vi.fn().mockResolvedValue(''),
  getProjectConfig: vi.fn().mockResolvedValue(null),
  setProjectConfig: vi.fn().mockResolvedValue(undefined),
  getLatestSession: vi.fn().mockResolvedValue(null),
  spawnShellPty: vi.fn().mockResolvedValue(1),
  getPtyBuffer: vi.fn().mockResolvedValue({ buffer: null, isLive: false, instanceId: null }),
  writePty: vi.fn().mockResolvedValue(undefined),
  resizePty: vi.fn().mockResolvedValue(undefined),
  killPty: vi.fn().mockResolvedValue(undefined),
  transcribeAudio: vi.fn(),
  getWhisperModelStatus: vi.fn(),
  downloadWhisperModel: vi.fn(),
  getTaskDiff: vi.fn().mockResolvedValue([]),
  getTaskFileContents: vi.fn().mockResolvedValue({ oldContent: '', newContent: '' }),
  getTaskBatchFileContents: vi.fn().mockResolvedValue([]),
}))

vi.mock('../../lib/desktopIpc', () => ({
  invokeDesktopCommand: vi.fn().mockResolvedValue(null),
  listenDesktopEvent: vi.fn().mockResolvedValue(() => {}),
}))

vi.mock('../../lib/audioRecorder', () => ({
  createAudioRecorder: vi.fn(),
}))
