import type { BrowserWindowConstructorOptions } from 'electron'

export interface MainWindowOptionsConfig {
  sandbox?: boolean
}

export function createMainWindowOptions(
  preloadPath: string,
  config: MainWindowOptionsConfig = {},
): BrowserWindowConstructorOptions {
  return {
    title: 'Open Forge',
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: config.sandbox ?? true,
      nodeIntegration: false,
    },
  }
}
