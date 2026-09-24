import { describe, expect, it } from 'vitest'
import { createMainWindowOptions } from './windowConfig'
import { readWindowChromeArgument } from './preloadApi'

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
})

describe('Electron main window chrome', () => {
  it('hides the macOS title bar and tells the renderer to make room for the traffic lights', () => {
    const options = createMainWindowOptions('/tmp/openforge-preload.js', 'darwin')

    expect(options.titleBarStyle).toBe('hiddenInset')
    expect(options.trafficLightPosition).toEqual({ x: 18, y: 18 })
    expect(readWindowChromeArgument(options.webPreferences?.additionalArguments ?? [])).toBe('inset')
  })

  it.each(['linux', 'win32'] as const)('keeps the native frame on %s', (platform) => {
    const options = createMainWindowOptions('/tmp/openforge-preload.js', platform)

    expect(options.titleBarStyle).toBeUndefined()
    expect(options.trafficLightPosition).toBeUndefined()
    expect(readWindowChromeArgument(options.webPreferences?.additionalArguments ?? [])).toBe('native')
  })
})
