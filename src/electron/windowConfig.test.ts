import { describe, expect, it } from 'vitest'
import { createMainWindowOptions } from './windowConfig'

describe('Electron main window security contract', () => {
  it('keeps renderer privileges locked down from the first Electron skeleton', () => {
    const options = createMainWindowOptions('/tmp/openforge-preload.js')

    expect(options.webPreferences).toMatchObject({
      preload: '/tmp/openforge-preload.js',
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    })
  })

  it('allows smoke tests to disable renderer sandbox without changing the default contract', () => {
    const options = createMainWindowOptions('/tmp/openforge-preload.js', { sandbox: false })

    expect(options.webPreferences).toMatchObject({
      preload: '/tmp/openforge-preload.js',
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
    })
  })
})
