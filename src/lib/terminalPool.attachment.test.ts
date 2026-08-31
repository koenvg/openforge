import { describe, expect, it } from 'vitest'
import {
  acquire,
  attach,
  release,
  terminalDiagnostics,
} from './terminalPool'

describe('desktop Terminal Session attachment facade', () => {
  it('mounts a session and returns a generation-bound attachment', async () => {
    const session = await acquire('task-4')
    const wrapper = document.createElement('div')

    const attachment = await attach(session, wrapper)

    expect(wrapper.childElementCount).toBe(1)
    expect(terminalDiagnostics.observe('task-4').view.attached).toBe(true)
    expect(attachment.generation).toBe(1)
    expect(await attachment.refit()).toEqual({ cols: 80, rows: 24 })

    attachment.detach()
    expect(terminalDiagnostics.observe('task-4').view.attached).toBe(false)
    release('task-4')
  })

  it('rejects detach from a superseded attachment', async () => {
    const session = await acquire('task-move')
    const first = await attach(session, document.createElement('div'))
    const secondHost = document.createElement('div')
    const second = await attach(session, secondHost)

    first.detach()

    expect(secondHost.childElementCount).toBe(1)
    expect(terminalDiagnostics.observe('task-move').view.attached).toBe(true)

    second.detach()
    expect(terminalDiagnostics.observe('task-move').view.attached).toBe(false)
    release('task-move')
  })

  it('returns the current geometry only from the active attachment', async () => {
    const session = await acquire('task-refit')
    const first = await attach(session, document.createElement('div'))
    const second = await attach(session, document.createElement('div'))

    await expect(first.refit()).resolves.toBeNull()
    await expect(second.refit()).resolves.toEqual({ cols: 80, rows: 24 })

    release('task-refit')
  })
})
