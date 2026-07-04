const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron')
const { createOpenForgePreloadApi } = require('./preloadBridge.cjs') as typeof import('./preloadBridge.cjs')

contextBridge.exposeInMainWorld('openforge', createOpenForgePreloadApi(ipcRenderer))
