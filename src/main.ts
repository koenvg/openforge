import './app.css'
import { mount } from 'svelte'
import App from './App.svelte'
import { initTheme } from './lib/theme'

initTheme()
if (import.meta.env.DEV) {
  void import('./lib/terminalTestProbe').then(({ installTerminalTestProbe }) => {
    installTerminalTestProbe({
      isDevelopment: true,
      environmentEnabled: import.meta.env.VITE_OPENFORGE_E2E === '1',
      launchToken: import.meta.env.VITE_OPENFORGE_E2E_TOKEN,
      url: window.location.href,
    })
  })
}

const app = mount(App, {
  target: document.getElementById('app')!,
})

export default app
