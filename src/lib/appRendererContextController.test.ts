import { describe, expect, it, vi } from 'vitest'
import { createAppRendererContextController } from './appRendererContextController'

describe('App renderer context controller', () => {
  it('reports meaningful poll context changes without repeating repo resolution', () => {
    const reportPollContext = vi.fn()
    const resolveProjectRepo = vi.fn()
    const controller = createAppRendererContextController({
      globalPrViewKey: 'plugin:com.openforge.github-sync:pull-requests',
      reportPollContext,
      resolveProjectRepo,
    })

    controller.update({ focused: true, activeProjectId: 'P-1', currentView: 'board' })
    controller.update({ focused: true, activeProjectId: 'P-1', currentView: 'board' })
    controller.update({
      focused: true,
      activeProjectId: 'P-1',
      currentView: 'plugin:com.openforge.github-sync:pull-requests',
    })

    expect(reportPollContext).toHaveBeenCalledTimes(2)
    expect(reportPollContext).toHaveBeenNthCalledWith(1, {
      focused: true,
      activeProjectId: 'P-1',
      globalViewOpen: false,
    })
    expect(reportPollContext).toHaveBeenNthCalledWith(2, {
      focused: true,
      activeProjectId: 'P-1',
      globalViewOpen: true,
    })
    expect(resolveProjectRepo).toHaveBeenCalledOnce()
    expect(resolveProjectRepo).toHaveBeenCalledWith('P-1')
  })

  it('resolves each selected project and skips repo lookup when no project is selected', () => {
    const resolveProjectRepo = vi.fn()
    const controller = createAppRendererContextController({
      globalPrViewKey: 'plugin:com.openforge.github-sync:pull-requests',
      reportPollContext: vi.fn(),
      resolveProjectRepo,
    })

    controller.update({ focused: true, activeProjectId: null, currentView: 'board' })
    controller.update({ focused: true, activeProjectId: 'P-1', currentView: 'board' })
    controller.update({ focused: false, activeProjectId: 'P-2', currentView: 'board' })
    controller.update({ focused: false, activeProjectId: null, currentView: 'board' })

    expect(resolveProjectRepo.mock.calls).toEqual([['P-1'], ['P-2']])
  })
})
