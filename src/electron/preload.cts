const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron')
const { createOpenForgePreloadApi, readWindowChromeArgument } = require('./preloadBridge.cjs') as typeof import('./preloadBridge.cjs')

contextBridge.exposeInMainWorld('openforge', createOpenForgePreloadApi(ipcRenderer))

const windowChrome = readWindowChromeArgument(process.argv)
window.addEventListener('DOMContentLoaded', () => {
  document.documentElement.dataset.windowChrome = windowChrome
})
