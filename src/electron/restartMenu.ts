import { BrowserWindow, Menu, MenuItem, dialog } from 'electron'

/** Keep Restart beside normal Quit, using the platform's existing application menu. */
export function installRestartMenu(restart: (rendererId: number) => Promise<void>): void {
  const menu = Menu.getApplicationMenu() ?? Menu.buildFromTemplate([
    { role: process.platform === 'darwin' ? 'appMenu' : 'fileMenu' },
    { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
  ])
  const submenu = menu.items.find(item => item.submenu?.items.some(entry => entry.role === 'quit'))?.submenu
  if (!submenu || submenu.items.some(item => item.id === 'openforge-restart')) return
  const item = new MenuItem({
    id: 'openforge-restart', label: 'Restart OpenForge',
    click: async () => {
      const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      if (!window || !item.enabled) return
      item.enabled = false
      item.label = 'Restarting OpenForge…'
      for (const participant of BrowserWindow.getAllWindows()) participant.setProgressBar(2)
      try {
        await restart(window.webContents.id)
      } catch (error) {
        item.enabled = true
        item.label = 'Restart OpenForge'
        dialog.showErrorBox('Restart not completed', error instanceof Error ? error.message : String(error))
      } finally {
        for (const participant of BrowserWindow.getAllWindows()) participant.setProgressBar(-1)
      }
    },
  })
  submenu.insert(submenu.items.findIndex(entry => entry.role === 'quit'), item)
  Menu.setApplicationMenu(menu)
}
