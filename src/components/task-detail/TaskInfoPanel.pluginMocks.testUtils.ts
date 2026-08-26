import { vi } from 'vitest'

vi.mock('../../lib/plugin/pluginRegistry', () => ({
  activatePlugin: vi.fn(async () => true),
  getPluginRenderProps: (pluginId: string, options: { projectId: string | null; taskId?: string | null }) => ({
    api: {},
    context: { pluginId, projectId: options.projectId, taskId: options.taskId ?? null },
  }),
}))
