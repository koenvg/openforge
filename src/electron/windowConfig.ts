import type { BrowserWindowConstructorOptions } from 'electron'
import { OPENFORGE_WINDOW_CHROME_ARGUMENT_PREFIX } from './preloadApi.js'

export function createMainWindowOptions(
  preloadPath: string,
  platform: NodeJS.Platform = process.platform,
): BrowserWindowConstructorOptions {
  const insetChrome = platform === 'darwin'
  return {
    title: 'Open Forge',
    width: 1200,
    height: 800,
    show: false,
    ...(insetChrome ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 18 } } : {}),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      additionalArguments: insetChrome ? [`${OPENFORGE_WINDOW_CHROME_ARGUMENT_PREFIX}inset`] : [],
    },
  }
}
