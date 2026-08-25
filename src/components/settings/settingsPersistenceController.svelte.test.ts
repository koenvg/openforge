import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectSettingsSavePayload } from '../../lib/settingsSaver'
import { createSettingsPersistenceController } from './settingsPersistenceController.svelte'

const projectPayload = (projectName: string): ProjectSettingsSavePayload => ({
  projectId: 'project-1',
  projectName,
  projectPath: '/tmp/project-1',
  agentInstructions: '',
  runCommand: '',
  focusFilterStates: [],
})

describe('createSettingsPersistenceController', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('persists pending project and global changes through their single save paths', async () => {
    const saveProject = vi.fn(async () => undefined)
    const saveGlobal = vi.fn(async () => undefined)
    const controller = createSettingsPersistenceController({
      delayMs: 500,
      saveProject,
      saveGlobal,
    })

    controller.scheduleProject(projectPayload('Renamed'))
    controller.scheduleGlobal({ githubToken: 'ghp_new' })

    expect(controller.saveStatus).toBe('dirty')
    await vi.advanceTimersByTimeAsync(500)

    expect(saveProject).toHaveBeenCalledOnce()
    expect(saveProject).toHaveBeenCalledWith(projectPayload('Renamed'))
    expect(saveGlobal).toHaveBeenCalledOnce()
    expect(saveGlobal).toHaveBeenCalledWith({ githubToken: 'ghp_new' })
    expect(controller.saveStatus).toBe('saved')
  })

  it('reruns an in-flight project save with the latest captured payload', async () => {
    let finishFirstSave!: () => void
    const saveProject = vi.fn()
      .mockImplementationOnce(() => new Promise<void>((resolve) => {
        finishFirstSave = resolve
      }))
      .mockResolvedValueOnce(undefined)
    const controller = createSettingsPersistenceController({ delayMs: 500, saveProject })

    controller.scheduleProject(projectPayload('First'))
    await vi.advanceTimersByTimeAsync(500)
    controller.scheduleProject(projectPayload('Second'))
    finishFirstSave()
    await vi.advanceTimersByTimeAsync(0)

    expect(saveProject).toHaveBeenCalledTimes(2)
    expect(saveProject).toHaveBeenNthCalledWith(2, projectPayload('Second'))
  })

  it('restores failed global changes so an immediate retry uses the same payload', async () => {
    const saveGlobal = vi.fn()
      .mockRejectedValueOnce(new Error('disk full'))
      .mockResolvedValueOnce(undefined)
    const controller = createSettingsPersistenceController({ delayMs: 500, saveGlobal })

    controller.scheduleGlobal({ githubToken: 'ghp_new' })
    await vi.advanceTimersByTimeAsync(500)

    expect(controller.saveStatus).toBe('error')
    expect(controller.saveError).toBe('disk full')

    await controller.runImmediately()

    expect(saveGlobal).toHaveBeenCalledTimes(2)
    expect(saveGlobal).toHaveBeenNthCalledWith(2, { githubToken: 'ghp_new' })
    expect(controller.saveStatus).toBe('saved')
  })
})
